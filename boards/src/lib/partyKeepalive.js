// Is a party socket dead? Asked once per keepalive tick (lib/yPartyKit.js).
//
// Every tick sends this tab's presence; the room echoes every awareness frame
// to every socket, the sender included, so a live socket always answers the
// previous tick's ping before the next tick. A socket that has not answered
// its last ping is dead, even if the browser never saw it close (a laptop
// woken from sleep, a network that changed underneath it).
//
// Measured against the last PING, never against the clock. Chrome stretches a
// hidden tab's timers to one wake-up a minute after five minutes hidden, so a
// "nothing heard for 45 s" rule found a healthy socket a minute stale on every
// tick, closed it, and made the person flicker out of everyone's presence
// once a minute. y-partykit had the same flaw at 30 s.
//
//   lastReceived — provider.wsLastMessageReceived (ms; set on open and on
//                  every binary frame)
//   lastPingAt   — when this tab last sent its keepalive (0 = not yet, or
//                  not on this socket)
export function socketLooksDead(lastReceived, lastPingAt) {
  return lastPingAt > 0 && (Number(lastReceived) || 0) < lastPingAt;
}
