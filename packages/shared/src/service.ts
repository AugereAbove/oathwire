import { randomUUID } from 'node:crypto';
import {
  AppError,
  retentionSeconds,
  iso,
  type Project,
  type EventRow,
  type Delivery,
  type ApiKey,
  type Counter,
  type Idempotency,
  type Secret,
  type Row,
} from './model.js';
import { check, optimistic, write, type Store, type Write } from './store.js';
import {
  canonical,
  depth,
  eventSchema,
  hash,
  matches,
  randomSecret,
  destinationUrl,
} from './security.js';

export const id = (prefix: string) => prefix + '_' + randomUUID();
export class Service {
  constructor(
    public store: Store,
    public now: () => number = Date.now,
  ) {}
  async require<T extends Row>(pk: string): Promise<T> {
    const r = await this.store.get<T>(pk);
    if (!r || (r.expiresAt !== undefined && r.expiresAt <= this.now() / 1000))
      throw new AppError(404, 'NOT_FOUND', 'Resource not found.');
    return r;
  }
  async owned(projectId: string, owner: string): Promise<Project> {
    const p = await this.require<Project>(projectId);
    if (p.kind !== 'project' || p.ownerId !== owner)
      throw new AppError(404, 'NOT_FOUND', 'Resource not found.');
    return p;
  }
  async createProject(owner: string, name: string, description: string): Promise<Project> {
    return optimistic(async () => {
      const pk = 'ACCOUNT#' + owner;
      const count = await this.store.get<Counter>(pk);
      if ((count?.count ?? 0) >= 3)
        throw new AppError(
          429,
          'PROJECT_LIMIT',
          'Three projects per account are allowed, including archives.',
        );
      const createdAt = iso(this.now());
      const p: Project = {
        pk: id('prj'),
        kind: 'project',
        version: 1,
        ownerId: owner,
        name,
        description,
        status: 'active',
        createdAt,
        updatedAt: createdAt,
        destinations: [],
        keys: [],
        listPk: pk,
        listSk: 'PROJECT#' + createdAt + '#' + randomUUID(),
      };
      await this.store.commit([
        write(p),
        write(
          { pk, kind: 'counter', version: 1, count: (count?.count ?? 0) + 1 } as Counter,
          count,
        ),
      ]);
      return p;
    });
  }
  async updateProject(
    projectId: string,
    owner: string,
    patch: Partial<Pick<Project, 'name' | 'description' | 'status'>>,
  ) {
    return optimistic(async () => {
      const p = await this.owned(projectId, owner);
      if (p.status === 'archived')
        throw new AppError(409, 'ARCHIVED', 'Archived projects cannot be edited.');
      const next = { ...p, ...patch, updatedAt: iso(this.now()) };
      await this.store.commit([write(next, p)]);
      return next;
    });
  }
  async addDestination(
    projectId: string,
    owner: string,
    input: { name: string; url: string; eventTypes: string[] },
  ) {
    const url = destinationUrl(input.url).href;
    const secret = randomSecret();
    return optimistic(async () => {
      const p = await this.owned(projectId, owner);
      this.active(p);
      // Retired configurations count toward the cap to bound metadata and history.
      if (p.destinations.length >= 5)
        throw new AppError(
          429,
          'DESTINATION_LIMIT',
          'This project has reached its five-configuration limit.',
        );
      const now = iso(this.now());
      const d = {
        id: projectId + '~' + id('dst'),
        name: input.name,
        url,
        eventTypes: input.eventTypes,
        enabled: true,
        retired: false,
        createdAt: now,
        updatedAt: now,
      };
      await this.store.commit([
        write({ ...p, destinations: [...p.destinations, d] }, p),
        write({ pk: d.id, kind: 'secret', version: 1, value: secret } as Secret, undefined, true),
      ]);
      return { ...d, signingSecret: secret };
    });
  }
  async updateDestination(
    destinationId: string,
    owner: string,
    patch: { name?: string; enabled?: boolean; eventTypes?: string[]; retired?: boolean },
    rotate = false,
  ) {
    const secret = rotate ? randomSecret() : undefined;
    return optimistic(async () => {
      const p = await this.owned(destinationId.split('~')[0]!, owner);
      this.active(p);
      const d = p.destinations.find((d) => d.id === destinationId);
      if (!d || d.retired) throw new AppError(404, 'NOT_FOUND', 'Destination not found.');
      const next = { ...d, ...patch, updatedAt: iso(this.now()) };
      if (next.retired) next.enabled = false;
      const writes: Write[] = [
        write({ ...p, destinations: p.destinations.map((v) => (v.id === d.id ? next : v)) }, p),
      ];
      if (secret) {
        const previous = await this.store.get<Secret>(d.id, true);
        writes.push(
          write({ pk: d.id, kind: 'secret', version: 1, value: secret } as Secret, previous, true),
        );
      }
      await this.store.commit(writes);
      return { ...next, ...(secret ? { signingSecret: secret } : {}) };
    });
  }
  async createKey(projectId: string, owner: string, label: string) {
    const plaintext = 'ow_live_' + randomSecret();
    const keyId = 'key_' + hash(plaintext);
    return optimistic(async () => {
      const p = await this.owned(projectId, owner);
      this.active(p);
      if (p.keys.length >= 3)
        throw new AppError(429, 'KEY_LIMIT', 'Revoke an existing key before creating another.');
      const meta = { id: keyId, label, createdAt: iso(this.now()), revoked: false };
      await this.store.commit([
        write({ ...p, keys: [...p.keys, meta] }, p),
        write({ pk: keyId, kind: 'key', version: 1, projectId, revoked: false } as ApiKey),
      ]);
      return { ...meta, key: plaintext };
    });
  }
  async revokeKey(keyId: string, owner: string) {
    return optimistic(async () => {
      const key = await this.require<ApiKey>(keyId);
      if (key.kind !== 'key') throw new AppError(404, 'NOT_FOUND', 'Key not found.');
      const p = await this.owned(key.projectId, owner);
      await this.store.commit([
        write({ ...key, revoked: true }, key),
        write({ ...p, keys: p.keys.filter((k) => k.id !== keyId) }, p),
      ]);
    });
  }
  active(p: Project) {
    if (p.status !== 'active') throw new AppError(403, 'PROJECT_DISABLED', 'Project is archived.');
  }
  async publish(token: string, input: unknown, idem?: string): Promise<EventRow> {
    if (!/^ow_live_[A-Za-z0-9_-]{43}$/.test(token))
      throw new AppError(401, 'INVALID_KEY', 'Invalid API key.');
    if (depth(input) > 16)
      throw new AppError(422, 'INVALID_EVENT', 'JSON nesting exceeds 16 levels.');
    const parsed = eventSchema.safeParse(input);
    if (!parsed.success)
      throw new AppError(
        422,
        'INVALID_EVENT',
        'Supply a valid event type and an object data field.',
      );
    if (Buffer.byteLength(JSON.stringify(input)) > 16384)
      throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Payload exceeds 16 KiB.');
    if (idem !== undefined && !/^[\x21-\x7e]{1,128}$/.test(idem))
      throw new AppError(400, 'INVALID_IDEMPOTENCY_KEY', 'Use 1–128 visible ASCII characters.');
    const requestHash = hash(canonical(parsed.data));
    return optimistic(async () => {
      const key = await this.store.get<ApiKey>('key_' + hash(token));
      if (!key || key.revoked) throw new AppError(401, 'INVALID_KEY', 'Invalid API key.');
      const p = await this.require<Project>(key.projectId);
      this.active(p);
      const now = this.now();
      const expiresAt = Math.floor(now / 1000) + retentionSeconds;
      const idemId = idem ? 'IDEM#' + p.pk + '#' + hash(idem) : undefined;
      const old = idemId ? await this.store.get<Idempotency>(idemId) : undefined;
      if (old && (old.expiresAt ?? 0) > now / 1000) {
        if (old.requestHash !== requestHash)
          throw new AppError(
            409,
            'IDEMPOTENCY_CONFLICT',
            'This key was used with a different payload.',
          );
        return this.require<EventRow>(old.eventId);
      }
      const quotaId = 'QUOTA#' + p.pk + '#' + iso(now).slice(0, 10);
      const quota = await this.store.get<Counter>(quotaId);
      if ((quota?.count ?? 0) >= 1000)
        throw new AppError(429, 'DAILY_QUOTA', 'Daily project quota of 1,000 events reached.');
      const eventId = id('evt');
      const createdAt = iso(now);
      const ds = p.destinations.filter(
        (d) => d.enabled && !d.retired && matches(d.eventTypes, parsed.data.type),
      );
      const deliveries: Delivery[] = ds.map((d) => ({
        pk: id('del'),
        kind: 'delivery',
        version: 1,
        projectId: p.pk,
        eventId,
        destinationId: d.id,
        url: d.url,
        destinationPk: d.id,
        destinationSk: createdAt + '#' + randomUUID(),
        status: 'pending_enqueue',
        attemptCount: 0,
        generation: 1,
        createdAt,
        updatedAt: createdAt,
        nextAttemptAt: now,
        expiresAt,
        workPk: 'WORK',
        workAt: now,
        listPk: eventId,
        listSk: 'DELIVERY#' + d.id,
      }));
      const event: EventRow = {
        pk: eventId,
        kind: 'event',
        version: 1,
        projectId: p.pk,
        ...parsed.data,
        requestHash,
        createdAt,
        matchedDestinations: ds.length,
        deliveryIds: deliveries.map((d) => d.pk),
        expiresAt,
        listPk: p.pk,
        listSk: 'EVENT#' + createdAt + '#' + eventId,
      };
      const writes = [
        check(p),
        check(key),
        write(event),
        ...deliveries.map((d) => write(d)),
        write(
          {
            pk: quotaId,
            kind: 'counter',
            version: 1,
            count: (quota?.count ?? 0) + 1,
            expiresAt,
          } as Counter,
          quota,
        ),
      ];
      if (idemId)
        writes.push(
          write(
            {
              pk: idemId,
              kind: 'idempotency',
              version: 1,
              eventId,
              requestHash,
              expiresAt,
            } as Idempotency,
            old,
          ),
        );
      await this.store.commit(writes);
      return event;
    });
  }
  async replay(deliveryId: string, owner: string, requestKey: string) {
    if (!/^[\x21-\x7e]{1,128}$/.test(requestKey))
      throw new AppError(400, 'INVALID_IDEMPOTENCY_KEY', 'Replay requires an Idempotency-Key.');
    return optimistic(async () => {
      const original = await this.require<Delivery>(deliveryId);
      const p = await this.owned(original.projectId, owner);
      this.active(p);
      if (original.status !== 'failed')
        throw new AppError(409, 'NOT_REPLAYABLE', 'Only failed deliveries can be replayed.');
      const d = p.destinations.find(
        (d) => d.id === original.destinationId && d.enabled && !d.retired,
      );
      if (!d)
        throw new AppError(409, 'DESTINATION_DISABLED', 'Destination is disabled or retired.');
      const e = await this.require<EventRow>(original.eventId);
      const replayId = 'REPLAY#' + original.pk + '#' + hash(requestKey);
      const previous = await this.store.get<Idempotency>(replayId);
      if (previous && (previous.expiresAt ?? 0) > this.now() / 1000)
        return this.require<Delivery>(previous.eventId);
      const rateId = 'REPLAY_RATE#' + p.pk + '#' + Math.floor(this.now() / 60000);
      const rate = await this.store.get<Counter>(rateId);
      if ((rate?.count ?? 0) >= 5)
        throw new AppError(429, 'REPLAY_LIMIT', 'At most five replays per project per minute.');
      const now = this.now();
      const next: Delivery = {
        pk: id('del'),
        kind: 'delivery',
        version: 1,
        projectId: p.pk,
        eventId: e.pk,
        destinationId: d.id,
        url: d.url,
        destinationPk: d.id,
        destinationSk: iso(now) + '#' + randomUUID(),
        status: 'pending_enqueue',
        attemptCount: 0,
        generation: 1,
        createdAt: iso(now),
        updatedAt: iso(now),
        nextAttemptAt: now,
        expiresAt: e.expiresAt,
        originalDeliveryId: original.pk,
        workPk: 'WORK',
        workAt: now,
        listPk: e.pk,
        listSk: 'DELIVERY#' + iso(now) + '#' + randomUUID(),
      };
      await this.store.commit([
        check(p),
        check(original),
        check(e),
        write(next),
        write(
          {
            pk: replayId,
            kind: 'idempotency',
            version: 1,
            eventId: next.pk,
            requestHash: deliveryId,
            expiresAt: e.expiresAt,
          } as Idempotency,
          previous,
        ),
        write(
          {
            pk: rateId,
            kind: 'counter',
            version: 1,
            count: (rate?.count ?? 0) + 1,
            expiresAt: Math.floor(now / 1000) + 120,
          } as Counter,
          rate,
        ),
      ]);
      return next;
    });
  }
}
