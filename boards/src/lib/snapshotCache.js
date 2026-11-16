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
//
// The record also carries the board's picture info (`pics`: blur hash, preview
// keys and sizes per storage path — imageMeta.exportImageMeta). Without it the
// instant paint has cards but no preview keys, so each one would pick its
// multi-MB original until the network prime (two queries) lands. yboard seeds
// imageMeta from `pics` before applying the snapshot; the network prime then
// replaces it. A record can hold `pics` with no snapshot yet (b64 null).

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
// Returns { b64, updatedAt, pics } or null. b64 is null for a record that so
// far holds only picture info; pics is null for one that has none.
export async function getSnapshot(boardId, uid) {
  try {
    const db = await openDb();
    if (!db) return null;
    const { store } = tx(db, 'readonly');
    const rec = await reqToPromise(store.get(boardId));
    if (!rec || (uid && rec.uid && rec.uid !== uid)) return null;
    return { b64: rec.b64, updatedAt: rec.updatedAt || null, pics: rec.pics || null };
  } catch (_) { return null; }
}

// The record to write when `next` replaces `prev`: `next` as is, plus the
// picture info `prev` already held when `next` brings none of its own. Another
// user's pictures never carry over (null === null counts as the same user).
export function mergeSnapshotRecord(prev, next) {
  if (!next || next.pics || !prev || !prev.pics) return next;
  if ((prev.uid || null) !== (next.uid || null)) return next;
  const out = { ...next, pics: prev.pics };
  if (prev.picsAt != null) out.picsAt = prev.picsAt;
  return out;
}

// Store a board snapshot. Fire-and-forget; prunes the oldest beyond MAX_ENTRIES.
// The existing record's picture info is kept: the get and the put share one
// readwrite transaction, and the put runs in the get's callback (no await in
// between) so the transaction can't auto-commit before it.
export async function putSnapshot(boardId, uid, b64, updatedAt = null) {
  if (!boardId || !b64) return;
  try {
    const db = await openDb();
    if (!db) return;
    const { store, done } = tx(db, 'readwrite');
    const next = { boardId, uid: uid || null, b64, updatedAt, cachedAt: Date.now() };
    const get = store.get(boardId);
    get.onsuccess = () => { store.put(mergeSnapshotRecord(get.result, next)); };
    await done;
    void pruneOld(db);
  } catch (_) { /* quota / disabled — board still loads from the network */ }
}

// Store a board's picture info (imageMeta.exportImageMeta) on its record,
// creating a snapshot-less record when the snapshot write hasn't landed yet
// (putSnapshot keeps the pictures either way). Another user's record is left
// alone. Fire-and-forget, same transaction pattern as putSnapshot.
export async function putSnapshotPics(boardId, uid, pics) {
  if (!boardId || !pics || typeof pics !== 'object' || Object.keys(pics).length === 0) return;
  try {
    const db = await openDb();
    if (!db) return;
    const { store, done } = tx(db, 'readwrite');
    const get = store.get(boardId);
    get.onsuccess = () => {
      const existing = get.result;
      if (existing && (existing.uid || null) !== (uid || null)) return;
      store.put({
        ...(existing || { boardId, uid: uid || null, b64: null, updatedAt: null, cachedAt: Date.now() }),
        pics,
        picsAt: Date.now(),
      });
    };
    await done;
  } catch (_) { /* quota / disabled — pictures just wait for the network prime */ }
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

// Drop the cached snapshot for a single board (e.g. after Yjs corruption, so
// the next open pulls clean state from the server instead of re-applying a
// possibly-bad cached update). Best-effort.
export async function deleteSnapshot(boardId) {
  if (!boardId) return;
  try {
    const db = await openDb();
    if (!db) return;
    const { store, done } = tx(db, 'readwrite');
    store.delete(boardId);
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
