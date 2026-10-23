import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { z } from 'zod';
import { AppError } from './model.js';
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const randomSecret = () => randomBytes(32).toString('base64url');
export const eventType = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
export const eventSchema = z
  .object({ type: eventType, data: z.record(z.string(), z.unknown()) })
  .strict();
export const subscriptions = z
  .array(z.union([z.literal('*'), eventType]))
  .min(1)
  .max(50)
  .refine((v) => !v.includes('*') || v.length === 1, 'Use * alone.');
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k]))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export function depth(value: unknown, level = 0): number {
  if (level > 16) return level;
  if (value && typeof value === 'object')
    return Math.max(level, ...Object.values(value).map((v) => depth(v, level + 1)));
  return level;
}
export function destinationUrl(input: string): URL {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    throw new AppError(422, 'UNSAFE_DESTINATION', 'Enter a public HTTPS URL.');
  }
  const h = u.hostname.toLowerCase();
  if (
    u.protocol !== 'https:' ||
    u.username ||
    u.password ||
    u.hash ||
    (u.port && u.port !== '443') ||
    isIP(h) ||
    h.includes(':') ||
    (/^\d/.test(h) && /^[0-9.]+$/.test(h)) ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(h) ||
    /\.(localhost|local|internal|home|lan|test|invalid|example|onion)$/.test(h) ||
    h === 'localhost' ||
    h === 'metadata.google.internal'
  )
    throw new AppError(
      422,
      'UNSAFE_DESTINATION',
      'Use a public HTTPS hostname on port 443 without credentials or fragments.',
    );
  return u;
}
export function publicAddress(address: string): boolean {
  try {
    const addr = ipaddr.parse(address);
    return (
      addr.range() === 'unicast' &&
      (addr.kind() === 'ipv4' || addr.match(ipaddr.parse('2000::'), 3))
    );
  } catch {
    return false;
  }
}
export function sign(secret: string, timestamp: string, body: string): string {
  return (
    'v1=' +
    createHmac('sha256', secret)
      .update(timestamp + '.' + body)
      .digest('hex')
  );
}
export function verify(
  secret: string,
  timestamp: string,
  body: string,
  signature: string,
  now = Date.now(),
): boolean {
  if (
    !/^\d{10,}$/.test(timestamp) ||
    Math.abs(now / 1000 - Number(timestamp)) > 300 ||
    !/^v1=[a-f0-9]{64}$/.test(signature)
  )
    return false;
  return timingSafeEqual(Buffer.from(sign(secret, timestamp, body)), Buffer.from(signature));
}
export const matches = (types: string[], type: string) =>
  types.includes('*') || types.includes(type);
export function outcome(status?: number, code?: string): 'delivered' | 'retryable' | 'failed' {
  if (status !== undefined) {
    if (status >= 200 && status < 300) return 'delivered';
    return [408, 425, 429].includes(status) || (status >= 500 && status <= 599)
      ? 'retryable'
      : 'failed';
  }
  return [
    'TIMEOUT',
    'ECONNRESET',
    'ECONNREFUSED',
    'EAI_AGAIN',
    'ENETUNREACH',
    'EHOSTUNREACH',
    'ETIMEDOUT',
  ].includes(code ?? '')
    ? 'retryable'
    : 'failed';
}
export const retryDelays = [10, 30, 90, 300, 900];
export function retryDelay(attempt: number, retryAfter?: string, now = Date.now()): number {
  const base = retryDelays[attempt - 1] ?? 900;
  if (!retryAfter) return base;
  const seconds = /^\d+$/.test(retryAfter)
    ? Number(retryAfter)
    : (Date.parse(retryAfter) - now) / 1000;
  return Number.isFinite(seconds) ? Math.min(900, Math.max(base, Math.ceil(seconds))) : base;
}
