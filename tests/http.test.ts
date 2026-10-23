import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }));
vi.mock('node:https', () => ({ default: { request: mocks.request } }));
import { send } from '../apps/worker/src/http.js';
beforeEach(() => {
  vi.resetAllMocks();
});
afterEach(() => vi.useRealTimers());
it('pins the validated address while retaining the TLS hostname and never reads the body', async () => {
  mocks.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
  const destroy = vi.fn();
  mocks.request.mockImplementation((url, options, respond) => {
    expect(url.hostname).toBe('receiver.example.org');
    expect(options.agent).toBe(false);
    expect(options.family).toBe(4);
    const cb = vi.fn();
    options.lookup('receiver.example.org', {}, cb);
    expect(cb).toHaveBeenCalledWith(null, '8.8.8.8', 4);
    const req = new EventEmitter();
    Object.assign(req, {
      end: () => respond({ statusCode: 301, headers: { location: 'https://127.0.0.1' }, destroy }),
    });
    return req;
  });
  expect(await send('https://receiver.example.org/hook', '{}', {})).toEqual({
    status: 301,
    retryAfter: undefined,
  });
  expect(mocks.request).toHaveBeenCalledOnce();
  expect(destroy).toHaveBeenCalledOnce();
});
it('rejects DNS answers containing even one blocked address before opening a socket', async () => {
  mocks.lookup.mockResolvedValue([
    { address: '8.8.8.8', family: 4 },
    { address: '169.254.169.254', family: 4 },
  ]);
  expect(await send('https://receiver.example.org', '{}', {})).toEqual({ code: 'UNSAFE_ADDRESS' });
  expect(mocks.request).not.toHaveBeenCalled();
});
it('includes DNS resolution in the absolute five-second deadline', async () => {
  vi.useFakeTimers();
  mocks.lookup.mockReturnValue(new Promise(() => {}));
  const pending = send('https://receiver.example.org', '{}', {});
  await vi.advanceTimersByTimeAsync(5001);
  expect(await pending).toEqual({ code: 'TIMEOUT' });
  expect(mocks.request).not.toHaveBeenCalled();
});
