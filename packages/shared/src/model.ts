export type Status =
  'pending_enqueue' | 'queued' | 'processing' | 'retrying' | 'delivered' | 'failed' | 'cancelled';
export interface Row {
  pk: string;
  version: number;
  kind: string;
  expiresAt?: number;
  listPk?: string;
  listSk?: string;
  workPk?: string;
  workAt?: number;
  destinationPk?: string;
  destinationSk?: string;
}
export interface Destination {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  retired: boolean;
  eventTypes: string[];
  createdAt: string;
  updatedAt: string;
}
export interface KeyInfo {
  id: string;
  label: string;
  createdAt: string;
  revoked: boolean;
}
export interface Project extends Row {
  kind: 'project';
  ownerId: string;
  name: string;
  description: string;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
  destinations: Destination[];
  keys: KeyInfo[];
}
export interface EventRow extends Row {
  kind: 'event';
  projectId: string;
  type: string;
  data: Record<string, unknown>;
  createdAt: string;
  matchedDestinations: number;
  deliveryIds: string[];
  requestHash: string;
}
export interface Delivery extends Row {
  kind: 'delivery';
  projectId: string;
  eventId: string;
  destinationId: string;
  url: string;
  status: Status;
  attemptCount: number;
  generation: number;
  createdAt: string;
  updatedAt: string;
  nextAttemptAt: number;
  leaseToken?: string;
  leaseExpiresAt?: number;
  lastHttpStatus?: number;
  lastErrorCode?: string;
  originalDeliveryId?: string;
}
export interface Attempt extends Row {
  kind: 'attempt';
  deliveryId: string;
  attemptNumber: number;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  httpStatus?: number;
  result: 'in_progress' | 'delivered' | 'retryable' | 'failed' | 'unknown';
  errorCode?: string;
}
export interface ApiKey extends Row {
  kind: 'key';
  projectId: string;
  revoked: boolean;
}
export interface Secret extends Row {
  kind: 'secret';
  value: string;
}
export interface Idempotency extends Row {
  kind: 'idempotency';
  requestHash: string;
  eventId: string;
}
export interface Counter extends Row {
  kind: 'counter';
  count: number;
}
export interface QueueJob {
  deliveryId: string;
  generation: number;
}
export const retentionSeconds = 7 * 86400;
export const terminal = (s: Status) => ['delivered', 'failed', 'cancelled'].includes(s);
export const iso = (ms: number) => new Date(ms).toISOString();
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export class Conflict extends Error {}
