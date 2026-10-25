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
// watchChannels() below is the other half: it hands on a channel whose live
// updates never arrive, for the error reporting.
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

// Every channel the client makes, however it was subscribed, hands
// onStatus(channel, name, status, err) each CHANNEL_ERROR and TIMED_OUT it
// hears, and its own subscriber still hears them. errorSender.js decides
// which are the channel's own failure (errorCore.js channelFailure): a join
// the server refused, live rows it couldn't match, a join nothing answered;
// never a dropped socket, which every channel errors with and rejoins after.
// Wraps realtime.channel as an own property, as the guard above wraps
// connect, so supabase.channel (which calls it) is watched too.
export function watchChannels(realtime, onStatus) {
  if (!realtime || typeof realtime.channel !== 'function' || realtime.__soleilChannelsWatched) return realtime;
  const make = realtime.channel;
  realtime.channel = function watchedChannel(name, ...rest) {
    const ch = make.call(this, name, ...rest);
    if (ch && typeof ch.subscribe === 'function' && !ch.__soleilWatched) {
      ch.__soleilWatched = true;
      const subscribe = ch.subscribe;
      ch.subscribe = function watchedSubscribe(cb, ...more) {
        return subscribe.call(this, (status, err) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { try { onStatus(ch, name, status, err); } catch (_) {} }
          if (typeof cb === 'function') cb(status, err);
        }, ...more);
      };
    }
    return ch;
  };
  realtime.__soleilChannelsWatched = true;
  return realtime;
}
