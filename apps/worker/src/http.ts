import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { destinationUrl, publicAddress } from '../../../packages/shared/src/security.js';
export interface HttpResult {
  status?: number;
  code?: string;
  retryAfter?: string;
}
export type Sender = (
  url: string,
  body: string,
  headers: Record<string, string>,
) => Promise<HttpResult>;
export const send: Sender = async (url, body, headers) => {
  // The absolute deadline includes DNS, connection, TLS and response headers.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const u = destinationUrl(url);
    const addresses = await Promise.race([
      lookup(u.hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) =>
        controller.signal.addEventListener('abort', () => reject(new Error('TIMEOUT')), {
          once: true,
        }),
      ),
    ]);
    if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
      return { code: 'UNSAFE_ADDRESS' };
    if (controller.signal.aborted) return { code: 'TIMEOUT' };
    const selected = addresses[0]!;
    return await new Promise<HttpResult>((resolve) => {
      const req = https.request(
        u,
        {
          method: 'POST',
          agent: false,
          family: selected.family,
          signal: controller.signal,
          headers: { ...headers, 'Content-Length': String(Buffer.byteLength(body)) },
          // A new socket uses only this validated address; hostname is retained for SNI/cert checks.
          lookup: (_hostname, _options, callback) =>
            callback(null, selected.address, selected.family),
        },
        (res) => {
          resolve({ status: res.statusCode, retryAfter: res.headers['retry-after'] });
          res.destroy(); // No endpoint response body is needed or persisted.
        },
      );
      req.on('error', (e: NodeJS.ErrnoException) =>
        resolve({ code: controller.signal.aborted ? 'TIMEOUT' : (e.code ?? 'NETWORK_ERROR') }),
      );
      req.end(body);
    });
  } catch (e) {
    return {
      code: controller.signal.aborted
        ? 'TIMEOUT'
        : e && typeof e === 'object' && 'code' in e
          ? String(e.code)
          : 'INVALID_DESTINATION',
    };
  } finally {
    clearTimeout(timer);
  }
};
