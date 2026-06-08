// Persistent board-snapshot cache (IndexedDB) for instant board reopen.
//
// Board state (the Y.Doc) is otherwise cold-fetched from Postgres on every open,
// so a reopen waits on the network before anything paints. This caches the last
// authoritative snapshot bytes locally so a reopen PAINTS INSTANTLY from cache,
// then reconciles with the server in the background (stale-while-revalidate).
//
// Why this is safe (no stale/corrupt board): Y.applyUpdate is a CRDT merge, and
// the server snapshot is the FULL state (Y.encodeStateAsUpdate, tombstones
// included). The load path applies the cache first, then the server state on
// top — so a cached card the server later deleted does NOT reappear, and newer
// server edits always win. Worst case the cache is a few seconds stale for one
// frame before the server reconcile lands.
//
// Records are tagged with the owner user id and ignored on read for a different
// user, so a shared device never serves one user's board content to another.

const DB_NAME = 'soleil-boards';
const STORE = 'snapshots';
const DB_VERSION = 1;
const MAX_ENTRIES = 24;   // keep the most-recently-cached boards; prune the rest

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
        const os = db.createObjectStore(STORE, { keyPath: 'boardId' });
        os.createIndex('cachedAt', 'cachedAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);   // degrade gracefully — caching is optional
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

// Get the cached snapshot for a board, only if it belongs to `uid`.
// Returns { b64, updatedAt } or null.
export async function getSnapshot(boardId, uid) {
  try {
    const db = await openDb();
    if (!db) return null;
    const { store } = tx(db, 'readonly');
    const rec = await reqToPromise(store.get(boardId));
    if (!rec || (uid && rec.uid && rec.uid !== uid)) return null;
    return { b64: rec.b64, updatedAt: rec.updatedAt || null };
  } catch (_) { return null; }
}

// Store a board snapshot. Fire-and-forget; prunes the oldest beyond MAX_ENTRIES.
export async function putSnapshot(boardId, uid, b64, updatedAt = null) {
  if (!boardId || !b64) return;
  try {
    const db = await openDb();
    if (!db) return;
    const { store, done } = tx(db, 'readwrite');
    store.put({ boardId, uid: uid || null, b64, updatedAt, cachedAt: Date.now() });
    await done;
    void pruneOld(db);
  } catch (_) { /* quota / disabled — board still loads from the network */ }
}

async function pruneOld(db) {
  try {
    const { store } = tx(db, 'readonly');
    const all = await reqToPromise(store.getAll());
    if (!all || all.length <= MAX_ENTRIES) return;
    all.sort((a, b) => (b.cachedAt || 0) - (a.cachedAt || 0));
    const toDelete = all.slice(MAX_ENTRIES);
    const { store: ws, done } = tx(db, 'readwrite');
    for (const r of toDelete) ws.delete(r.boardId);
    await done;
  } catch (_) {}
}

// Drop everything (e.g. on sign-out). Best-effort.
export async function clearAllSnapshots() {
  try {
    const db = await openDb();
    if (!db) return;
    const { store, done } = tx(db, 'readwrite');
    store.clear();
    await done;
  } catch (_) {}
}
