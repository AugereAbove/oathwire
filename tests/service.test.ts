import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { MemoryStore } from './memory.js';
import { Service } from '../packages/shared/src/service.js';
import { createApp } from '../apps/api/src/app.js';
import { type Counter, type EventRow } from '../packages/shared/src/model.js';
import { write } from '../packages/shared/src/store.js';
async function setup() {
  const store = new MemoryStore();
  const service = new Service(store, () => 1792756800000);
  const project = await service.createProject('alice', 'Store', '');
  const key = await service.createKey(project.pk, 'alice', 'Publisher');
  return { store, service, project, key };
}
const event = { type: 'order.created', data: { orderId: '1842', amount: 49.99 } };
describe('durable acceptance', () => {
  it('accepts zero matches and canonical concurrent idempotent submissions only once', async () => {
    const { store, service, key } = await setup();
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        service.publish(
          key.key,
          i % 2 ? { ...event, data: { amount: 49.99, orderId: '1842' } } : event,
          'order-1',
        ),
      ),
    );
    expect(new Set(results.map((e) => e.pk)).size).toBe(1);
    expect(results[0]?.matchedDestinations).toBe(0);
    expect([...store.rows.values()].filter((r) => r.kind === 'event')).toHaveLength(1);
    await expect(
      service.publish(key.key, { ...event, data: { amount: 1 } }, 'order-1'),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('creates only subscribed enabled destinations and all five atomically', async () => {
    const { service, store, project, key } = await setup();
    for (let i = 0; i < 5; i++)
      await service.addDestination(project.pk, 'alice', {
        name: 'Receiver ' + i,
        url: 'https://receiver.example.org/hook',
        eventTypes: ['order.created'],
      });
    const e = await service.publish(key.key, event);
    expect(e.deliveryIds).toHaveLength(5);
    expect((await store.list(e.pk, 'DELIVERY#')).items).toHaveLength(5);
    const none = await service.publish(key.key, { ...event, type: 'payment.completed' });
    expect(none.matchedDestinations).toBe(0);
  });
  it('rolls back acceptance when persistence fails and never consumes quota', async () => {
    const { service, store, key } = await setup();
    store.failNext = true;
    await expect(service.publish(key.key, event)).rejects.toThrow('INJECTED');
    expect(
      [...store.rows.values()].filter((r) => r.kind === 'event' || r.pk.startsWith('QUOTA#')),
    ).toHaveLength(0);
  });
  it('enforces daily quota concurrently, revocation, archive and ownership', async () => {
    const { service, store, key, project } = await setup();
    await expect(service.owned(project.pk, 'bob')).rejects.toMatchObject({ status: 404 });
    const pk = 'QUOTA#' + project.pk + '#2026-10-23';
    await store.commit([write({ pk, kind: 'counter', version: 1, count: 999 } as Counter)]);
    const results = await Promise.allSettled([
      service.publish(key.key, event),
      service.publish(key.key, event),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await store.get<Counter>(pk))?.count).toBe(1000);
    await service.revokeKey(key.id, 'alice');
    await expect(service.publish(key.key, event)).rejects.toMatchObject({ status: 401 });
    const another = await service.createKey(project.pk, 'alice', 'New');
    await service.updateProject(project.pk, 'alice', { status: 'archived' });
    await expect(service.publish(another.key, event)).rejects.toMatchObject({ status: 403 });
  });
});
describe('HTTP boundary', () => {
  it('rejects malformed bodies, wrong content types, large requests and foreign resource access', async () => {
    const { service, key, project } = await setup();
    const app = createApp(
      service,
      async (t) => {
        if (t === 'alice' || t === 'bob') return t;
        throw new Error();
      },
      async () => {},
      'http://localhost:5173',
    );
    expect((await request(app).get('/v1/projects')).status).toBe(401);
    expect(
      (
        await request(app)
          .get('/v1/projects/' + project.pk)
          .auth('bob', { type: 'bearer' })
      ).status,
    ).toBe(404);
    expect(
      (await request(app).post('/v1/events').set('Content-Type', 'text/plain').send('x')).status,
    ).toBe(415);
    expect(
      (await request(app).post('/v1/events').set('Content-Type', 'application/json').send('{'))
        .status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post('/v1/events')
          .auth(key.key, { type: 'bearer' })
          .send({ ...event, data: { x: 'a'.repeat(17000) } })
      ).status,
    ).toBe(413);
    expect(
      (
        await request(app)
          .post('/v1/events')
          .auth(key.key, { type: 'bearer' })
          .send({ type: 'x', data: [] })
      ).status,
    ).toBe(422);
    const accepted = await request(app)
      .post('/v1/events')
      .auth(key.key, { type: 'bearer' })
      .send(event);
    expect(accepted.status).toBe(202);
    const id = accepted.body.id as string;
    expect(
      (
        await request(app)
          .get('/v1/events/' + id)
          .auth('bob', { type: 'bearer' })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .get('/v1/events/' + id)
          .auth('alice', { type: 'bearer' })
      ).body,
    ).not.toHaveProperty('requestHash');
    expect((await service.require<EventRow>(id)).type).toBe('order.created');
  });
});
