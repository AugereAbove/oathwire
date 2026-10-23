import type { SQSEvent, SQSBatchResponse, ScheduledEvent } from 'aws-lambda';
import { z } from 'zod';
import { DynamoStore } from '../../../packages/shared/src/store.js';
import { Engine, log, sqsPublisher } from './engine.js';
import { send } from './http.js';
function required(key: string) {
  const v = process.env[key];
  if (!v) throw new Error('Missing configuration: ' + key);
  return v;
}
const engine = new Engine(
  new DynamoStore(required('TABLE_NAME'), required('SECRETS_TABLE_NAME')),
  sqsPublisher(required('QUEUE_URL')),
  send,
);
const schema = z
  .object({
    deliveryId: z.string().regex(/^del_[a-f0-9-]{36}$/),
    generation: z.number().int().positive(),
  })
  .strict();
export async function handler(event: SQSEvent | ScheduledEvent): Promise<SQSBatchResponse | void> {
  if (!('Records' in event)) {
    await engine.reconcile();
    return;
  }
  const failures: { itemIdentifier: string }[] = [];
  for (const record of event.Records) {
    try {
      await engine.process(schema.parse(JSON.parse(record.body)));
    } catch {
      log('queue_processing_failed', { messageId: record.messageId });
      failures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures: failures };
}
