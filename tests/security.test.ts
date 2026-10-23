import { describe, it, expect } from 'vitest';
import {
  destinationUrl,
  publicAddress,
  sign,
  verify,
  outcome,
  retryDelay,
  depth,
} from '../packages/shared/src/security.js';
describe('security boundaries', () => {
  it.each([
    'http://example.org',
    'file:///etc/passwd',
    'https://localhost',
    'https://127.1',
    'https://0x7f000001',
    'https://2130706433',
    'https://[::1]',
    'https://10.0.0.1',
    'https://169.254.169.254',
    'https://user:pass@example.org',
    'https://example.org:8443',
    'https://foo.internal',
    'https://example.org/#x',
  ])('rejects unsafe URL %s', (url) => {
    expect(() => destinationUrl(url)).toThrow();
  });
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '172.16.1.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:8.8.8.8',
    '2001:db8::1',
    '2002:0808:0808::',
  ])('rejects blocked address %s', (ip) => {
    expect(publicAddress(ip)).toBe(false);
  });
  it('accepts public addresses and public HTTPS names', () => {
    expect(publicAddress('8.8.8.8')).toBe(true);
    expect(publicAddress('2606:4700:4700::1111')).toBe(true);
    expect(destinationUrl('https://receiver.example.org/hook').protocol).toBe('https:');
  });
  it('verifies exact bytes, signature format and timestamp tolerance', () => {
    const now = 1792756800000,
      t = String(now / 1000),
      body = '{"x":1}';
    const sig = sign('secret', t, body);
    expect(verify('secret', t, body, sig, now)).toBe(true);
    expect(verify('secret', t, body + ' ', sig, now)).toBe(false);
    expect(verify('secret', t, body, sig, now + 301000)).toBe(false);
    expect(verify('secret', t, body, 'bad', now)).toBe(false);
  });
  it('classifies failures and bounds retry-after', () => {
    for (const status of [200, 202, 299]) expect(outcome(status)).toBe('delivered');
    for (const status of [408, 425, 429, 500, 503]) expect(outcome(status)).toBe('retryable');
    for (const status of [301, 400, 401, 404]) expect(outcome(status)).toBe('failed');
    expect(outcome(undefined, 'CERT_HAS_EXPIRED')).toBe('failed');
    expect(outcome(undefined, 'TIMEOUT')).toBe('retryable');
    expect([1, 2, 3, 4, 5].map((n) => retryDelay(n))).toEqual([10, 30, 90, 300, 900]);
    expect(retryDelay(1, '999999')).toBe(900);
    expect(retryDelay(1, 'nonsense')).toBe(10);
  });
  it('detects excessive nesting without recursion overflow', () => {
    let value: unknown = {};
    for (let i = 0; i < 100; i++) value = { x: value };
    expect(depth(value)).toBeGreaterThan(16);
  });
});
