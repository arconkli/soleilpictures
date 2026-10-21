// Boot milestones for this page load, as native performance marks named
// `boot:<name>`. Each records once per load:
//
//   session    AuthGate has a session to hand the app { refreshed }
//   shell      the AppShell chunk evaluated { cached }
//   tier       get_my_tier answered
//   workspace  the workspace and its root are known; Workspace mounts
//   paint      the board the person landed on painted { source, cards }
//   image      the first picture on the canvas loaded { tier }
//
// They show in DevTools' Timings lane, scripts/perf/bootBench.mjs reads them,
// and app_open and board_ready carry their times, so a slow open in the field
// says which step it was slow in.
//
// Native marks rather than lib/perf.js: AuthGate imports this from the entry
// chunk, and perf.js pulls in yjs.

const PREFIX = 'boot:';
const waiting = new Map();

function entry(name) {
  try { return performance.getEntriesByName(PREFIX + name, 'mark')[0] || null; }
  catch (_) { return null; }
}

export function bootMark(name, detail) {
  if (entry(name)) return;
  try { performance.mark(PREFIX + name, detail === undefined ? undefined : { detail }); }
  catch (_) { return; }
  const fns = waiting.get(name);
  if (!fns) return;
  waiting.delete(name);
  for (const fn of fns) { try { fn(); } catch (_) {} }
}

// Milliseconds from the start of the navigation, or null before it happened.
export function bootAt(name) {
  const e = entry(name);
  return e ? Math.round(e.startTime) : null;
}

export function bootDetail(name) {
  return entry(name)?.detail ?? null;
}

// Runs fn once the mark exists: now, when it already does. Returns a cancel.
export function onBootMark(name, fn) {
  if (entry(name)) { fn(); return () => {}; }
  const fns = waiting.get(name) || new Set();
  fns.add(fn);
  waiting.set(name, fns);
  return () => { fns.delete(fn); };
}
