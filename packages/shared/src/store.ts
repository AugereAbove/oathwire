import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { Conflict, type Row } from './model.js';

export interface Write {
  row: Row;
  expected: number | null;
  secret?: boolean;
  check?: boolean;
}
export interface Page<T> {
  items: T[];
  cursor?: string;
}
export interface Store {
  get<T extends Row>(pk: string, secret?: boolean): Promise<T | undefined>;
  commit(writes: Write[]): Promise<void>;
  list<T extends Row>(partition: string, prefix: string, cursor?: string): Promise<Page<T>>;
  due(now: number, cursor?: string): Promise<Page<Row>>;
  destination<T extends Row>(id: string, cursor?: string): Promise<Page<T>>;
}
const encode = (key: unknown) => Buffer.from(JSON.stringify(key)).toString('base64url');
function decode(cursor?: string): Record<string, unknown> | undefined {
  if (!cursor) return undefined;
  try {
    const key: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    if (!key || typeof key !== 'object' || Array.isArray(key)) throw new Error();
    return key as Record<string, unknown>;
  } catch {
    throw new Error('INVALID_CURSOR');
  }
}
export class DynamoStore implements Store {
  constructor(
    private table: string,
    private secrets: string,
    private client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    }),
  ) {}
  async get<T extends Row>(pk: string, secret = false): Promise<T | undefined> {
    const r = await this.client.send(
      new GetCommand({
        TableName: secret ? this.secrets : this.table,
        Key: { pk },
        ConsistentRead: true,
      }),
    );
    return r.Item as T | undefined;
  }
  async commit(writes: Write[]) {
    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: writes.map((w) => {
            const condition = w.expected === null ? 'attribute_not_exists(pk)' : '#v = :v';
            const common = {
              TableName: w.secret ? this.secrets : this.table,
              ConditionExpression: condition,
              ...(w.expected === null
                ? {}
                : {
                    ExpressionAttributeNames: { '#v': 'version' },
                    ExpressionAttributeValues: { ':v': w.expected },
                  }),
            };
            return w.check
              ? { ConditionCheck: { ...common, Key: { pk: w.row.pk } } }
              : { Put: { ...common, Item: w.row } };
          }),
        }),
      );
    } catch (e) {
      // Only conditional conflicts are retried; throttles and invalid transactions remain visible.
      if (
        e &&
        typeof e === 'object' &&
        'CancellationReasons' in e &&
        Array.isArray(e.CancellationReasons) &&
        e.CancellationReasons.some(
          (r) => r.Code === 'ConditionalCheckFailed' || r.Code === 'TransactionConflict',
        )
      )
        throw new Conflict();
      throw e;
    }
  }
  async list<T extends Row>(partition: string, prefix: string, cursor?: string): Promise<Page<T>> {
    const key = decode(cursor);
    if (
      key &&
      (key.listPk !== partition || typeof key.listSk !== 'string' || !key.listSk.startsWith(prefix))
    )
      throw new Error('INVALID_CURSOR');
    const r = await this.client.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: 'Listing',
        KeyConditionExpression: 'listPk = :p AND begins_with(listSk, :s)',
        ExpressionAttributeValues: { ':p': partition, ':s': prefix },
        Limit: 50,
        ScanIndexForward: false,
        ExclusiveStartKey: key,
      }),
    );
    return {
      items: (r.Items ?? []) as T[],
      cursor: r.LastEvaluatedKey ? encode(r.LastEvaluatedKey) : undefined,
    };
  }
  async due(now: number, cursor?: string): Promise<Page<Row>> {
    const r = await this.client.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: 'Work',
        KeyConditionExpression: 'workPk = :p AND workAt <= :now',
        ExpressionAttributeValues: { ':p': 'WORK', ':now': now },
        Limit: 100,
        ExclusiveStartKey: decode(cursor),
      }),
    );
    return {
      items: (r.Items ?? []) as Row[],
      cursor: r.LastEvaluatedKey ? encode(r.LastEvaluatedKey) : undefined,
    };
  }
  async destination<T extends Row>(id: string, cursor?: string): Promise<Page<T>> {
    const key = decode(cursor);
    if (key && key.destinationPk !== id) throw new Error('INVALID_CURSOR');
    const r = await this.client.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: 'DestinationHistory',
        KeyConditionExpression: 'destinationPk = :p',
        ExpressionAttributeValues: { ':p': id },
        Limit: 50,
        ScanIndexForward: false,
        ExclusiveStartKey: key,
      }),
    );
    return {
      items: (r.Items ?? []) as T[],
      cursor: r.LastEvaluatedKey ? encode(r.LastEvaluatedKey) : undefined,
    };
  }
}
export function write<T extends Row>(row: T, previous?: Row, secret = false): Write {
  return {
    row: { ...row, version: (previous?.version ?? 0) + 1 },
    expected: previous?.version ?? null,
    secret,
  };
}
export function check(row: Row, secret = false): Write {
  return { row, expected: row.version, check: true, secret };
}
export async function optimistic<T>(fn: () => Promise<T>): Promise<T> {
  for (let n = 0; n < 8; n++) {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof Conflict)) throw e;
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 15 * (n + 1)));
    }
  }
  throw new Conflict('Concurrent changes; retry the request.');
}
