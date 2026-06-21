// Presence / collaboration tuning — the single source of truth for the knobs
// that govern how realtime "feels at scale". Mirrors SNAP_TUNING
// (lib/snapGuides.js) and ARROW_TUNING (lib/arrowGeometry.js): one frozen
// object, with bare-const aliases at call sites to keep them terse. Pure and
// dependency-free so it unit-tests straight in the Playwright node process
// (?presenceqa logic spec).
//
// Design target: behave EXACTLY like the historical small-room defaults at low
// peer counts, while CAPPING every per-frame / per-event cost so collaboration
// degrades gracefully as the number of people in a board/workspace grows —
// instead of falling off a cliff. Every "at scale" change reads from here.

export const PRESENCE_TUNING = Object.freeze({
  // ── Cursor SEND throttle (CanvasSurface awareness writes) ────────────────
  // At/under CURSOR_SMALL_ROOM peers the interval is exactly the historical
  // 16ms (one write per frame) — nothing changes for the common case. Above
  // it the interval widens linearly toward CURSOR_MAX_MS, cutting the O(N^2)
  // cursor fan-out as a room fills. Unit test pins the small-N no-op.
  CURSOR_MIN_MS: 16,           // historical per-frame cadence (<= SMALL_ROOM)
  CURSOR_MAX_MS: 120,          // widest cadence in a very crowded room
  CURSOR_SMALL_ROOM: 6,        // peer count at/under which cadence stays 16ms
  CURSOR_FULL_ROOM: 40,        // peer count at/above which cadence hits the max

  // ── Cursor RENDER cap + cull (CanvasPresence) ────────────────────────────
  CURSOR_RENDER_CAP: 20,       // max simultaneously-rendered peer cursors
  CURSOR_CULL_MARGIN_PX: 120,  // screen-px viewport expansion; cursors beyond
                               //   this are dropped from render (still counted)

  // ── Peer-selection ring stylesheet caps (PeerSelectionStyles) ────────────
  SELECTION_PEER_CAP: 12,      // max peers whose selection rings are drawn
  SELECTION_RULE_CAP: 200,     // hard cap on injected CSS rules (ring blowups)

  // ── Spectator mode (stop broadcasting OWN cursor in a crowd) ─────────────
  // Hysteresis: enter at ON, leave at OFF (< ON) so a room hovering at the
  // boundary doesn't flap your own cursor on and off for everyone else.
  SPECTATOR_ON: 30,            // own-cursor broadcast suppressed at/above this
  SPECTATOR_OFF: 24,           // resumes once the room drops back under this

  // ── Reconnect jitter window (reconnectBackoff.js consumers) ──────────────
  // A deploy or board /reset closes every socket at once; spreading retries
  // across this window turns a synchronized thundering herd into a smear.
  RECONNECT_JITTER_MIN_MS: 150,
  RECONNECT_JITTER_MAX_MS: 3000,
  // Reset/restore remount jitter (useYBoard triggerReset). Kept UNDER the
  // board reconnector's 2s reset sit-out (yPartyKit.js) so the old socket
  // doesn't fire a doomed reconnect during the staggered wait.
  RESET_REMOUNT_JITTER_MAX_MS: 1500,
});

// Cursor SEND interval (ms) for the given number of live awareness peers.
// Pure + monotonic non-decreasing: exactly CURSOR_MIN_MS up to
// CURSOR_SMALL_ROOM, a linear ramp to CURSOR_MAX_MS at CURSOR_FULL_ROOM, then
// holds the max. Non-finite / negative inputs are treated as 0 (no peers).
export function cursorIntervalForPeerCount(n) {
  const { CURSOR_MIN_MS, CURSOR_MAX_MS, CURSOR_SMALL_ROOM, CURSOR_FULL_ROOM } = PRESENCE_TUNING;
  const peers = Number.isFinite(n) ? Math.max(0, n) : 0;
  if (peers <= CURSOR_SMALL_ROOM) return CURSOR_MIN_MS;
  if (peers >= CURSOR_FULL_ROOM) return CURSOR_MAX_MS;
  const span = CURSOR_FULL_ROOM - CURSOR_SMALL_ROOM;
  const frac = (peers - CURSOR_SMALL_ROOM) / span;
  return Math.round(CURSOR_MIN_MS + frac * (CURSOR_MAX_MS - CURSOR_MIN_MS));
}

// Whether to broadcast your OWN cursor, given the live peer count and your
// PREVIOUS decision (hysteresis). Returns a boolean. Passing the previous
// value keeps the room from flapping when the count sits on the threshold.
//   wasBroadcasting=true  → keep broadcasting until count reaches SPECTATOR_ON
//   wasBroadcasting=false → stay quiet until count drops below SPECTATOR_OFF
export function shouldBroadcastOwnCursor(peerCount, wasBroadcasting = true) {
  const { SPECTATOR_ON, SPECTATOR_OFF } = PRESENCE_TUNING;
  const n = Number.isFinite(peerCount) ? Math.max(0, peerCount) : 0;
  if (wasBroadcasting) return n < SPECTATOR_ON;
  return n < SPECTATOR_OFF;
}
