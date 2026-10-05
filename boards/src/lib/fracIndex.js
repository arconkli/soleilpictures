// Fractional indexing — order keys that survive concurrent edits.
//
// A rundown is an ORDERED list stored in a flat Y.Map, so every item needs a
// sort key, and inserting between two neighbours must not touch either of them.
// An integer position would: dropping a row between 3 and 4 renumbers the tail,
// which in a CRDT is a write per row and a merge conflict per collaborator.
//
// Why strings rather than a numeric midpoint. Floats run out of room after
// about fifty inserts in the same gap — halving the distance between 0.5 and
// 0.5000000000000001 eventually lands on equality, and two rows with the same
// key have no defined order. That shows up as a row that jumps somewhere else
// after a reload, which is essentially impossible to reproduce on purpose. A
// string index can always grow another character, so a midpoint always exists.
//
// Keys sort with plain `<`, which is what the Y.Map scan already does.
//
// THE INVARIANT THAT MAKES IT WORK: a key never ends in the lowest digit. You
// cannot go below '0' by appending — appending always makes a string GREATER —
// so a key ending in '0' would have no predecessor. Every branch below is
// arranged to never emit one.

// base62 in ASCII order, so string comparison IS numeric comparison.
const D = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = D.length;

const val = (ch) => D.indexOf(ch);
const isKey = (s) => typeof s === 'string' && s.length > 0 && [...s].every((c) => D.includes(c));

// A key strictly between a and b. Either bound may be null for an open end:
// between(null, x) prepends, between(x, null) appends, between(null, null) is
// the first key in an empty list. Anything that isn't a valid key — undefined,
// '', a number — is treated as an open end rather than throwing, so a caller
// reading a half-written record doesn't crash.
//
// Throws only on a >= b. An out-of-order pair means the caller's neighbours are
// wrong, and inventing a key would bury that as a row that silently lands
// somewhere else.
export function between(a = null, b = null) {
  const lo = isKey(a) ? a : null;
  const hi = isKey(b) ? b : null;
  if (lo !== null && hi !== null && lo >= hi) {
    throw new Error(`fracIndex: bounds out of order (${lo} >= ${hi})`);
  }

  let out = '';
  for (let i = 0; ; i++) {
    // Past the end of the lower bound reads as digit 0 — every longer string
    // starting with lo's characters is above lo. Past the end of the upper
    // bound reads as BASE, which can only happen when hi is null: if hi ran out
    // while still matching, hi would be a prefix of lo and lo >= hi, already
    // rejected above.
    const x = (lo !== null && i < lo.length) ? val(lo[i]) : 0;
    const y = (hi !== null && i < hi.length) ? val(hi[i]) : BASE;

    if (x + 1 < y) {
      // Room between them. The midpoint is > x, so it is only 0 when x is 0 and
      // y is 1 — which this branch has already excluded. The invariant holds.
      return out + D[Math.floor((x + y) / 2)];
    }
    // Equal or adjacent digits: keep the lower bound's digit and look deeper.
    // Once lo is exhausted this appends '0', and the next round has x = 0
    // against y = BASE, which always terminates.
    out += (lo !== null && i < lo.length) ? lo[i] : D[0];
  }
}

// n keys in order, for seeding a list in one pass. Spread across the digit
// space so there is room to insert between any two afterwards without
// immediately growing the keys — n calls to between() would nest a character
// deeper every time.
export function sequence(n) {
  const count = Math.max(0, Math.min(4000, Math.floor(n) || 0));
  if (count === 0) return [];
  if (count <= BASE - 1) {
    // Digits 1..BASE-1, evenly spaced. Never 0 (the reserved floor).
    return Array.from({ length: count },
      (_, i) => D[1 + Math.floor((i * (BASE - 1)) / count)]);
  }
  const out = [];
  let prev = null;
  for (let i = 0; i < count; i++) { prev = between(prev, null); out.push(prev); }
  return out;
}

export const isFracKey = isKey;
