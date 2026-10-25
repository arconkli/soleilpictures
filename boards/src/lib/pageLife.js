// pageLife.js — a page that died in front of someone.
//
// A page that crashes (out of memory, or its renderer gone: Chrome's "Aw,
// Snap!", iOS Safari's "A problem repeatedly occurred") fires nothing on its
// way out, and the reload after it starts from nothing. So the app keeps a
// note in sessionStorage, which outlives a page within its tab: when the page
// started, when it last looked, and whether it was on screen. A page that
// leaves the way pages leave (pagehide) takes its note away. The next load in
// the tab that still finds one, saying on screen, knows the page before it
// died there. A hidden one was likelier the system reclaiming a tab in the
// background, which nobody saw.
//
// The note holds two times and a word, nothing else. Pure apart from what it
// is handed, so node tests it (pageLife.test.mjs). App.jsx starts it as its
// chunk loads: a cluster heavy enough to take the page down usually does it
// while opening.

export const PAGE_NOTE_KEY = 'soleil.page';
const LOOK_MS = 60_000;

// How long the page before had lived, to its last look, when its note says it
// died on screen; otherwise null.
export function diedOnScreen(note) {
  const [since, at, vis] = String(note || '').split(' ');
  const lived = Number(at) - Number(since);
  return vis === 'visible' && since && Number.isFinite(lived) && lived >= 0 ? lived : null;
}

export function startPageLife({ store, doc, win, report, now = () => Date.now() }) {
  let before = null;
  try { before = store.getItem(PAGE_NOTE_KEY); } catch (_) { return; }
  const since = now();
  const look = () => { try { store.setItem(PAGE_NOTE_KEY, `${since} ${now()} ${doc.visibilityState}`); } catch (_) {} };
  look();
  doc.addEventListener('visibilitychange', look);
  win.addEventListener('pagehide', () => { try { store.removeItem(PAGE_NOTE_KEY); } catch (_) {} });
  // Back from the back-forward cache: the same page, alive again.
  win.addEventListener('pageshow', (e) => { if (e.persisted) look(); });
  win.setInterval(() => { if (doc.visibilityState === 'visible') look(); }, LOOK_MS);
  const lived = diedOnScreen(before);
  if (lived != null) report(lived);
}
