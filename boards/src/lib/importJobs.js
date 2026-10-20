// importJobs — the bulk imports this tab is running, for the tray
// (components/ImportTray.jsx) to draw.
//
// A module store, like heldUploads, so a job's progress (several snapshots a
// second while files upload) re-renders the tray alone and never App. App
// puts an entry in when an import starts and keeps its fields current; the
// tray reads, and calls an entry's `act(id)` for its buttons.
//
// An entry: { key, phase: 'reading' | 'asking' | 'job', title, reading:
// { files, folders, bytes }, snap (importJob state), act(id), and the words'
// inputs: offer, plan, own, ownerName, source, zips, targetName }.
// `act` ids: pause · resume · cancel · upgrade · addon · open · remove · retry.

const ACTIVE = new Set(['idle', 'creating', 'running', 'paused', 'waiting']);

let list = [];
let snapshot = { list };
const listeners = new Set();

function emit() {
  snapshot = { list };
  for (const fn of [...listeners]) {
    try { fn(); } catch (_) { /* a listener must not break the store */ }
  }
}

export function subscribeImportJobs(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function importJobsSnapshot() {
  return snapshot;
}

// Add the entry, or merge `fields` into the one with this key.
export function putImportJob(key, fields) {
  if (!key) return;
  const i = list.findIndex((e) => e.key === key);
  list = i < 0
    ? [...list, { key, ...fields }]
    : list.map((e, j) => (j === i ? { ...e, ...fields } : e));
  emit();
}

export function dropImportJob(key) {
  const next = list.filter((e) => e.key !== key);
  if (next.length === list.length) return;
  list = next;
  emit();
}

export function importJobEntry(key) {
  return list.find((e) => e.key === key) || null;
}

// Is the entry still going: being read, asked about, or a job not finished?
export function isActiveEntry(e) {
  if (!e) return false;
  if (e.phase === 'reading' || e.phase === 'asking') return true;
  return ACTIVE.has(e.snap?.status || 'idle');
}

// Anything this tab must not lose to a reload or a closed tab.
export function hasActiveImport() {
  return list.some(isActiveEntry);
}

// What the tray shows: the first entry still going (the dialog speaks for one
// being asked about), else the latest finished one; and how many others are
// still to come after it.
export function trayEntries(entries = list) {
  const shown = entries.filter((e) => e.phase !== 'asking');
  const lead = shown.find(isActiveEntry) || [...shown].reverse().find((e) => !isActiveEntry(e)) || null;
  const more = lead ? shown.filter((e) => e !== lead && isActiveEntry(e)).length : 0;
  return { lead, more };
}

// Tests only.
export function __resetImportJobsForTests() {
  list = [];
  snapshot = { list };
  listeners.clear();
}
