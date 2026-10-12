// When an open thread or the inbox list has to read again from the server.
// Pure (window and document are injectable), so node --test can pin it.
//
// Messages are not in the realtime publication: the only live trigger was a
// peer's 'chat-message' broadcast. A laptop that slept, a dropped socket or a
// tab in the background missed those for good, and the thread and the unread
// counts stayed stale until another message happened to arrive (COMMS-04).
// Now a read also happens when the channel (re)joins, when the tab comes back
// to the front and when the network returns — coalesced, because waking a
// laptop fires all three at once.

export const RESYNC_DELAY_MS = 250;

// Returns { kick, stop }. kick() asks for a read; calls within delayMs
// collapse into one. stop() removes the listeners and drops a pending read.
export function watchForResync(run, {
  win = globalThis.window,
  doc = globalThis.document,
  delayMs = RESYNC_DELAY_MS,
} = {}) {
  let timer = null;
  let stopped = false;
  const kick = () => {
    if (stopped || timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (stopped) return;
      Promise.resolve().then(run).catch((e) => console.warn('[messageResync] read failed', e));
    }, delayMs);
  };
  const onVisible = () => { if (!doc || doc.visibilityState !== 'hidden') kick(); };
  doc?.addEventListener?.('visibilitychange', onVisible);
  win?.addEventListener?.('online', kick);
  const stop = () => {
    stopped = true;
    if (timer) { clearTimeout(timer); timer = null; }
    doc?.removeEventListener?.('visibilitychange', onVisible);
    win?.removeEventListener?.('online', kick);
  };
  return { kick, stop };
}
