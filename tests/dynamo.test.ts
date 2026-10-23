import { beforeAll, afterAll, it, expect, describe } from 'vitest';
import { DynamoDBClient, CreateTableCommand, DeleteTableCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoStore } from '../packages/shared/src/store.js';
import { Service } from '../packages/shared/src/service.js';
import { Engine } from '../apps/worker/src/engine.js';
import type { Delivery } from '../packages/shared/src/model.js';
const endpoint = process.env.DYNAMODB_LOCAL_URL;
describe.skipIf(!endpoint)('DynamoDB Local SDK integration', () => {
  const table = 'oathwire-test-' + Date.now(),
    secrets = table + '-secrets';
  if (endpoint && !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(endpoint))
    throw new Error('Tests require an explicit loopback DynamoDB endpoint.');
  const client = new DynamoDBClient({
    endpoint,
    region: 'eu-central-1',
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  });
  const store = new DynamoStore(
    table,
    secrets,
    DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } }),
  );
  const service = new Service(store);
  beforeAll(async () => {
    await client.send(
      new CreateTableCommand({
        TableName: table,
        BillingMode: 'PAY_PER_REQUEST',
        KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
        AttributeDefinitions: [
          { AttributeName: 'pk', AttributeType: 'S' },
          { AttributeName: 'listPk', AttributeType: 'S' },
          { AttributeName: 'listSk', AttributeType: 'S' },
          { AttributeName: 'workPk', AttributeType: 'S' },
          { AttributeName: 'workAt', AttributeType: 'N' },
          { AttributeName: 'destinationPk', AttributeType: 'S' },
          { AttributeName: 'destinationSk', AttributeType: 'S' },
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: 'DestinationHistory',
            KeySchema: [
              { AttributeName: 'destinationPk', KeyType: 'HASH' },
              { AttributeName: 'destinationSk', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
          {
            IndexName: 'Listing',
            KeySchema: [
              { AttributeName: 'listPk', KeyType: 'HASH' },
              { AttributeName: 'listSk', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
          {
            IndexName: 'Work',
            KeySchema: [
              { AttributeName: 'workPk', KeyType: 'HASH' },
              { AttributeName: 'workAt', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'KEYS_ONLY' },
          },
        ],
      }),
    );
    await client.send(
      new CreateTableCommand({
        TableName: secrets,
        BillingMode: 'PAY_PER_REQUEST',
        KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
        AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }],
      }),
    );
  }, 30000);
  afterAll(async () => {
    for (const name of [table, secrets])
      await client.send(new DeleteTableCommand({ TableName: name }));
    client.destroy();
  });
  it('atomically accepts concurrent requests, queries due work and conditionally completes a delivery', async () => {
    const p = await service.createProject('alice', 'SDK Integration', '');
    await service.addDestination(p.pk, 'alice', {
      name: 'Receiver',
      url: 'https://receiver.example.org/hook',
      eventTypes: ['*'],
    });
    const key = await service.createKey(p.pk, 'alice', 'Integration');
    const events = await Promise.all(
      Array.from({ length: 4 }, () =>
        service.publish(key.key, { type: 'order.created', data: { id: 1 } }, 'same'),
      ),
    );
    expect(new Set(events.map((e) => e.pk)).size).toBe(1);
    const e = events[0]!;
    expect((await store.due(Date.now())).items).toHaveLength(1);
    const engine = new Engine(
      store,
      async () => {},
      async () => ({ status: 200 }),
    );
    await engine.process({ deliveryId: e.deliveryIds[0]!, generation: 1 });
    expect((await store.get<Delivery>(e.deliveryIds[0]!))?.status).toBe('delivered');
    expect((await store.list(e.deliveryIds[0]!, 'ATTEMPT#')).items).toHaveLength(1);
    expect((await store.due(Date.now())).items).toHaveLength(0);
    const destinationId = (await store.get<Delivery>(e.deliveryIds[0]!))!.destinationId;
    expect((await store.destination<Delivery>(destinationId)).items[0]?.status).toBe('delivered');
    await expect(
      service.publish(key.key, { type: 'order.created', data: { id: 2 } }, 'same'),
    ).rejects.toMatchObject({ status: 409 });
  });
});
