// realtimeGuard.js — keep a refused WebSocket from crashing the surface that
// happened to subscribe first.
//
// @supabase/realtime-js's RealtimeClient.connect() rethrows a synchronous
// WebSocket-constructor failure as `WebSocket not available: …`, and
// RealtimeChannel.subscribe() calls connect() whenever the socket isn't up.
// So in any browser that refuses the socket (a privacy extension, a locked-down
// proxy, an in-app webview, a CSP without wss:) every `.channel(…).subscribe()`
// inside our React effects throws, and the nearest error boundary red-panels
// the page — that was the /c/ crash.
//
// Realtime is an enhancement everywhere we use it (live counts, presence,
// comment refresh); the data itself is always fetched over REST first. So the
// right behaviour is: note it once, stay offline, and let subscribe() hand back
// the channel as if the join were merely pending. Phoenix leaves `conn` null
// when the constructor throws, so a later connect() (bounceRealtime, a rejoin)
// simply tries again — and is swallowed again if the socket is still refused.
//
// Kept out of supabase.js because that module reads import.meta.env at module
// scope, which `node --test` can't load.

export function guardRealtimeConnect(realtime, onUnavailable) {
  if (!realtime || typeof realtime.connect !== 'function' || realtime.__soleilConnectGuarded) return realtime;
  const original = realtime.connect;
  let reported = false;
  // An own property shadows the prototype method, so the library's internal
  // callers (channel.subscribe → this.socket.connect(), _reconnectAuth) hit
  // the guard too, not just our own bounceRealtime.
  realtime.connect = function guardedConnect(...args) {
    try {
      return original.apply(this, args);
    } catch (err) {
      if (!reported) {
        reported = true;
        try { onUnavailable?.(err); } catch (_) {}
      }
      return undefined;
    }
  };
  realtime.__soleilConnectGuarded = true;
  return realtime;
}
