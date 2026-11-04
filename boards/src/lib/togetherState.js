// What the app knows about working together right now, folded from the board
// room's once-a-minute message (lib/liveTogether.js togetherMessage). Pure, so
// it is tested (togetherState.test.mjs); useTogether.js feeds it.

// The room speaks every minute: two missed ticks and it's over.
export const TOGETHER_STALE_MS = 150_000;
export const TOGETHER_OFF = Object.freeze({ on: false });

// `m` is readTogether's answer (or null); `now` in ms.
export function togetherReduce(prev, m, now) {
  if (!m || m.on === false) return TOGETHER_OFF;
  const fresh = !prev || !prev.on || now - prev.at > TOGETHER_STALE_MS;
  const common = {
    on: true, at: now, peers: m.peers, boost: m.boost, month: m.month,
    cap: m.cap, capped: m.capped, progress: m.progress, roomEarned: m.earned,
  };
  if (fresh) {
    return { ...common, since: now, startedCapped: m.capped && m.earned === 0, base: 0, earned: m.earned };
  }
  // A lower count is a new room that forgot the stretch, not fewer cards.
  const base = prev.base + (m.earned < prev.roomEarned ? prev.roomEarned : 0);
  // Begun at the cap, it shows once a new month lets it earn again.
  return { ...common, since: prev.since, startedCapped: prev.startedCapped && m.capped, base, earned: base + m.earned };
}

// Show the chip: on, not stale, and the stretch didn't begin at the month's cap.
export function togetherShown(state, now) {
  if (!state || !state.on) return false;
  if (now - state.at > TOGETHER_STALE_MS) return false;
  return !state.startedCapped;
}
