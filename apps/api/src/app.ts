import express, { type Request, type ErrorRequestHandler } from 'express';
import { z } from 'zod';
import {
  AppError,
  Conflict,
  type EventRow,
  type Delivery,
  type Attempt,
} from '../../../packages/shared/src/model.js';
import { Service } from '../../../packages/shared/src/service.js';
import { subscriptions } from '../../../packages/shared/src/security.js';

type Authenticate = (token: string) => Promise<string>;
const name = z.string().trim().min(1).max(80);
const projectBody = z.object({ name, description: z.string().max(300).default('') }).strict();
const destinationBody = z
  .object({ name, url: z.string().max(2048), eventTypes: subscriptions })
  .strict();
const param = (req: Request, key: string): string => {
  const v = req.params[key];
  if (typeof v !== 'string' || !/^[A-Za-z0-9_~#-]{1,180}$/.test(v))
    throw new AppError(400, 'INVALID_PARAMETER', 'Invalid resource identifier.');
  return v;
};
function cursor(req: Request): string | undefined {
  const value = req.query.cursor;
  if (
    value !== undefined &&
    (typeof value !== 'string' || value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value))
  )
    throw new AppError(400, 'INVALID_CURSOR', 'Invalid pagination cursor.');
  return value as string | undefined;
}
const bearer = (req: Request) => req.get('authorization')?.match(/^Bearer ([^ ]+)$/)?.[1] ?? '';
const accepted = (e: EventRow) => ({
  id: e.pk,
  status: 'accepted',
  matchedDestinations: e.matchedDestinations,
  createdAt: e.createdAt,
});
function publicRow<T extends object>(row: T) {
  const {
    pk,
    version: _v,
    listPk: _lp,
    listSk: _ls,
    workPk: _wp,
    workAt: _wa,
    destinationPk: _dp,
    destinationSk: _ds,
    leaseToken: _lt,
    requestHash: _rh,
    ...rest
  } = row as T & Record<string, unknown>;
  return { id: pk, ...rest };
}
export function createApp(
  service: Service,
  authenticate: Authenticate,
  enqueue: (id: string) => Promise<void>,
  origin: string,
) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const started = Date.now();
    res.on('finish', () =>
      console.info(
        JSON.stringify({
          action: 'api_request',
          status: res.statusCode,
          durationMs: Date.now() - started,
        }),
      ),
    );
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    if (req.get('origin') === origin) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key');
      res.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
      res.sendStatus(204);
      return;
    }
    next();
  });
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.use((req, _res, next) => {
    if (['POST', 'PATCH'].includes(req.method) && !req.is('application/json'))
      throw new AppError(415, 'UNSUPPORTED_CONTENT_TYPE', 'Use application/json.');
    next();
  });
  app.use(express.json({ limit: '16kb', strict: true }));
  app.post('/v1/events', async (req, res) => {
    const event = await service.publish(bearer(req), req.body, req.get('idempotency-key'));
    console.info(
      JSON.stringify({
        action: 'event_accepted',
        eventId: event.pk,
        matchedDestinations: event.matchedDestinations,
      }),
    );
    // Publication is an optimization; the transaction already contains durable due work.
    await Promise.all(
      event.deliveryIds.map(async (id) => {
        try {
          await enqueue(id);
        } catch {
          console.warn(JSON.stringify({ action: 'enqueue_deferred', deliveryId: id }));
        }
      }),
    );
    res.status(202).json(accepted(event));
  });
  app.use('/v1', async (req, res, next) => {
    if (!bearer(req)) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
    try {
      res.locals.owner = await authenticate(bearer(req));
    } catch {
      throw new AppError(401, 'UNAUTHENTICATED', 'Your session has expired. Sign in again.');
    }
    next();
  });
  app.get('/v1/me', (_req, res) => {
    res.json({ id: res.locals.owner });
  });
  app.get('/v1/projects', async (req, res) => {
    const page = await service.store.list('ACCOUNT#' + res.locals.owner, 'PROJECT#', cursor(req));
    res.json({ ...page, items: page.items.map(publicRow) });
  });
  app.post('/v1/projects', async (req, res) => {
    const b = projectBody.parse(req.body);
    res
      .status(201)
      .json(publicRow(await service.createProject(res.locals.owner, b.name, b.description)));
  });
  app.get('/v1/projects/:projectId', async (req, res) => {
    res.json(publicRow(await service.owned(param(req, 'projectId'), res.locals.owner)));
  });
  app.patch('/v1/projects/:projectId', async (req, res) => {
    res.json(
      publicRow(
        await service.updateProject(
          param(req, 'projectId'),
          res.locals.owner,
          projectBody.partial().parse(req.body),
        ),
      ),
    );
  });
  app.delete('/v1/projects/:projectId', async (req, res) => {
    await service.updateProject(param(req, 'projectId'), res.locals.owner, { status: 'archived' });
    res.sendStatus(204);
  });
  app.get('/v1/projects/:projectId/destinations', async (req, res) => {
    const p = await service.owned(param(req, 'projectId'), res.locals.owner);
    res.json({ items: p.destinations });
  });
  app.post('/v1/projects/:projectId/destinations', async (req, res) => {
    res
      .status(201)
      .json(
        await service.addDestination(
          param(req, 'projectId'),
          res.locals.owner,
          destinationBody.parse(req.body),
        ),
      );
  });
  app.get('/v1/destinations/:destinationId', async (req, res) => {
    const id = param(req, 'destinationId');
    const p = await service.owned(id.split('~')[0]!, res.locals.owner);
    const d = p.destinations.find((d) => d.id === id);
    if (!d) throw new AppError(404, 'NOT_FOUND', 'Destination not found.');
    res.json(d);
  });
  app.patch('/v1/destinations/:destinationId', async (req, res) => {
    res.json(
      await service.updateDestination(
        param(req, 'destinationId'),
        res.locals.owner,
        z
          .object({
            name: name.optional(),
            enabled: z.boolean().optional(),
            eventTypes: subscriptions.optional(),
          })
          .strict()
          .parse(req.body),
      ),
    );
  });
  app.get('/v1/destinations/:destinationId/deliveries', async (req, res) => {
    const id = param(req, 'destinationId');
    await service.owned(id.split('~')[0]!, res.locals.owner);
    const page = await service.store.destination<Delivery>(id, cursor(req));
    res.json({
      ...page,
      items: page.items.filter((d) => (d.expiresAt ?? 0) > service.now() / 1000).map(publicRow),
    });
  });
  app.delete('/v1/destinations/:destinationId', async (req, res) => {
    await service.updateDestination(param(req, 'destinationId'), res.locals.owner, {
      retired: true,
    });
    res.sendStatus(204);
  });
  app.post('/v1/destinations/:destinationId/rotate-secret', async (req, res) => {
    z.object({}).strict().parse(req.body);
    res.json(
      await service.updateDestination(param(req, 'destinationId'), res.locals.owner, {}, true),
    );
  });
  app.get('/v1/projects/:projectId/keys', async (req, res) => {
    res.json({ items: (await service.owned(param(req, 'projectId'), res.locals.owner)).keys });
  });
  app.post('/v1/projects/:projectId/keys', async (req, res) => {
    const b = z.object({ label: name }).strict().parse(req.body);
    res
      .status(201)
      .json(await service.createKey(param(req, 'projectId'), res.locals.owner, b.label));
  });
  app.delete('/v1/keys/:keyId', async (req, res) => {
    await service.revokeKey(param(req, 'keyId'), res.locals.owner);
    res.sendStatus(204);
  });
  app.get('/v1/projects/:projectId/events', async (req, res) => {
    const p = await service.owned(param(req, 'projectId'), res.locals.owner);
    const filters = z
      .object({
        type: z.string().max(100).optional(),
        hours: z.coerce.number().int().min(1).max(168).default(24),
      })
      .parse(req.query);
    const page = await service.store.list<EventRow>(p.pk, 'EVENT#', cursor(req));
    const items = page.items.filter(
      (e) =>
        (e.expiresAt ?? 0) > service.now() / 1000 &&
        Date.parse(e.createdAt) >= service.now() - filters.hours * 3600000 &&
        (!filters.type || e.type === filters.type),
    );
    const summaries = await Promise.all(
      items.map(async (e) => {
        const ds = await service.store.list<Delivery>(e.pk, 'DELIVERY#');
        const active = ds.items.filter((d) => (d.expiresAt ?? 0) > service.now() / 1000);
        return {
          ...publicRow(e),
          deliverySummary: {
            delivered: active.filter((d) => d.status === 'delivered').length,
            failed: active.filter((d) => d.status === 'failed').length,
            pending: active.filter((d) => !['delivered', 'failed', 'cancelled'].includes(d.status))
              .length,
            cancelled: active.filter((d) => d.status === 'cancelled').length,
            more: Boolean(ds.cursor),
          },
        };
      }),
    );
    res.json({ ...page, items: summaries });
  });
  const ownEvent = async (req: Request, owner: string) => {
    const e = await service.require<EventRow>(param(req, 'eventId'));
    if (e.kind !== 'event') throw new AppError(404, 'NOT_FOUND', 'Event not found.');
    await service.owned(e.projectId, owner);
    return e;
  };
  const ownDelivery = async (req: Request, owner: string) => {
    const d = await service.require<Delivery>(param(req, 'deliveryId'));
    if (d.kind !== 'delivery') throw new AppError(404, 'NOT_FOUND', 'Delivery not found.');
    await service.owned(d.projectId, owner);
    return d;
  };
  app.get('/v1/events/:eventId', async (req, res) => {
    res.json(publicRow(await ownEvent(req, res.locals.owner)));
  });
  app.get('/v1/events/:eventId/deliveries', async (req, res) => {
    const e = await ownEvent(req, res.locals.owner);
    const page = await service.store.list<Delivery>(e.pk, 'DELIVERY#', cursor(req));
    res.json({
      ...page,
      items: page.items.filter((d) => (d.expiresAt ?? 0) > service.now() / 1000).map(publicRow),
    });
  });
  app.get('/v1/deliveries/:deliveryId', async (req, res) => {
    res.json(publicRow(await ownDelivery(req, res.locals.owner)));
  });
  app.get('/v1/deliveries/:deliveryId/attempts', async (req, res) => {
    const d = await ownDelivery(req, res.locals.owner);
    const page = await service.store.list<Attempt>(d.pk, 'ATTEMPT#', cursor(req));
    res.json({ ...page, items: page.items.map(publicRow) });
  });
  app.post('/v1/deliveries/:deliveryId/replay', async (req, res) => {
    await ownDelivery(req, res.locals.owner);
    z.object({}).strict().parse(req.body);
    const d = await service.replay(
      param(req, 'deliveryId'),
      res.locals.owner,
      req.get('idempotency-key') ?? '',
    );
    try {
      await enqueue(d.pk);
    } catch {
      console.warn(JSON.stringify({ action: 'enqueue_deferred', deliveryId: d.pk }));
    }
    res.status(202).json(publicRow(d));
  });
  app.get('/v1/projects/:projectId/stats', async (req, res) => {
    const p = await service.owned(param(req, 'projectId'), res.locals.owner);
    const events = await service.store.list<EventRow>(p.pk, 'EVENT#');
    const active = events.items.filter((e) => (e.expiresAt ?? 0) > service.now() / 1000);
    const ds = (
      await Promise.all(active.map((e) => service.store.list<Delivery>(e.pk, 'DELIVERY#')))
    ).flatMap((p) => p.items);
    res.json({
      scope: 'Most recent 50 retained events; first 50 deliveries per event',
      events: active.length,
      deliveries: ds.length,
      delivered: ds.filter((d) => d.status === 'delivered').length,
      failed: ds.filter((d) => d.status === 'failed').length,
      cancelled: ds.filter((d) => d.status === 'cancelled').length,
      pending: ds.filter((d) => !['delivered', 'failed', 'cancelled'].includes(d.status)).length,
    });
  });
  app.use((_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Route not found.')));
  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    let error: AppError;
    if (err instanceof AppError) error = err;
    else if (err instanceof z.ZodError)
      error = new AppError(422, 'INVALID_REQUEST', err.issues[0]?.message ?? 'Invalid request.');
    else if (err instanceof Conflict)
      error = new AppError(503, 'BUSY', 'Concurrent changes; retry the request.');
    else if (err?.type === 'entity.too.large')
      error = new AppError(413, 'PAYLOAD_TOO_LARGE', 'Payload exceeds 16 KiB.');
    else if (err?.type === 'entity.parse.failed')
      error = new AppError(400, 'INVALID_JSON', 'Malformed JSON.');
    else if (err?.type === 'charset.unsupported' || err?.type === 'encoding.unsupported')
      error = new AppError(415, 'UNSUPPORTED_ENCODING', 'Use UTF-8 JSON without content encoding.');
    else if (err?.message === 'INVALID_CURSOR')
      error = new AppError(400, 'INVALID_CURSOR', 'Invalid pagination cursor.');
    else {
      console.error(JSON.stringify({ action: 'api_error', category: 'INTERNAL' }));
      error = new AppError(503, 'UNAVAILABLE', 'The service is temporarily unavailable.');
    }
    res.status(error.status).json({ error: { code: error.code, message: error.message } });
  };
  app.use(errorHandler);
  return app;
}
