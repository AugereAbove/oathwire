export function assessConcurrency({
  mode,
  total,
  unreserved,
  ownReserved = 0,
  foreignFunctions = [],
}) {
  if (!['reserved', 'shared-beta'].includes(mode))
    throw new Error('Select reserved or shared-beta.');
  if (![total, unreserved, ownReserved].every((n) => Number.isInteger(n) && n >= 0))
    throw new Error('Missing or invalid live concurrency settings.');
  if (unreserved > total || ownReserved > total - unreserved)
    throw new Error('Inconsistent live concurrency settings.');
  const blockers = [];
  if (mode === 'reserved') {
    if (unreserved + ownReserved < 106)
      blockers.push(
        'Need 100 unreserved plus six Oathwire reservations; request at least 106 total.',
      );
  } else {
    if (total !== 10 || unreserved !== 10 || ownReserved !== 0)
      blockers.push(
        'shared-beta requires the reviewed account quota and unreserved pool to both equal 10. Use reserved mode after a quota increase.',
      );
    if (foreignFunctions.length)
      blockers.push('shared-beta requires a dedicated region with no unrelated Lambda functions.');
  }
  return { mode, blockers, ready: blockers.length === 0 };
}
