// The party rooms' keepalive, answered by Cloudflare without waking the room.
//
// A board or workspace room hibernates between events (party/board.ts,
// party/workspace.ts) and registers PING -> PONG as its WebSocket
// auto-response, so a tab's keepalive costs the room nothing. A room says it
// does this when a socket connects (the hello below); until a tab hears it, it
// keeps its older keepalive, so the app and the party Worker can be released
// in either order.
//
// PING and PONG never reach either side's sync code: the board server drops text
// frames without y-partyserver's __YPS: prefix, YProvider ignores them too, and
// the workspace protocol is JSON, which they are not. WAKE (below) does reach the
// board room's onCustomMessage, which ignores it.

export const PING = 'ping';
export const PONG = 'pong';

// Board room: sent with sendCustomMessage, so it arrives as `__YPS:` + this.
export const PINGS_HELLO = '{"t":"pings"}';
// Workspace room: a plain JSON frame beside 'roster', 'here' and 'leave'.
export const WORKSPACE_PINGS_HELLO = '{"type":"pings"}';

// Wake on intent. A napping room takes a moment to wake, and the first frame
// after a quiet spell pays it. A tab that sees someone reach for the cluster on
// screen (a touch, a click, a key, coming back to the tab) sends WAKE as a custom
// message first, so the room is up by the time the change follows. Only when the
// room may be napping: nothing has come from it for WAKE_QUIET_MS, and at most
// once per WAKE_QUIET_MS. Rooms answer nothing to a WAKE (older ones too:
// lib/roomAck.js ignores what it doesn't know). WAKE_QUIET_MS is longer than a
// room stays up after its last event (about ten seconds), so a wake lands on a
// napping room, which answers with its sync hello, a frame that counts as heard;
// wakes alone can therefore never keep a room up.
export const WAKE = '{"t":"wake"}';
export const WAKE_QUIET_MS = 12_000;
export function shouldWake({ pings, now, lastReceived, lastWakeAt }) {
  if (!pings) return false;
  return now - (Number(lastReceived) || 0) >= WAKE_QUIET_MS && now - (Number(lastWakeAt) || 0) >= WAKE_QUIET_MS;
}
