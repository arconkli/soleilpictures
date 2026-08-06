// Scout — grouping the Bin into "runs".
//
// The problem this exists to solve: someone scouts on Monday and sends 14
// photos, forgets about them, then on Thursday sends 6 photos of a diner and
// says "put these in Diner Recce". If "these" means the whole Bin, 20 cards move
// and 14 of them are wrong — and because filing runs a colour-ordered layout,
// the strays are interleaved by hue rather than sitting in a contiguous block,
// so un-picking them by hand is genuinely painful.
//
// "These" therefore means THE CURRENT RUN: everything since the last filing,
// broken by a long silence. Eight hours because a scouting day has long gaps in
// it — lunch, a drive, a two-hour walkthrough — and none of those should split a
// day, while every overnight should.
//
// Pure functions over card objects. No I/O, no dates from the environment
// (callers pass `now`), so this is fully testable.

export const RUN_GAP_MS = 8 * 60 * 60 * 1000;

const ts = (card) => {
  const t = Date.parse(card?.createdAt || '');
  return Number.isFinite(t) ? t : null;
};

// Split cards into runs, oldest first. Each run is
// { startedAt, endedAt, cards } with millisecond timestamps.
//
// A card with no parseable createdAt — one the user added by hand in the app, or
// anything predating this code — sorts to the very beginning and therefore never
// lands in the current run. That's the conservative direction on purpose: the
// failure mode we care about is moving something the user didn't expect, so
// unknown age means "not what you just sent".
export function groupIntoRuns(cards, { gapMs = RUN_GAP_MS } = {}) {
  const list = (cards || []).filter(Boolean);
  if (!list.length) return [];

  const sorted = list
    .map((c) => ({ card: c, t: ts(c) }))
    .sort((a, b) => {
      if (a.t === b.t) return 0;
      if (a.t === null) return -1;
      if (b.t === null) return 1;
      return a.t - b.t;
    });

  const runs = [];
  let cur = null;
  for (const { card, t } of sorted) {
    // A long silence starts a new run…
    const gapBreak = t !== null && cur?.endedAt !== null && cur && t - cur.endedAt > gapMs;
    // …and so does the transition out of the undated group. Undated cards sort
    // first and must stay in their OWN run: letting the first real photo join
    // them would drag a hand-added card into "what you just sent", which is
    // exactly the surprise this module exists to prevent.
    const dateBreak = t !== null && cur !== null && cur.endedAt === null;

    if (!cur || gapBreak || dateBreak) {
      cur = { startedAt: t, endedAt: t, cards: [] };
      runs.push(cur);
    }
    cur.cards.push(card);
    if (t !== null) {
      if (cur.startedAt === null) cur.startedAt = t;
      cur.endedAt = t;
    }
  }
  return runs;
}

// The run "put these in X" refers to — the most recent one.
export function currentRun(runs) {
  return runs?.length ? runs[runs.length - 1] : null;
}

// Everything that is NOT the current run, i.e. what stays behind and therefore
// what the confirmation has to tell the user about.
export function olderRuns(runs) {
  return runs?.length > 1 ? runs.slice(0, -1) : [];
}

// Human label for a run, relative to `now`.
//
// Deliberately elapsed-time rather than calendar for the first week: we don't
// know the user's timezone (Photon reports a country, which is not the same
// thing), and "Today" is a claim that's wrong for anyone shooting past midnight.
// "3 hours ago" is true in every timezone. Past a week the exact day stops
// mattering and a short date reads better, accepting a few hours of slop at the
// boundary.
export function runLabel(run, now = Date.now()) {
  const t = run?.endedAt;
  if (t === null || t === undefined) return 'earlier';

  const mins = Math.round((now - t) / 60_000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;

  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;

  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;

  return new Date(t).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', timeZone: 'UTC',
  });
}

// Count only the cards a user would call "photos" — a section header is our
// bookkeeping, and telling someone we're about to move 7 things when they can
// see 6 photos is the kind of small lie that costs trust in a confirmation.
export function countable(cards) {
  return (cards || []).filter((c) => c && !c.sectionHeader);
}
