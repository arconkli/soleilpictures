// Image metadata cache — blur hash + preview availability, keyed by R2
// storage_path. Mirrors lib/r2.js (module-level cache + a public-viewer
// resolver override) but for the progressive-loading metadata rather than
// signed URLs.
//
// Why a separate cache (not the Y.Doc, not sign-reads):
//   - NOT the Y.Doc: blur/preview is DERIVED metadata that changes when a
//     backfill runs. Writing it into cards would bloat every snapshot and emit
//     collaborative Y.Doc updates (undo entries, realtime fan-out, history
//     churn) for a pure background optimization.
//   - NOT folded into sign-reads: sign-reads is the hot, viewport-gated,
//     ~4-min-refreshing presign path. Metadata is needed once, earlier (the
//     moment cards render, so the Tier-0 blur can paint), and never expires.
//
// On board open, useYBoard primes this with the snapshot's image keys in one
// RLS-protected query. R2Image (progressive mode) reads it synchronously via
// getMeta() and subscribes for the value arriving after a cold open.
//
// A repeat open doesn't wait for that query: yboard keeps each board's picture
// info (PIC_FIELDS, exportImageMeta) in its IndexedDB snapshot record and seeds
// it back here (seedImageMeta) before the cached snapshot is applied, so the
// first paint already knows each picture's blur and previews. A seeded entry is
// marked `seeded`; the network prime replaces it with the fresh row.

import { supabase } from './supabase.js';
import * as perf from './perf.js';

const cache = new Map();        // storage_path → { blur, previewKey, previewW, previewH, previewSmKey, previewSmW, previewSmH, previewXsKey, previewXsW, previewXsH, w, h, sizeBytes, uploadedBy, uploadedAt, originalName, seeded? }
const inflight = new Set();     // storage_path currently being fetched (dedupe)
const subscribers = new Map();  // storage_path → Set<cb>

// Public-viewer override (mirrors r2.setReadUrlResolver). The /share bundle
// carries metadata for an anon viewer that has no Supabase session, so getMeta
// resolves against the bundle instead of querying.
let _resolver = null;
export function setMetaResolver(fn) {
  _resolver = typeof fn === 'function' ? fn : null;
  // A late-installed resolver (bundle arrived) should wake any waiting cards.
  notifyAll();
}
export function clearMetaResolver() { _resolver = null; }

function notify(key) {
  const subs = subscribers.get(key);
  if (subs) for (const cb of subs) { try { cb(); } catch (_) {} }
}
function notifyAll() {
  for (const key of subscribers.keys()) notify(key);
}

// size_bytes rides along: Files' Size column read blank for every image,
// video and PDF because it was never selected. Who uploaded a file, when, and
// under what name are fetched only when Info asks (primeFileFacts) — every
// board open would otherwise carry them for every image, other workspaces'
// included.
const META_COLS = 'storage_path,blur_hash,preview_path,preview_w,preview_h,preview_sm_path,preview_sm_w,preview_sm_h,preview_xs_path,preview_xs_w,preview_xs_h,width,height,size_bytes';

function rowToMeta(row) {
  return {
    blur:         row.blur_hash || null,
    previewKey:   row.preview_path || null,
    previewW:     row.preview_w ?? null,
    previewH:     row.preview_h ?? null,
    // Small (DPR-down) preview variant — used to build a srcset so small/
    // zoomed-out cards fetch the ~640px webp instead of the 1280px one.
    previewSmKey: row.preview_sm_path || null,
    previewSmW:   row.preview_sm_w ?? null,
    previewSmH:   row.preview_sm_h ?? null,
    // Quick tier (~256px): the smallest rung, for first paint on big boards.
    previewXsKey: row.preview_xs_path || null,
    previewXsW:   row.preview_xs_w ?? null,
    previewXsH:   row.preview_xs_h ?? null,
    w:            row.width ?? null,
    h:            row.height ?? null,
    sizeBytes:    row.size_bytes ?? null,
    // 0402: variant generation finished and there is nothing more to make
    // (imageVariantPick.variantsSettled). Absent before that migration.
    checked:      !!row.variants_checked_at,
  };
}

// The fields a row brings that an entry doesn't have yet — so a row never
// overwrites a fresher local value, but does fill in what's missing (an entry
// setMetaLocal made after an upload knows its preview, not its size).
function fillMissing(prev, row) {
  const next = { ...prev };
  for (const [k, v] of Object.entries(row)) if (next[k] == null && v != null) next[k] = v;
  return next;
}

// The fields kept per picture in a board's IndexedDB snapshot record and seeded
// back on the next open (exportImageMeta / seedImageMeta): what first paint
// needs to pick a preview and draw the blur, nothing the Info drawer reads.
export const PIC_FIELDS = ['blur', 'previewKey', 'previewW', 'previewH', 'previewSmKey', 'previewSmW', 'previewSmH', 'previewXsKey', 'previewXsW', 'previewXsH', 'w', 'h'];
const PIC_NUMBER_FIELDS = new Set(['previewW', 'previewH', 'previewSmW', 'previewSmH', 'previewXsW', 'previewXsH', 'w', 'h']);
const blankMeta = () => Object.fromEntries(PIC_FIELDS.map((f) => [f, null]));

// What a row does to the entry already cached for its key. A seeded entry is
// only the last visit's copy, so the row (network truth) replaces it and drops
// `seeded`; any other entry keeps its local values and only gains what it lacks.
export function mergeMetaRow(prev, rowMeta) {
  if (!prev) return rowMeta;
  return prev.seeded ? rowMeta : fillMissing(prev, rowMeta);
}

export function picFieldsDiffer(a, b) {
  return PIC_FIELDS.some((f) => (a ? a[f] : null) !== (b ? b[f] : null));
}

// The picture info of these keys' network-sourced entries, for the snapshot
// record: only PIC_FIELDS, nulls left out, plus `checked: true` when the server
// had confirmed the row's variants, at most `max` entries. A seeded entry
// is never written back (it is already stored; only the network refreshes it),
// and an entry with no preview and no blur — the null placeholder for a key
// with no row — has nothing worth keeping.
export function exportImageMeta(keys, max = 1500) {
  const out = {};
  if (!Array.isArray(keys)) return out;
  const done = new Set();
  for (const key of keys) {
    if (done.size >= max) break;
    if (!key || typeof key !== 'string' || done.has(key)) continue;
    const m = cache.get(key);
    if (!m || m.seeded || !(m.previewKey || m.previewXsKey || m.blur)) continue;
    const pic = {};
    for (const f of PIC_FIELDS) if (m[f] != null) pic[f] = m[f];
    if (m.checked === true) pic.checked = true;
    out[key] = pic;
    done.add(key);
  }
  return out;
}

// Seed the cache from a snapshot record's picture info (yboard, before the
// cached snapshot is applied) so the first paint knows each picture's blur and
// previews without waiting for the network prime. Never overwrites an entry —
// anything already cached is at least as fresh — and ignores malformed input.
// A seeded entry carries `checked` only when the record held `checked: true`
// (exportImageMeta writes it for a confirmed row), so a blur-only picture (a
// GIF) reads as settled (imageVariantPick.variantsSettled) and is not
// downloaded and decoded for a backfill on every repeat open before the network
// row lands. Anything but boolean true is ignored; the row replaces the entry.
export function seedImageMeta(pics) {
  if (_resolver) return;  // public viewer: metadata comes from the bundle
  if (!pics || typeof pics !== 'object' || Array.isArray(pics)) return;
  for (const [key, m] of Object.entries(pics)) {
    if (!key || !m || typeof m !== 'object' || cache.has(key)) continue;
    const entry = blankMeta();
    for (const f of PIC_FIELDS) {
      const v = m[f];
      const ok = PIC_NUMBER_FIELDS.has(f) ? (typeof v === 'number' && Number.isFinite(v)) : (typeof v === 'string' && v !== '');
      if (ok) entry[f] = v;
    }
    if (!(entry.previewKey || entry.previewXsKey || entry.blur)) continue;
    if (m.checked === true) entry.checked = true;
    entry.seeded = true;
    cache.set(key, entry);
    notify(key);
  }
}

// variants_checked_at arrived in migration 0402; until it is applied,
// selecting it is a 42703 that would fail the whole prime, so the first such
// error drops it for the session and the query is retried without.
let _withChecked = true;
const metaCols = () => (_withChecked ? `${META_COLS},variants_checked_at` : META_COLS);
function missingCheckedColumn(error) {
  return !!error && _withChecked
    && (error.code === '42703' || /variants_checked_at/.test(String(error.message || '')));
}
// Run a select built from the current column list, retrying once without the
// 0402 column when the server does not have it yet.
async function selectMeta(build) {
  let res = await build(metaCols());
  if (missingCheckedColumn(res.error)) {
    _withChecked = false;
    res = await build(metaCols());
  }
  return res;
}

// Prime metadata for a list of original storage_path keys. Dedupes against
// already-cached and in-flight keys, chunks into ≤200 (PostgREST IN-list cap,
// matching sign-reads), and stores each row. Fire-and-forget; getMeta returns
// null until it lands, then subscribers are notified.
export async function primeImageMeta(keys) {
  if (_resolver) return;  // public viewer: metadata comes from the bundle
  if (!Array.isArray(keys) || keys.length === 0) return;

  // Synchronously reserve uncached/not-in-flight keys so concurrent primes
  // (board-open bulk + per-card safety net) don't double-query.
  const todo = [];
  for (const k of keys) {
    if (!k || typeof k !== 'string') continue;
    if (cache.has(k) || inflight.has(k)) continue;
    inflight.add(k);
    todo.push(k);
  }
  if (todo.length === 0) return;

  const _t0 = perf.isEnabled() ? performance.now() : 0;
  const CHUNK = 200;
  const chunks = [];
  for (let i = 0; i < todo.length; i += CHUNK) chunks.push(todo.slice(i, i + CHUNK));
  try {
    // Run every 200-key chunk in parallel — a 500-image board primes in one
    // round-trip's worth of wall time instead of three serialized ones, so the
    // Tier-0 blur can paint sooner.
    await Promise.all(chunks.map(async (chunk) => {
      const { data, error } = await selectMeta((cols) => supabase
        .from('images')
        .select(cols)
        .in('storage_path', chunk));
      if (error) { for (const k of chunk) inflight.delete(k); return; }
      const seen = new Set();
      for (const row of (data || [])) {
        // Never clobber an entry that landed mid-flight — these keys had no
        // cache entry when this prime started (the dedupe above), so anything
        // present now came from setMetaLocal (a just-finished backfill/upload)
        // or the board-id prime, both fresher than this query's snapshot. A
        // seeded entry (last visit's copy) is the one exception: the row wins.
        const prev = cache.get(row.storage_path);
        if (!prev || prev.seeded) cache.set(row.storage_path, mergeMetaRow(prev, rowToMeta(row)));
        seen.add(row.storage_path);
      }
      // Keys with no row (RLS-hidden or not yet inserted) get a null-meta
      // entry so we don't re-query them every render; a later setMetaLocal
      // (e.g. after the upload's variant generation) overwrites it.
      for (const k of chunk) {
        if (!seen.has(k) && !cache.has(k)) cache.set(k, { ...blankMeta(), checked: false });
        inflight.delete(k);
        notify(k);
      }
      for (const k of seen) notify(k);
    }));
  } finally {
    for (const k of todo) inflight.delete(k);
    if (_t0) {
      perf.mark('imageMeta.prime.ms', performance.now() - _t0);
      perf.gauge('imageMeta.cacheSize', cache.size);
    }
  }
}

// Prime metadata for every image on a board in ONE query keyed by board id —
// callable before the board snapshot has even decoded (no card keys needed),
// so it runs in parallel with the snapshot fetch on board open. Covers rows
// uploaded to the board (board_id) plus rows referenced onto it from other
// boards (referenced_in_board_ids). Already-cached keys are never clobbered
// (an in-session setMetaLocal from a backfill/upload wins). Fire-and-forget;
// once per board per session — the key-based primeImageMeta stays the safety
// net for keys this query can't see. Resolves to the storage_paths the rows
// carried ([] on an error, a public viewer or a bad id); the promise is kept
// per board (whenBoardMetaPrimed) so yboard can store what arrived.
const primedBoards = new Set();
const primedPromises = new Map();   // boardId → Promise<string[]>
export function primeImageMetaForBoard(boardId) {
  if (_resolver) return Promise.resolve([]);  // public viewer: metadata comes from the bundle
  if (!boardId || !/^[0-9a-f-]{36}$/i.test(String(boardId))) return Promise.resolve([]);
  if (primedBoards.has(boardId)) return primedPromises.get(boardId) || Promise.resolve([]);
  primedBoards.add(boardId);
  const p = primeBoardRows(boardId);
  primedPromises.set(boardId, p);
  return p;
}

// The promise of this board's prime, or null when none was started this
// session (or the last one failed).
export function whenBoardMetaPrimed(boardId) {
  return primedPromises.get(boardId) || null;
}

async function primeBoardRows(boardId) {
  const _t0 = perf.isEnabled() ? performance.now() : 0;
  try {
    // Two queries, not one .or(). PostgREST turns
    //   .or('board_id.eq.X,referenced_in_board_ids.cs.{X}')
    // into a single OR across two different columns, and the images RLS policy
    // is itself a three-way OR — so the planner cannot build a BitmapOr and
    // falls back to scanning. Measured at ~63,000 buffers and 2.3s per board
    // open. Split apart, each half has a single-column predicate the planner
    // can serve from an index (images_board_card_idx and images_boards_gin
    // respectively; the GIN existed all along and had never once been used).
    //
    // Deduping is free: the loop below skips any key already in the cache, so
    // a row matching both halves is written once. Deliberately NOT filtered on
    // deleted_at — a soft-deleted image still renders during its undo window.
    //
    // Both halves skip the derived preview rows (up to three per picture, under
    // <ws>/previews/<uuid>.webp); link pictures live in <ws>/previews/link/ and stay.
    const NOT_DERIVED = 'storage_path.not.like.*/previews/*,storage_path.like.*/previews/link/*';
    const [own, ref] = await Promise.all([
      selectMeta((cols) => supabase.from('images').select(cols).eq('board_id', boardId).or(NOT_DERIVED)),
      selectMeta((cols) => supabase.from('images').select(cols).contains('referenced_in_board_ids', [boardId]).or(NOT_DERIVED)),
    ]);
    if (own.error && ref.error) { primedBoards.delete(boardId); primedPromises.delete(boardId); return []; }
    const received = new Set();
    for (const row of [...(own.data || []), ...(ref.data || [])]) {
      received.add(row.storage_path);
      const prev = cache.get(row.storage_path);
      const next = mergeMetaRow(prev, rowToMeta(row));
      if (prev && prev.seeded) {
        // Last visit's copy replaced by the row; only a changed picture
        // field is news to a card (the rest it never drew from).
        cache.set(row.storage_path, next);
        if (picFieldsDiffer(prev, next)) notify(row.storage_path);
        continue;
      }
      if (prev && Object.keys(next).every((k) => next[k] === prev[k])) continue;
      cache.set(row.storage_path, next);
      notify(row.storage_path);
    }
    if (_t0) {
      perf.mark('imageMeta.primeBoard.ms', performance.now() - _t0);
      perf.gauge('imageMeta.cacheSize', cache.size);
    }
    // One half failing still fills the cache with the other's rows, but only a
    // whole answer is worth storing as the board's picture info.
    return own.error || ref.error ? [] : [...received];
  } catch (_) {
    primedBoards.delete(boardId);
    primedPromises.delete(boardId);
    return [];
  }
}

// Who uploaded a file, when, under what name, and its size — for Info only,
// fetched when it opens on a card (one small query per file, once a session).
const factsDone = new Set();
export async function primeFileFacts(keys) {
  if (_resolver) return;  // public viewer: Info shows what the bundle has
  const todo = (keys || []).filter((k) => k && typeof k === 'string' && !factsDone.has(k));
  if (!todo.length) return;
  for (const k of todo) factsDone.add(k);
  try {
    // The facts query reads the meta columns too (0402's included), so an
    // entry it creates is a whole one — R2Image never re-primes a key that's
    // already cached.
    const { data, error } = await selectMeta((cols) => supabase.from('images')
      .select(`${cols},uploaded_by,created_at,original_name`).in('storage_path', todo.slice(0, 200)));
    if (error) { for (const k of todo) factsDone.delete(k); return; }
    for (const row of data || []) {
      const facts = {
        ...rowToMeta(row),
        uploadedBy: row.uploaded_by || null, uploadedAt: row.created_at || null, originalName: row.original_name || null,
      };
      cache.set(row.storage_path, mergeMetaRow(cache.get(row.storage_path) || {}, facts));
      notify(row.storage_path);
    }
  } catch (_) {
    for (const k of todo) factsDone.delete(k);
  }
}

// Synchronous accessor for R2Image. Returns the meta object or null.
export function getMeta(key) {
  if (!key || typeof key !== 'string') return null;
  if (_resolver) return _resolver(key) || null;
  return cache.get(key) || null;
}

// Optimistic local update (after a backfill or fresh upload generates a
// variant) so the live session switches to the preview without a refetch.
export function setMetaLocal(key, patch) {
  if (!key || typeof key !== 'string' || !patch) return;
  const prev = cache.get(key) || {};
  cache.set(key, { ...prev, ...patch });
  notify(key);
}

// Subscribe to meta arriving/changing for a key. Returns an unsubscribe fn.
export function subscribeMeta(key, cb) {
  if (!key || typeof cb !== 'function') return () => {};
  let set = subscribers.get(key);
  if (!set) { set = new Set(); subscribers.set(key, set); }
  set.add(cb);
  return () => {
    const s = subscribers.get(key);
    if (s) { s.delete(cb); if (s.size === 0) subscribers.delete(key); }
  };
}
