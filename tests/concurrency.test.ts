import { describe, expect, it } from 'vitest';
// @ts-expect-error Deployment tooling is plain JavaScript, executed by Node in both CLI and CI.
import { assessConcurrency } from '../scripts/concurrency-policy.mjs';

describe('deployment concurrency admission', () => {
  it('rejects the small account under the reserved default', () => {
    expect(assessConcurrency({ mode: 'reserved', total: 10, unreserved: 10 }).ready).toBe(false);
    expect(assessConcurrency({ mode: 'reserved', total: 106, unreserved: 106 }).ready).toBe(true);
  });
  it('allows an update with the six existing application reservations', () => {
    expect(
      assessConcurrency({ mode: 'reserved', total: 106, unreserved: 100, ownReserved: 6 }).ready,
    ).toBe(true);
    expect(
      assessConcurrency({ mode: 'reserved', total: 106, unreserved: 100, ownReserved: 0 }).ready,
    ).toBe(false);
  });
  it('requires explicit low-quota mode and a dedicated pool of ten', () => {
    expect(assessConcurrency({ mode: 'shared-beta', total: 10, unreserved: 10 }).ready).toBe(true);
    expect(assessConcurrency({ mode: 'shared-beta', total: 1000, unreserved: 1000 }).ready).toBe(
      false,
    );
    expect(assessConcurrency({ mode: 'shared-beta', total: 10, unreserved: 9 }).ready).toBe(false);
    expect(
      assessConcurrency({
        mode: 'shared-beta',
        total: 10,
        unreserved: 10,
        foreignFunctions: ['other'],
      }).ready,
    ).toBe(false);
  });
  it('fails closed on invalid selection and incomplete or inconsistent AWS evidence', () => {
    expect(() => assessConcurrency({ total: 10, unreserved: 10 })).toThrow();
    expect(() => assessConcurrency({ mode: 'reserved', total: 106 })).toThrow();
    expect(() => assessConcurrency({ mode: 'reserved', total: 10, unreserved: 11 })).toThrow();
    expect(() =>
      assessConcurrency({ mode: 'reserved', total: 106, unreserved: 106, ownReserved: 6 }),
    ).toThrow();
  });
});
