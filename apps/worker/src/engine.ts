import { randomUUID } from 'node:crypto';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import {
  Conflict,
  iso,
  terminal,
  type Delivery,
  type EventRow,
  type Project,
  type Secret,
  type Attempt,
  type QueueJob,
} from '../../../packages/shared/src/model.js';
import { check, write, type Store } from '../../../packages/shared/src/store.js';
import { outcome, retryDelay, sign } from '../../../packages/shared/src/security.js';
import { type Sender } from './http.js';

export type Publisher = (job: QueueJob, delay: number) => Promise<void>;
export function sqsPublisher(url: string): Publisher {
  const client = new SQSClient({});
  return async (job, delay) => {
    await client.send(
      new SendMessageCommand({
        QueueUrl: url,
        MessageBody: JSON.stringify(job),
        DelaySeconds: Math.min(900, Math.max(0, delay)),
      }),
    );
  };
}
export const log = (action: string, fields: Record<string, string | number> = {}) =>
  console.log(JSON.stringify({ action, ...fields }));
export class Engine {
  constructor(
    private store: Store,
    private publish: Publisher,
    private sender: Sender,
    private now: () => number = Date.now,
  ) {}
  async enqueue(deliveryId: string) {
    const d = await this.store.get<Delivery>(deliveryId);
    if (!d || terminal(d.status) || d.status === 'processing') return;
    await this.publish(
      { deliveryId: d.pk, generation: d.generation },
      Math.ceil((d.nextAttemptAt - this.now()) / 1000),
    );
    // Never change the generation after publication: a fast worker may already have claimed it.
    try {
      await this.store.commit([
        write(
          { ...d, status: 'queued', workAt: Math.max(this.now(), d.nextAttemptAt) + 120000 },
          d,
        ),
      ]);
    } catch (e) {
      if (!(e instanceof Conflict)) throw e;
    }
  }
  async process(job: QueueJob) {
    const d = await this.store.get<Delivery>(job.deliveryId);
    const now = this.now();
    if (
      !d ||
      terminal(d.status) ||
      d.generation !== job.generation ||
      d.status === 'processing' ||
      d.nextAttemptAt > now
    )
      return;
    const p = await this.store.get<Project>(d.projectId);
    const dest = p?.destinations.find((v) => v.id === d.destinationId);
    const event = await this.store.get<EventRow>(d.eventId);
    if (
      !p ||
      p.status !== 'active' ||
      !dest?.enabled ||
      dest.retired ||
      !event ||
      (event.expiresAt ?? 0) <= now / 1000 ||
      (d.expiresAt ?? 0) <= now / 1000
    ) {
      const stopped = { ...d, status: 'cancelled' as const, updatedAt: iso(now) };
      delete stopped.workPk;
      delete stopped.workAt;
      try {
        await this.store.commit([write(stopped, d), ...(p ? [check(p)] : [])]);
      } catch (e) {
        if (!(e instanceof Conflict)) throw e;
      }
      return;
    }
    const secret = await this.store.get<Secret>(d.destinationId, true);
    if (!secret) throw new Error('MISSING_SIGNING_SECRET');
    const leaseToken = randomUUID();
    const claimed: Delivery = {
      ...d,
      status: 'processing',
      attemptCount: d.attemptCount + 1,
      leaseToken,
      leaseExpiresAt: now + 30000,
      workAt: now + 30000,
      updatedAt: iso(now),
      version: d.version + 1,
    };
    const attempt: Attempt = {
      pk: d.pk + '#' + claimed.attemptCount,
      kind: 'attempt',
      version: 1,
      deliveryId: d.pk,
      attemptNumber: claimed.attemptCount,
      startedAt: iso(now),
      result: 'in_progress',
      expiresAt: d.expiresAt,
      listPk: d.pk,
      listSk: 'ATTEMPT#' + String(claimed.attemptCount).padStart(2, '0'),
    };
    try {
      await this.store.commit([
        write(claimed, d),
        write(attempt),
        check(p),
        check(event),
        check(secret, true),
      ]);
    } catch (e) {
      if (e instanceof Conflict) return;
      throw e;
    }
    const body = JSON.stringify({
      id: event.pk,
      type: event.type,
      created_at: event.createdAt,
      data: event.data,
    });
    const timestamp = String(Math.floor(this.now() / 1000));
    const result = await this.sender(d.url, body, {
      'Content-Type': 'application/json',
      'User-Agent': 'Oathwire/1.0',
      'X-Oathwire-Event-Id': event.pk,
      'X-Oathwire-Delivery-Id': d.pk,
      'X-Oathwire-Attempt': String(claimed.attemptCount),
      'X-Oathwire-Timestamp': timestamp,
      'X-Oathwire-Signature': sign(secret.value, timestamp, body),
    });
    const finished = this.now();
    const classification = outcome(result.status, result.code);
    const next: Delivery = {
      ...claimed,
      updatedAt: iso(finished),
      lastHttpStatus: result.status,
      lastErrorCode:
        result.code ?? (classification === 'delivered' ? undefined : 'HTTP_' + result.status),
    };
    // A response after lease expiry cannot overwrite recovery by another worker.
    if (finished > claimed.leaseExpiresAt!) return;
    if (classification === 'delivered') next.status = 'delivered';
    else if (classification === 'retryable' && next.attemptCount < 6) {
      next.status = 'retrying';
      next.generation++;
      next.nextAttemptAt =
        finished +
        retryDelay(
          next.attemptCount,
          result.status === 429 ? result.retryAfter : undefined,
          finished,
        ) *
          1000;
      next.workAt = next.nextAttemptAt;
    } else next.status = 'failed';
    delete next.leaseToken;
    delete next.leaseExpiresAt;
    if (terminal(next.status)) {
      delete next.workPk;
      delete next.workAt;
    }
    try {
      await this.store.commit([
        write(next, claimed),
        write(
          {
            ...attempt,
            result: classification,
            finishedAt: iso(finished),
            durationMs: finished - now,
            httpStatus: result.status,
            errorCode: next.lastErrorCode,
          },
          attempt,
        ),
      ]);
    } catch (e) {
      if (e instanceof Conflict) return;
      throw e;
    }
    log('attempt_finished', {
      deliveryId: d.pk,
      attempt: claimed.attemptCount,
      result: next.status,
      durationMs: finished - now,
    });
    if (next.status === 'retrying') await this.enqueue(next.pk);
  }
  async reconcile() {
    let cursor: string | undefined;
    let processed = 0;
    // Bound each invocation. Due ordering leaves recovered rows out of subsequent pages.
    for (let page = 0; page < 5; page++) {
      const batch = await this.store.due(this.now(), cursor);
      for (const row of batch.items) {
        try {
          const d = await this.store.get<Delivery>(row.pk);
          if (!d || terminal(d.status) || (d.workAt ?? Infinity) > this.now()) continue;
          if (d.status === 'processing') {
            if ((d.leaseExpiresAt ?? Infinity) > this.now()) continue;
            const attempt = await this.store.get<Attempt>(d.pk + '#' + d.attemptCount);
            const next: Delivery = {
              ...d,
              status: d.attemptCount >= 6 ? 'failed' : 'retrying',
              generation: d.generation + 1,
              nextAttemptAt: this.now(),
              workAt: this.now(),
              lastErrorCode: 'OUTCOME_UNKNOWN',
              updatedAt: iso(this.now()),
            };
            delete next.leaseToken;
            delete next.leaseExpiresAt;
            if (next.status === 'failed') {
              delete next.workPk;
              delete next.workAt;
            }
            await this.store.commit([
              write(next, d),
              ...(attempt
                ? [
                    write(
                      {
                        ...attempt,
                        result: 'unknown' as const,
                        finishedAt: iso(this.now()),
                        errorCode: 'OUTCOME_UNKNOWN',
                      },
                      attempt,
                    ),
                  ]
                : []),
            ]);
          }
          await this.enqueue(d.pk);
          processed++;
        } catch (e) {
          if (!(e instanceof Conflict)) log('reconciliation_item_failed', { deliveryId: row.pk });
        }
      }
      cursor = batch.cursor;
      if (!cursor) break;
    }
    log('reconciliation_finished', { processed });
  }
}
