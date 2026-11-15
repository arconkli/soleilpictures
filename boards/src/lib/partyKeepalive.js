// Is a party socket dead? Asked once per keepalive tick (lib/yPartyKit.js).
//
// Every tick sends a ping, and a live socket answers it before the next tick.
// Two kinds of room answer: an older one echoes every awareness frame to every
// socket, the sender included, so the tick sends this tab's presence; a room
// that hibernates has Cloudflare answer a text PING with PONG without waking
// it (lib/partyPing.js), so the tick sends PING. Either way the answer is
// whichever the socket heard last (lastHeardFrom). A socket that has not answered
// its last ping is dead, even if the browser never saw it close (a laptop
// woken from sleep, a network that changed underneath it).
//
// Measured against the last PING, never against the clock. Chrome stretches a
// hidden tab's timers to one wake-up a minute after five minutes hidden, so a
// "nothing heard for 45 s" rule found a healthy socket a minute stale on every
// tick, closed it, and made the person flicker out of everyone's presence
// once a minute. y-partykit had the same flaw at 30 s.
//
//   lastReceived — the latest of provider.wsLastMessageReceived (ms; set on
//                  open and on every binary frame, not on text frames) and
//                  the socket's last PONG (lastHeardFrom)
//   lastPingAt   — when this tab last sent its keepalive (0 = not yet, or
//                  not on this socket)
export function socketLooksDead(lastReceived, lastPingAt) {
  return lastPingAt > 0 && (Number(lastReceived) || 0) < lastPingAt;
}

// The last time anything answered on this provider's socket: a binary frame
// (YProvider stamps it) or a PONG, which YProvider never sees, so the
// board's text-frame listener stamps it on the socket as _pongAt.
export function lastHeardFrom(provider) {
  return Math.max(Number(provider?.wsLastMessageReceived) || 0, Number(provider?.ws?._pongAt) || 0);
}

// What the workspace room's interval tick sends (lib/workspacePartyKit.js).
// The room hibernates, so a 'here' that says nothing new would wake it every
// tick: once the socket has said it answers pings, send 'here' only when the
// payload changed since the last one sent on this socket, else PING.
//   pings    — this socket heard the room's hello
//   lastSent — the last 'here' payload (string) sent on this socket, or null
//   next     — the payload this tick would send
export function workspaceTick({ pings, lastSent, next }) {
  if (!pings) return 'here';
  return lastSent === next ? 'ping' : 'here';
}
