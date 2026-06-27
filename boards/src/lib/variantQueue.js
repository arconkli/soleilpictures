// Durable "needs preview variants" queue (IndexedDB).
//
// Variant generation (thumbhash blur + 1280/640 webp previews) runs in the
// uploader's browser, fire-and-forget through backfillGate. On a big multi-image
// drop the in-memory gate queue can outlive the page: close the tab mid-batch
// and the un-generated images keep shipping as full-res originals forever — the
// writer-view self-heal (previewBackfill.js) only catches them if that exact
// board is reopened by a writer.
//
// This persists each pending image key at upload time and drains it on the next
// board open (drainVariantQueue in previewBackfill.js), so a drop-and-leave
// still completes — with NO server-side image processing. Entries are removed on
// success; a small attempts cap drops permanently-failing items (decode failure,
// deleted original) so the queue can't grow without bound. Every op is
// best-effort and degrades to a no-op when IndexedDB is unavailable.
//
// Separate DB from snapshotCache.js (which owns 'soleil-boards') so the two
// never have to coordinate a schema/version bump.

const DB_NAME = 'soleil-variant-queue';
const STORE = 'pending';
const DB_VERSION = 1;
const MAX_ATTEMPTS = 3;

let _dbPromise = null;

function openDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') { resolve(null); return; }
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); }
    catch (_) { resolve(null); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);   // degrade gracefully — the queue is optional
  });
  return _dbPromise;
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode) {
  const t = db.transaction(STORE, mode);
  return {
    store: t.objectStore(STORE),
    done: new Promise((res, rej) => {
      t.oncomplete = res;
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    }),
  };
}

// Record an image whose variants still need generating. `key` is the R2 storage
// key of the ORIGINAL. Fire-and-forget — never blocks or breaks the upload.
export async function enqueueVariant({ key, workspaceId, boardId }) {
  if (!key || !workspaceId) return;
  try {
    const db = await openDb();
    if (!db) return;
    const { store, done } = tx(db, 'readwrite');
    store.put({ key, workspaceId, boardId: boardId || null, attempts: 0, enqueuedAt: Date.now() });
    await done;
  } catch (_) { /* quota / disabled — the in-memory gen + board-open self-heal still try */ }
}

// Remove a key once its variants exist (generation succeeded, or there was
// nothing to generate). Best-effort.
export async function dequeueVariant(key) {
  if (!key) return;
  try {
    const db = await openDb();
    if (!db) return;
    const { store, done } = tx(db, 'readwrite');
    store.delete(key);
    await done;
  } catch (_) {}
}

// Up to `limit` pending items, oldest first. Returns [] on any failure.
export async function listPendingVariants(limit = 25) {
  try {
    const db = await openDb();
    if (!db) return [];
    const { store } = tx(db, 'readonly');
    const all = await reqToPromise(store.getAll());
    if (!Array.isArray(all)) return [];
    all.sort((a, b) => (a.enqueuedAt || 0) - (b.enqueuedAt || 0));
    return all.slice(0, limit);
  } catch (_) { return []; }
}

// Note a failed generation attempt; drop the item once it exceeds the cap so a
// permanently-bad image (decode failure, deleted original, lost write access)
// can't wedge the queue forever. Best-effort.
export async function recordVariantFailure(key) {
  if (!key) return;
  try {
    const db = await openDb();
    if (!db) return;
    const { store, done } = tx(db, 'readwrite');
    const rec = await reqToPromise(store.get(key));
    if (rec) {
      const attempts = (rec.attempts || 0) + 1;
      if (attempts >= MAX_ATTEMPTS) store.delete(key);
      else store.put({ ...rec, attempts });
    }
    await done;
  } catch (_) {}
}

// Drop everything (e.g. on sign-out so a shared device doesn't drain another
// user's keys). Best-effort.
export async function clearVariantQueue() {
  try {
    const db = await openDb();
    if (!db) return;
    const { store, done } = tx(db, 'readwrite');
    store.clear();
    await done;
  } catch (_) {}
}
