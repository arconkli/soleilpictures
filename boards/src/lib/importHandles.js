// importHandles — the folders and zips a bulk import was dropped from, kept in
// this browser by job id, so an import stopped by a reload can read them
// again (lib/importResume.js). Chromium only: its FileSystemHandles are what
// survive a page, and IndexedDB keeps them as they are.
//
// A record: { kind: 'folder' | 'zip', handles: FileSystemHandle[] }.
// Nothing here may break an import: every call resolves, to nothing when
// storage is off (a private window) or the browser has no handles.

const DB = 'soleil-imports';
const STORE = 'handles';

let dbp = null;
function open() {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('no indexedDB'));
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('blocked'));
    });
    dbp.catch(() => { dbp = null; });
  }
  return dbp;
}

async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function saveImportHandles(jobId, record) {
  if (!jobId || !record?.handles?.length) return false;
  try { await run('readwrite', (s) => s.put(record, jobId)); return true; } catch (_) { return false; }
}

export async function loadImportHandles(jobId) {
  if (!jobId) return null;
  try { return (await run('readonly', (s) => s.get(jobId))) || null; } catch (_) { return null; }
}

export async function dropImportHandles(jobId) {
  if (!jobId) return;
  try { await run('readwrite', (s) => s.delete(jobId)); } catch (_) { /* nothing kept */ }
}

// Let go of every record but these jobs': ones that finished in another tab,
// or were removed, leave theirs behind.
export async function pruneImportHandles(keepIds) {
  const keep = new Set(keepIds || []);
  try {
    const keys = (await run('readonly', (s) => s.getAllKeys())) || [];
    const gone = keys.filter((k) => !keep.has(k));
    if (gone.length) await run('readwrite', (s) => { let last = null; for (const k of gone) last = s.delete(k); return last; });
  } catch (_) { /* nothing kept */ }
}
