// When saveBoardSnapshot (boardsApi.js) may put a board's whole document into
// board_state. Kept free of imports so node tests can drive it.
//
// Under PartyKit the board's room is the authoritative writer, so the client's
// own upsert is only a backstop: it confirms a write often enough to clear the
// local draft. It must never pile up. On 2026-10-17 at 09:30 UTC one tab editing
// a doc on a 1.1 MB board sent 168 upserts of that row in five minutes. The
// database had slowed, the write on the wire had not confirmed yet, so every
// 250ms tick of typing was due again and started another one behind the first
// one's row lock. 73 hit the 8s statement timeout, a failure never confirms,
// and the retries kept coming until every other writer timed out with them.
//
// So a backstop now waits for three things: a minute since the last confirmed
// write, no write of this board still on the wire, and a short pause after a
// failure. Every other write (pagehide, flushNow, destroy, detached docs, the
// Supabase transport) is due every time, as before.

export const STATE_BACKSTOP_MS = 60_000;
export const STATE_RETRY_MS = 15_000;

export function createStateWriteGate({ backstopMs = STATE_BACKSTOP_MS, retryMs = STATE_RETRY_MS } = {}) {
  const lastWrite = new Map();   // boardId → when the last confirmed write started
  const failedAt = new Map();    // boardId → when the last write failed
  const inFlight = new Map();    // boardId → board_state upserts on the wire
  return {
    due(boardId, { backstop }, now = Date.now()) {
      if (!backstop) return true;
      if (inFlight.get(boardId)) return false;
      if (now - (failedAt.get(boardId) || 0) < retryMs) return false;
      return now - (lastWrite.get(boardId) || 0) >= backstopMs;
    },
    start(boardId) {
      inFlight.set(boardId, (inFlight.get(boardId) || 0) + 1);
    },
    // startedAt, not now: the confirmed write covers the doc as it was encoded.
    settle(boardId, { ok, startedAt }, now = Date.now()) {
      const left = (inFlight.get(boardId) || 1) - 1;
      if (left > 0) inFlight.set(boardId, left); else inFlight.delete(boardId);
      if (ok) { lastWrite.set(boardId, startedAt); failedAt.delete(boardId); }
      else failedAt.set(boardId, now);
    },
  };
}
