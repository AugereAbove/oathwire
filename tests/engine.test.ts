import { describe, it, expect, vi } from 'vitest';
import { MemoryStore } from './memory.js';
import { Service } from '../packages/shared/src/service.js';
import { Engine } from '../apps/worker/src/engine.js';
import type { HttpResult } from '../apps/worker/src/http.js';
import { type Delivery, type Attempt, type QueueJob } from '../packages/shared/src/model.js';
import { verify } from '../packages/shared/src/security.js';
async function setup() {
  let time = 1792756800000;
  const now = () => time;
  const store = new MemoryStore();
  const service = new Service(store, now);
  const p = await service.createProject('alice', 'Store', '');
  const dest = await service.addDestination(p.pk, 'alice', {
    name: 'Receiver',
    url: 'https://receiver.example.org/hook',
    eventTypes: ['*'],
  });
  const key = await service.createKey(p.pk, 'alice', 'Publisher');
  const event = await service.publish(key.key, { type: 'order.created', data: { id: 1 } });
  const deliveryId = event.deliveryIds[0]!;
  const jobs: QueueJob[] = [];
  const publish = vi.fn(async (j: QueueJob, _delay: number) => {
    jobs.push(j);
  });
  const sender = vi.fn(
    async (_url: string, body: string, headers: Record<string, string>): Promise<HttpResult> => {
      expect(
        verify(
          dest.signingSecret,
          headers['X-Oathwire-Timestamp']!,
          body,
          headers['X-Oathwire-Signature']!,
          time,
        ),
      ).toBe(true);
      return { status: 200 };
    },
  );
  const engine = new Engine(store, publish, sender, now);
  return {
    store,
    service,
    p,
    dest,
    event,
    deliveryId,
    jobs,
    publish,
    sender,
    engine,
    advance: (ms: number) => {
      time += ms;
    },
    now,
  };
}
describe('delivery and recovery', () => {
  it('leaves due work recoverable when the reconciliation time budget is exhausted', async () => {
    const s = await setup();
    await s.engine.reconcile(0);
    expect(s.publish).not.toHaveBeenCalled();
    expect((await s.store.due(s.now())).items).toHaveLength(1);
    await s.engine.reconcile();
    expect(s.publish).toHaveBeenCalledOnce();
  });
  it('recovers a successful HTTP response whose outcome could not be committed', async () => {
    const s = await setup();
    s.sender.mockImplementationOnce(async () => {
      s.store.failNext = true;
      return { status: 200 };
    });
    await expect(s.engine.process({ deliveryId: s.deliveryId, generation: 1 })).rejects.toThrow(
      'INJECTED',
    );
    expect((await s.store.get<Delivery>(s.deliveryId))?.status).toBe('processing');
    s.advance(31000);
    await s.engine.reconcile();
    await s.engine.process(s.jobs.at(-1)!);
    expect((await s.store.get<Attempt>(s.deliveryId + '#1'))?.result).toBe('unknown');
    expect((await s.store.get<Delivery>(s.deliveryId))?.status).toBe('delivered');
    expect(s.sender).toHaveBeenCalledTimes(2);
  });
  it('recovers acceptance without enqueue, signs requests and suppresses duplicates', async () => {
    const s = await setup();
    await s.engine.reconcile();
    expect(s.jobs).toHaveLength(1);
    await Promise.all([s.engine.process(s.jobs[0]!), s.engine.process(s.jobs[0]!)]);
    expect(s.sender).toHaveBeenCalledTimes(1);
    expect((await s.store.get<Delivery>(s.deliveryId))?.status).toBe('delivered');
    await s.engine.process(s.jobs[0]!);
    expect(s.sender).toHaveBeenCalledTimes(1);
  });
  it('recovers publication failure and retries without accepting obsolete generations', async () => {
    const s = await setup();
    s.publish.mockRejectedValueOnce(new Error('SQS down'));
    await expect(s.engine.enqueue(s.deliveryId)).rejects.toThrow();
    await s.engine.reconcile();
    const old = s.jobs[0]!;
    s.sender.mockResolvedValueOnce({ status: 503 });
    s.publish.mockRejectedValueOnce(new Error('SQS down'));
    await expect(s.engine.process(old)).rejects.toThrow();
    expect((await s.store.get<Delivery>(s.deliveryId))?.status).toBe('retrying');
    await s.engine.process(old);
    expect(s.sender).toHaveBeenCalledTimes(1);
    s.advance(10000);
    await s.engine.reconcile();
    await s.engine.process(s.jobs.at(-1)!);
    expect((await s.store.get<Delivery>(s.deliveryId))?.status).toBe('delivered');
    expect((await s.store.list<Attempt>(s.deliveryId, 'ATTEMPT#')).items).toHaveLength(2);
  });
  it('handles enqueue succeeding before the status write fails', async () => {
    const s = await setup();
    s.store.failNext = true;
    await expect(s.engine.enqueue(s.deliveryId)).rejects.toThrow();
    await s.engine.reconcile();
    expect(s.jobs).toHaveLength(2);
    await s.engine.process(s.jobs[0]!);
    await s.engine.process(s.jobs[1]!);
    expect(s.sender).toHaveBeenCalledTimes(1);
  });
  it('records unknown outcomes after worker crash, then recovers the lease', async () => {
    const s = await setup();
    s.sender.mockRejectedValueOnce(new Error('Worker crash'));
    await expect(s.engine.process({ deliveryId: s.deliveryId, generation: 1 })).rejects.toThrow();
    expect((await s.store.get<Delivery>(s.deliveryId))?.status).toBe('processing');
    s.advance(31000);
    await s.engine.reconcile();
    await s.engine.process(s.jobs.at(-1)!);
    expect((await s.store.get<Delivery>(s.deliveryId))?.status).toBe('delivered');
    expect((await s.store.get<Attempt>(s.deliveryId + '#1'))?.result).toBe('unknown');
  });
  it('exhausts six attempts and replay preserves failure history and has a fresh id', async () => {
    const s = await setup();
    s.sender.mockResolvedValue({ status: 503 });
    await s.engine.enqueue(s.deliveryId);
    for (let i = 0; i < 6; i++) {
      const job = s.jobs.at(-1)!;
      await s.engine.process(job);
      const d = (await s.store.get<Delivery>(s.deliveryId))!;
      if (i < 5) s.advance(d.nextAttemptAt - s.now());
    }
    expect(s.sender).toHaveBeenCalledTimes(6);
    expect((await s.store.get<Delivery>(s.deliveryId))?.status).toBe('failed');
    await expect(s.service.replay(s.deliveryId, 'bob', 'replay-1')).rejects.toMatchObject({
      status: 404,
    });
    const replay = await s.service.replay(s.deliveryId, 'alice', 'replay-1');
    expect((await s.service.replay(s.deliveryId, 'alice', 'replay-1')).pk).toBe(replay.pk);
    expect(replay.pk).not.toBe(s.deliveryId);
    expect(replay.originalDeliveryId).toBe(s.deliveryId);
    s.sender.mockResolvedValue({ status: 202 });
    await s.engine.enqueue(replay.pk);
    await s.engine.process(s.jobs.at(-1)!);
    expect((await s.store.get<Delivery>(replay.pk))?.status).toBe('delivered');
    expect((await s.store.get<Delivery>(s.deliveryId))?.status).toBe('failed');
    expect((await s.store.list(s.deliveryId, 'ATTEMPT#')).items).toHaveLength(6);
  });
  it('cancels pending deliveries after disable and does not permit URL mutation', async () => {
    const s = await setup();
    await s.service.updateDestination(s.dest.id, 'alice', { enabled: false });
    await s.engine.process({ deliveryId: s.deliveryId, generation: 1 });
    expect(s.sender).not.toHaveBeenCalled();
    expect((await s.store.get<Delivery>(s.deliveryId))?.status).toBe('cancelled');
  });
  it('rejects a resumed worker completion after lease recovery', async () => {
    const s = await setup();
    let finish!: (r: HttpResult) => void;
    s.sender.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = s.engine.process({ deliveryId: s.deliveryId, generation: 1 });
    await vi.waitFor(() => expect(s.sender).toHaveBeenCalledTimes(1));
    s.advance(31000);
    await s.engine.reconcile();
    await s.engine.process(s.jobs.at(-1)!);
    finish({ status: 400 });
    await first;
    expect((await s.store.get<Delivery>(s.deliveryId))?.status).toBe('delivered');
  });
});
