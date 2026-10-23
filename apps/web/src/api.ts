import { auth } from './auth';
export async function api<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  idempotency?: string,
): Promise<T> {
  const user = await auth?.getUser();
  if (!user || user.expired)
    throw new Error('Your session has expired. Sign out and sign in again.');
  const res = await fetch((import.meta.env.VITE_API_URL ?? '') + '/v1' + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + user.access_token,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(idempotency ? { 'Idempotency-Key': idempotency } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? 'Request failed.');
  return data as T;
}
export interface Page<T> {
  items: T[];
  cursor?: string;
}
export interface Project {
  id: string;
  name: string;
  description: string;
  status: string;
}
export interface Destination {
  id: string;
  name: string;
  url: string;
  eventTypes: string[];
  enabled: boolean;
  retired: boolean;
}
export interface Key {
  id: string;
  label: string;
  createdAt: string;
}
export interface Event {
  id: string;
  type: string;
  createdAt: string;
  matchedDestinations: number;
  data: Record<string, unknown>;
  deliverySummary?: {
    delivered: number;
    failed: number;
    pending: number;
    cancelled: number;
    more: boolean;
  };
}
export interface Delivery {
  id: string;
  destinationId: string;
  url: string;
  status: string;
  attemptCount: number;
  lastHttpStatus?: number;
  lastErrorCode?: string;
  nextAttemptAt: number;
  originalDeliveryId?: string;
}
export interface Attempt {
  id: string;
  attemptNumber: number;
  result: string;
  httpStatus?: number;
  durationMs?: number;
  errorCode?: string;
  startedAt: string;
}
export interface Stats {
  scope: string;
  events: number;
  deliveries: number;
  delivered: number;
  failed: number;
  cancelled: number;
  pending: number;
}
