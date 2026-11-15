// Put text on the system clipboard; resolves to whether it got there. Never
// rejects.
//
// Text that has to be fetched first (a share link that must be created) is
// handed over as a PROMISE, and this must be called inside the click itself,
// before any await: Safari only lets a page write the clipboard during the
// tap, and a writeText() after an await falls outside it. A ClipboardItem
// takes a promise of its Blob, so the write starts in the gesture and
// finishes when the text arrives. Where that isn't available (or it fails)
// the text is awaited and written the plain way, which Chrome and Firefox
// allow after an await.
//
// A promise that rejects, or resolves to nothing, is a `false`: the caller
// awaits its own promise for the reason.
//
// Checked clipboard-polyfill and copy-to-clipboard before building this:
// neither takes a promise (the first's ClipboardItem wants a string or a Blob,
// the second is a synchronous execCommand on a string), so neither can start
// the write inside the gesture.
//
// (lib/clipboard.js is the cards' own in-memory clipboard, a different thing.)
export async function writeClipboard(textOrPromise) {
  if (typeof textOrPromise !== 'string') {
    if (!textOrPromise || typeof textOrPromise.then !== 'function') return false;
    const Item = typeof ClipboardItem !== 'undefined' ? ClipboardItem : null;
    if (Item && typeof navigator !== 'undefined' && navigator.clipboard?.write) {
      try {
        const blob = textOrPromise.then((text) => {
          if (!text) throw new Error('no text');
          return new Blob([text], { type: 'text/plain' });
        });
        // The item may never read the blob (the write was refused first).
        blob.catch(() => {});
        await navigator.clipboard.write([new Item({ 'text/plain': blob })]);
        return true;
      } catch (_) { /* fall through to the plain path */ }
    }
    let text;
    try { text = await textOrPromise; } catch (_) { return false; }
    if (!text || typeof text !== 'string') return false;
    return writeClipboard(text);
  }
  try {
    await navigator.clipboard.writeText(textOrPromise);
    return true;
  } catch (_) {
    try {
      const ta = document.createElement('textarea');
      ta.value = textOrPromise;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return !!ok;
    } catch (_) { return false; }
  }
}
