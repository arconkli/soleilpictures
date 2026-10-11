// Y.Doc lifecycle for a single board.
//
// Two distinct persistence paths:
//   1. board_state (live state) — debounced 250 ms after every edit. Always
//      reflects the latest. Used to restore on cold load.
//   2. board_versions (history) — saved as session snapshots: when the user
//      goes idle for SESSION_IDLE_MS or the board is destroyed (switch /
//      sign-out / unload). NOT saved every minute — versions are meant to
//      represent meaningful checkpoints, not edit-by-edit history.
//
// UndoManager tracks edits with origin === 'local' (set explicitly by mutators
// in App.jsx). Snapshot loads use origin === 'snapshot' so they don't get
// onto the undo stack. Restores use 'restore'.

import * as Y from 'yjs';
import { loadBoardSnapshot, saveBoardSnapshot, saveBoardVersion, updateBoardThumb, getBoardBgColor, getChildBoardThumbs, isBoardThumbCustom } from './boardsApi.js';
import { b64ToBytes, bytesToB64, readCards } from './yhelpers.js';
import { invalidateBoardPreview } from '../hooks/useBoardPreview.js';
// Round 23: render each board's preview ONCE on the editing client and
// upload it to private R2, so board tiles display a static image instead
// of re-decoding the Y.Doc + re-rasterizing Canvas2D on every view.
import { renderThumbnailBlob, quickVisualHash, RENDER_VERSION } from './renderThumbnail.js';
import { uploadBoardThumbnail } from './uploads.js';
import { peekBoardSnapshot, prefetchBoard } from './prefetchKinds.js';
import { getSnapshot, putSnapshot, deleteSnapshot } from './snapshotCache.js';
import { invalidate as invalidatePrefetch } from './prefetch.js';
import * as perf from './perf.js';
import { logClientError } from './errorReporting.js';
import { supabase } from './supabase.js';
// Round 16: serialize the localStorage preview envelope off the main
// thread so persistSoon's hot path no longer pays a ~50-200ms
// JSON.stringify cost mid-interaction.
import { serializeViaWorker } from './previewWorkerClient.js';
// Feature flag: PartyKit transport vs legacy Supabase Realtime. Set
// VITE_USE_PARTYKIT=true (and VITE_PARTYKIT_HOST=<deployed-url>) once
// the party is deployed.
import { attachRealtime as attachRealtimePartyKit } from './yPartyKit.js';
import { attachRealtime as attachRealtimeSupabase } from './ySupabase.js';
const attachRealtime = import.meta.env.VITE_USE_PARTYKIT === 'true'
  ? attachRealtimePartyKit
  : attachRealtimeSupabase;

const SNAP_DEBOUNCE_MS = 250;
// Re-fetching board_state after the cold load's fetch failed (see serverMerged).
const MERGE_RETRY_MS = 3000;
const MERGE_RETRY_MAX_MS = 60_000;
// The localStorage draft is a full encodeStateAsUpdate + base64 + setItem —
// tens of ms on a big board. It used to run synchronously on EVERY Y update,
// a peer's keystrokes included. Now it is written only for this tab's own
// edits, trailing-debounced but never more than DRAFT_MAX_WAIT_MS behind a
// continuous burst, and flushed synchronously on pagehide and destroy.
const DRAFT_DEBOUNCE_MS = 400;
const DRAFT_MAX_WAIT_MS = 2000;
const SESSION_IDLE_MS = 5 * 60 * 1000; // 5 min of inactivity = session boundary
// Active-editing periodic checkpoint: every 2 min of edits, take a snapshot.
// Capped per session so a runaway session doesn't fill the table.
const PERIODIC_VERSION_MS = 2 * 60 * 1000;
const PERIODIC_VERSIONS_PER_SESSION = 30;
const LOCAL_DRAFT_PREFIX = 'soleil.boards.ydoc.';

// Round 16: throttle the persistSoon → localStorage preview-cache write.
// During continuous editing persistSoon fires every ~250ms; without
// throttling the JSON.stringify+setItem chain ran that often, blocking
// the main thread mid-pan. Once every 2s is plenty for the cache to be
// fresh enough for sub-board thumbnails.
const PREVIEW_LS_THROTTLE_MS = 2000;
const _lastPreviewLsWrite = new Map(); // boardId -> Date.now() of last write

// requestIdleCallback wrapper — Round 14 introduced the same pattern in
// the entity-trie / autotag hooks. We re-use the idea here: schedule
// the localStorage preview write in idle time so it never competes with
// active interaction (pan/zoom/typing). Safari falls back to setTimeout.
const _scheduleIdle = (typeof window !== 'undefined' && window.requestIdleCallback)
  ? (fn) => window.requestIdleCallback(fn, { timeout: 1500 })
  : (fn) => setTimeout(fn, 200);

// Build the preview-shaped object + serialize it (via the worker if
// available, falling back to inline JSON.stringify) + write to localStorage.
// Pre-Round-16 this was inline in persistSoon's setTimeout callback and
// caused the half-second "hitches" the user reported. See
// plans/i-m-having-issues-where-wise-dove.md (Round 16).
async function _writePreviewToLS(boardId, ydoc) {
  try {
    if (ydoc.isDestroyed) return;
    const previewData = {
      cards: readCards(ydoc),
      arrows: ydoc.getArray('arrows').toArray().map(a => (a && a.toJSON) ? a.toJSON() : a),
      strokes: ydoc.getArray('strokes').toArray().map(s => (s && s.toJSON) ? s.toJSON() : s),
      docPages: [],
      docText: '',
    };
    let envelope;
    const workerPromise = serializeViaWorker(previewData);
    if (workerPromise) {
      try {
        const { envelope: env, workerMs } = await workerPromise;
        envelope = env;
        perf.bump('persistSoon.serializeWorker');
        perf.mark('persistSoon.serialize.ms', workerMs);
      } catch (e) {
        if (perf.isEnabled()) console.warn('[perf] persistSoon serialize worker failed; inline', e?.message || e);
        const t0 = performance.now();
        envelope = JSON.stringify({ data: previewData, savedAt: Date.now() });
        perf.bump('persistSoon.serializeInline');
        perf.mark('persistSoon.serializeInline.ms', performance.now() - t0);
      }
    } else {
      const t0 = performance.now();
      envelope = JSON.stringify({ data: previewData, savedAt: Date.now() });
      perf.bump('persistSoon.serializeInline');
      perf.mark('persistSoon.serializeInline.ms', performance.now() - t0);
    }
    // 200KB cap matches useBoardPreview's LS_MAX_PER_BOARD_BYTES.
    if (envelope.length <= 200 * 1024 && typeof localStorage !== 'undefined') {
      const tSet0 = performance.now();
      localStorage.setItem('soleil:preview:' + boardId, envelope);
      perf.mark('persistSoon.lsSetItem.ms', performance.now() - tSet0);
    }
  } catch (_) { /* quota or disabled storage — silent */ }
}

// ── Stored board preview (thumbnail) generation ───────────────────────────
// Min gap between regen attempts per board (the on-edit path is also gated
// by PREVIEW_LS_THROTTLE_MS upstream; this caps actual render+upload work).
const THUMB_THROTTLE_MS = 8000;
const _lastThumbHash = new Map();    // boardId -> last uploaded visual hash (this session)
const _lastThumbAttempt = new Map(); // boardId -> Date.now() of last attempt
const _thumbInFlight = new Set();    // boardId currently generating

// Render already-extracted board data to a WebP, upload it to R2, and stamp
// the board row. Data is captured synchronously by the caller so this is
// safe even after ydoc.destroy(). Never throws.
async function _renderUploadStampThumb({ boardId, cards, arrows, strokes, hash, workspaceId, userId }) {
  if (_thumbInFlight.has(boardId)) return;
  _thumbInFlight.add(boardId);
  try {
    // User-set cover: never overwrite it from the canvas. This is the single
    // funnel for BOTH the on-edit (maybeGenerateThumbnail) and share-link
    // (forceBoardThumbnail) paths, so one authoritative DB check here guards
    // both. Failure → fall through (default false) rather than block forever.
    try { if (await isBoardThumbCustom(boardId)) return; } catch (_) {}
    // Re-read bg_color live (the yboard handle outlives the board row it
    // was opened with, so a passed-in value would go stale if the user
    // repaints the canvas mid-session). Failure → default canvas bg.
    let bgColor = null;
    try { bgColor = await getBoardBgColor(boardId); } catch (_) {}
    // If this board contains nested boards, fetch their stored thumbnails so
    // each renders the child's real preview instead of a flat rectangle. The
    // long-lived yboard handle has no React `boards` map, so we self-fetch —
    // always fresh, scoped to direct children, and only when there's a board
    // card to paint. Same throttle/hash-dedup gating as the bg_color read.
    let boards = {};
    if (cards.some((c) => c && c.kind === 'board')) {
      try { boards = await getChildBoardThumbs(boardId); } catch (_) {}
    }
    const blob = await renderThumbnailBlob({ cards, strokes, arrows, boards, bgColor });
    if (!blob) return;
    const { src } = await uploadBoardThumbnail({ workspaceId, boardId, blob, userId });
    await updateBoardThumb(boardId, { thumbKey: src, cardCount: cards.length, thumbVersion: RENDER_VERSION });
    _lastThumbHash.set(boardId, hash);
  } catch (e) {
    if (perf.isEnabled()) console.warn('[thumb] generate failed', boardId, e?.message || e);
  } finally {
    _thumbInFlight.delete(boardId);
  }
}

// Synchronously read the live board's visual data; skip if throttled,
// unchanged, or empty; otherwise render+upload+stamp. Safe to call from an
// idle callback.
const isDrawn = (c) => c?.unplaced !== true;

function maybeGenerateThumbnail(boardId, ydoc, { workspaceId, userId }) {
  if (!workspaceId || !boardId || ydoc.isDestroyed) return;
  const now = Date.now();
  if (now - (_lastThumbAttempt.get(boardId) || 0) < THUMB_THROTTLE_MS) return;
  let cards, arrows, strokes;
  try {
    cards = readCards(ydoc);
    arrows = ydoc.getArray('arrows').toArray().map(a => (a && a.toJSON) ? a.toJSON() : a);
    strokes = ydoc.getArray('strokes').toArray().map(s => (s && s.toJSON) ? s.toJSON() : s);
  } catch (_) { return; }
  const hash = quickVisualHash(cards, strokes, arrows);
  if (_lastThumbHash.get(boardId) === hash) return;          // nothing visual changed this session
  // Empty board — nothing to render. Files waiting off the board aren't drawn
  // (lib/placement.js), so a board holding only those is empty too.
  if (!cards.some(isDrawn) && strokes.length === 0) {
    _lastThumbHash.set(boardId, hash);
    return;
  }
  _lastThumbAttempt.set(boardId, now);
  void _renderUploadStampThumb({ boardId, cards, arrows, strokes, hash, workspaceId, userId });
}

// Deliberately (re)generate a board's stored thumbnail RIGHT NOW, bypassing the
// session hash-dedup that maybeGenerateThumbnail applies. Used when the user
// creates/copies a public share link so the pasted link unfurls with a FRESH
// preview instead of the generic logo (the lazy on-edit/on-open paths can leave
// a stale or missing thumb). Non-blocking, never throws; skips empty boards.
// In-flight guard in _renderUploadStampThumb prevents a concurrent double render.
export function forceBoardThumbnail(boardId, ydoc, { workspaceId, userId } = {}) {
  if (!workspaceId || !boardId || !ydoc || ydoc.isDestroyed) return;
  let cards, arrows, strokes;
  try {
    cards = readCards(ydoc);
    arrows = ydoc.getArray('arrows').toArray().map(a => (a && a.toJSON) ? a.toJSON() : a);
    strokes = ydoc.getArray('strokes').toArray().map(s => (s && s.toJSON) ? s.toJSON() : s);
  } catch (_) { return; }
  if (!cards.some(isDrawn) && strokes.length === 0) return;   // nothing to render
  const hash = quickVisualHash(cards, strokes, arrows);
  _lastThumbAttempt.set(boardId, Date.now());
  void _renderUploadStampThumb({ boardId, cards, arrows, strokes, hash, workspaceId, userId });
}

// The on-open thumbnail backfill runs for whoever opens a board without one —
// including view-only members, whose upload is refused at presign after a
// full render. Ask can_write_board once per board per page (the same predicate
// presign enforces) before paying for the render. Resolves true / false, or
// null when the ask itself failed — falsy, so the thumbnail fails closed (it is
// never data), while a caller about to DROP data can tell "no" from "unknown".
const _canWriteBoard = new Map();   // boardId -> Promise<boolean|null>
function canWriteBoardOnce(boardId) {
  if (!supabase || !boardId) return Promise.resolve(null);
  if (!_canWriteBoard.has(boardId)) {
    _canWriteBoard.set(boardId, (async () => {
      try {
        const { data, error } = await supabase.rpc('can_write_board', { p_board_id: boardId });
        if (error) { _canWriteBoard.delete(boardId); return null; }
        return data === true;
      } catch (_) { _canWriteBoard.delete(boardId); return null; }
    })());
  }
  return _canWriteBoard.get(boardId);
}

function genSessionId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch (_) {}
  // Fallback: time-based pseudo-uuid (good enough for grouping).
  return 'sess-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function draftKey(boardId) {
  return `${LOCAL_DRAFT_PREFIX}${boardId}`;
}

function loadLocalDraft(boardId) {
  if (typeof localStorage === 'undefined') return null;
  try { return localStorage.getItem(draftKey(boardId)); }
  catch (_) { return null; }
}

function readLocalDraft(boardId) {
  const raw = loadLocalDraft(boardId);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed?.doc ? parsed : { doc: raw, version: 0 };
  } catch (_) {
    return { doc: raw, version: 0 };
  }
}

function saveLocalDraft(boardId, ydoc, version) {
  if (typeof localStorage === 'undefined') return version;
  try {
    localStorage.setItem(draftKey(boardId), JSON.stringify({
      doc: bytesToB64(Y.encodeStateAsUpdate(ydoc)),
      version,
    }));
  } catch (_) {}
  return version;
}

// The draft's version is unique across handles (sessionId-scoped), so an old
// handle's late clear — a destroy-time save resolving after a remount — can
// never match, and so never delete, the NEW handle's draft.
function clearLocalDraft(boardId, version) {
  if (typeof localStorage === 'undefined') return;
  try {
    const draft = readLocalDraft(boardId);
    if (!draft || draft.version === version) localStorage.removeItem(draftKey(boardId));
  } catch (_) {}
}

// A Y.Doc that knows which board it holds. perf.js's transact guard reads
// `_soleilBoardId` to attribute a CRDT corruption, and useYBoard's self-heal
// requires an EXACT board match before it will remount — so an untagged doc
// produces a corruption report with boardId:null, which heals nothing and
// can't even tell you which board's snapshot is bad. That has happened in the
// field, on a cross-board move, where the throwing doc was a short-lived temp
// doc built from another board's snapshot and never tagged.
//
// Use this anywhere a Y.Doc is built to hold a KNOWN board's state, including
// temporary ones — they corrupt exactly like the live doc, and being temporary
// is precisely why nobody remembers to tag them.
export function boardDoc(boardId) {
  const doc = new Y.Doc();
  try { doc._soleilBoardId = boardId ?? null; } catch (_) {}
  return doc;
}

// `fresh`: skip every local copy (draft, IndexedDB cache, hover-prefetch) and
// read board_state straight from the server. Set by useYBoard on the remount
// that follows a reset/restore: the restored bytes share this doc's Yjs
// lineage, so merging ANY pre-restore copy into the new doc silently wins over
// the restore (APP-CORE-01).
export function loadYBoard(boardId, { userId = null, user = null, workspaceId = null, hasThumb = false, onEarlyContent = null, fresh = false } = {}) {
  const _loadT0 = perf.isEnabled() ? performance.now() : 0;
  const ydoc = boardDoc(boardId);
  const cards = ydoc.getMap('cards');
  const arrows = ydoc.getArray('arrows');
  const strokes = ydoc.getArray('strokes');
  // Card-grouping — keyed by groupId. See readGroups in yhelpers.
  const groups = ydoc.getMap('groups');
  // Doc-mode types — populated only on boards with view='doc'.
  // Y.Array of { id, name, parent_id, order }; Y.Map of id → Y.XmlFragment
  // (each page's Tiptap content); Y.Map of id → { name, pageId, anchor }.
  const docPages = ydoc.getArray('docPages');
  const docPageContent = ydoc.getMap('docPageContent');
  const docBookmarks = ydoc.getMap('docBookmarks');
  const docComments = ydoc.getMap('docComments');
  // Grid (modular grid-template card) shared state. gridTemplates: id →
  // { id, name, layout } shared by all linked Grids on the board, so editing the
  // layout reflows them live. gridSequences: id → { id, name, pattern, format } —
  // sequence config only (order is derived spatially, not stored). See gridState.js.
  const gridTemplates = ydoc.getMap('gridTemplates');
  const gridSequences = ydoc.getMap('gridSequences');

  // captureTimeout (Yjs default 500ms) coalesces transactions fired within
  // the window into ONE undo step — desirable for gesture commits (a drag/
  // resize is one transaction anyway) and per-keystroke note edits. Discrete
  // actions (add/delete/group/…) call undoManager.stopCapturing() via the
  // `breakUndo` helper in buildMutators so two quick clicks don't collapse
  // into a single Cmd+Z. Made explicit here to document the intent.
  const undoManager = new Y.UndoManager(
    [cards, arrows, strokes, groups, docPages, docPageContent, docBookmarks, docComments, gridTemplates, gridSequences],
    { trackedOrigins: new Set(['local']), captureTimeout: 500 }
  );

  let snapTimer = null;
  let idleTimer = null;
  let periodicTimer = null;
  let periodicCount = 0;
  let dirty = false;
  let destroyed = false;
  // Set when this board's doc is deemed corrupt (Yjs threw). A poisoned handle
  // must NOT write its state anywhere — persisting the corrupt doc would
  // re-seed the local draft / snapshot cache / server, defeating the resync.
  let poisoned = false;
  // Set by discard(): the server's copy was replaced (restore / room reset).
  // Implies poisoned, and additionally keeps realtime from (re)attaching.
  let discarded = false;
  let initialized = false;
  // Whether this doc has merged the SERVER's copy: board_state fetched (a null
  // result counts — a new board has none). Not the same as `initialized`, which
  // is also set when that fetch threw. Until it lands, board_state is never
  // written from this doc: the upsert REPLACES the row, so a doc holding only
  // the draft or the cache paint would erase whatever the server had beyond it
  // — and under PartyKit a cold room then loads the truncated row for everyone.
  // Edits go to the draft meanwhile; a background re-fetch merges and saves.
  let serverMerged = false;
  let mergeRetryTimer = null;
  let pendingLocal = false; // a local edit is awaiting a remote save
  // This tab made an edit this session. Only those are ours to persist: an
  // APPLIED update (a peer via the room, the draft/cache paint) was already
  // persisted by whoever made it — under PartyKit the room itself writes
  // board_state. Uploading on every peer edit made each writer re-save and
  // re-render the thumbnail for everyone else's typing, and made view-only
  // members POST the whole doc into an RLS refusal after every peer edit.
  let localEdits = false;
  // A local edit landed on the instant cache/draft paint, before the server
  // snapshot merged (`initialized`). Drafted at once; saved once ready.
  let pendingEarly = false;
  const sessionId = genSessionId();
  let draftSeq = 0;
  // Version of the stored draft this handle owns: the last one it wrote, or
  // the one it found and merged on open (`ready` adopts it, so a confirmed
  // save clears an earlier session's draft too, legacy numeric versions
  // included).
  let draftVersion = `${sessionId}:0`;
  let draftTimer = null;
  let draftDirtySince = 0;   // when the oldest not-yet-drafted local edit landed; 0 = draft current
  let localSeq = 0;          // bumps per local edit; lets a save tell whether it covered them all

  // Broadcast the real persistence lifecycle so UI (DocStatusFooter) can show
  // an honest saving → saved / error state instead of a fixed timer that lies
  // on failure and flickers on peer edits.
  const emitSaveState = (state) => {
    if (typeof window === 'undefined') return;
    try {
      window.dispatchEvent(new CustomEvent('soleil-board-save-state', {
        detail: { boardId, state, ts: Date.now() },
      }));
    } catch (_) {}
  };

  // Write any not-yet-drafted local edits to the localStorage draft now.
  // Returns the version of the newest draft this handle wrote.
  const writeDraftNow = () => {
    if (draftTimer) { clearTimeout(draftTimer); draftTimer = null; }
    if (!draftDirtySince) return draftVersion;
    draftDirtySince = 0;
    draftVersion = saveLocalDraft(boardId, ydoc, `${sessionId}:${++draftSeq}`);
    return draftVersion;
  };
  const draftSoon = () => {
    const now = Date.now();
    if (!draftDirtySince) draftDirtySince = now;
    if (draftTimer) clearTimeout(draftTimer);
    const wait = Math.max(0, Math.min(DRAFT_DEBOUNCE_MS, draftDirtySince + DRAFT_MAX_WAIT_MS - now));
    draftTimer = setTimeout(() => {
      draftTimer = null;
      if (destroyed || poisoned) return;
      writeDraftNow();
    }, wait);
  };

  const persistSoon = () => {
    draftSoon();
    if (!serverMerged) return;   // draft only — see serverMerged
    if (snapTimer) clearTimeout(snapTimer);
    snapTimer = setTimeout(async () => {
      snapTimer = null;
      if (destroyed || poisoned) return;
      // saveBoardSnapshot encodes the doc synchronously before its first await,
      // so a confirmed write covers every edit up to here. A stored draft with
      // THIS version predates that, so it is safe to clear; a newer one isn't.
      const version = draftVersion;
      const seqAtSave = localSeq;
      try {
        // 'backstop': under PartyKit the room already persists board_state, so
        // this only needs to land a confirmed write often enough to clear the
        // local draft. The card_index / group_index sync inside runs every time.
        const wrote = await saveBoardSnapshot(boardId, ydoc, { stateWrite: 'backstop' });
        if (poisoned) return;   // discarded mid-save: never touch the new handle's draft
        // `false` = the backstop wasn't due and nothing reached board_state (an
        // older saveBoardSnapshot returns undefined: treat as written, as before).
        // Clearing the draft then would leave an offline edit only in memory.
        if (wrote !== false) {
          clearLocalDraft(boardId, version);
          // Nothing local happened since the save started: the server has it
          // all, so the pending draft write would only re-store saved state.
          if (localSeq === seqAtSave && draftTimer) {
            clearTimeout(draftTimer); draftTimer = null; draftDirtySince = 0;
          }
        }
        if (pendingLocal) { pendingLocal = false; emitSaveState('saved'); }
        // Round 16: refresh the localStorage preview cache for this
        // board. Pre-Round-16 this ran inline here, blocking the main
        // thread for 100-300ms (readCards + JSON.stringify + setItem),
        // which the user perceived as ~500ms hitches when a Supabase
        // save resolved mid-pan. Now: throttled to once per 2s per
        // board, scheduled via requestIdleCallback so it never steals
        // time from active interaction, and JSON.stringify runs in
        // the preview worker. See _writePreviewToLS at module scope.
        const now = Date.now();
        const lastWrite = _lastPreviewLsWrite.get(boardId) || 0;
        if (now - lastWrite >= PREVIEW_LS_THROTTLE_MS) {
          _lastPreviewLsWrite.set(boardId, now);
          _scheduleIdle(() => {
            if (destroyed) return;
            void _writePreviewToLS(boardId, ydoc);
          });
          // Regenerate the stored R2 preview as edits settle. Internally
          // throttled (THUMB_THROTTLE_MS) + content-hash-guarded, so most
          // ticks are no-ops; idle-scheduled so it never steals interaction.
          _scheduleIdle(() => {
            if (destroyed) return;
            maybeGenerateThumbnail(boardId, ydoc, { workspaceId, userId });
          });
        } else {
          perf.bump('persistSoon.lsThrottled');
        }
      }
      catch (e) {
        console.error('saveBoardSnapshot failed', e);
        if (pendingLocal) emitSaveState('error');
      }
    }, SNAP_DEBOUNCE_MS);
  };

  const armIdleVersion = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (destroyed || !dirty) return;
      saveBoardVersion(boardId, ydoc, {
        label: 'session',
        userId,
        sessionId,
        triggerKind: 'idle',
      }).then(() => { dirty = false; });
    }, SESSION_IDLE_MS);
  };

  const armPeriodicVersion = () => {
    if (periodicTimer) return; // one in flight already
    if (periodicCount >= PERIODIC_VERSIONS_PER_SESSION) return;
    periodicTimer = setTimeout(() => {
      periodicTimer = null;
      if (destroyed || !dirty) return;
      if (periodicCount >= PERIODIC_VERSIONS_PER_SESSION) return;
      periodicCount += 1;
      saveBoardVersion(boardId, ydoc, {
        label: 'periodic',
        userId,
        sessionId,
        triggerKind: 'periodic',
        opSummary: { tick: periodicCount },
      });
    }, PERIODIC_VERSION_MS);
  };

  const onUpdate = (_update, origin, _doc, tr) => {
    if (poisoned) return;   // corrupt doc — never persist derived state
    if (origin === 'snapshot') return;
    if (origin === 'restore') return;
    // Yjs marks every APPLIED update (Y.applyUpdate: the room, a peer, the
    // draft/cache paint) transaction.local === false; this tab's own edits —
    // mutators, Tiptap typing, undo/redo — are local, whatever their origin.
    const isLocal = tr ? tr.local !== false : true;
    if (!initialized) {
      // An edit made on the instant cache/draft paint, before the server
      // snapshot has merged. Draft it now, so leaving before the snapshot
      // lands doesn't drop it; `ready` saves it once merged. Never board_state
      // from here: that upsert would overwrite the server's newer state with a
      // doc that hasn't merged it yet.
      if (!isLocal) return;
      pendingEarly = true;
      localEdits = true;
      localSeq += 1;
      if (origin === 'local') { pendingLocal = true; emitSaveState('saving'); }
      draftSoon();
      return;
    }
    dirty = true;
    armIdleVersion();
    armPeriodicVersion();
    if (!isLocal) return;
    localEdits = true;
    localSeq += 1;
    // Only a LOCAL edit drives the "Saving…" footer (peer edits shouldn't
    // flip your own save indicator). Local means the canvas ('local'), doc
    // structure ('doc-struct') and typing in a doc or note — y-prosemirror's
    // binding, whose origin is its PluginKey ('y-sync$').
    if (origin === 'local' || origin === 'doc-struct' || origin?.key === 'y-sync$') { pendingLocal = true; emitSaveState('saving'); }
    persistSoon();
  };
  ydoc.on('update', onUpdate);

  // Unsaved local state the server may not have: edits made on the early
  // paint, or a draft left by an earlier session that never confirmed its
  // save. Runs once the server's copy has merged, so the save is whole.
  const saveCarried = () => {
    if (destroyed || poisoned) return;
    if (pendingEarly || localEdits) { localEdits = true; persistSoon(); return; }
    if (!hadDraft) return;
    // Only a draft, no edit this session. Ask before uploading it: a view-only
    // member's draft (older builds drafted every peer update) would otherwise
    // POST the whole doc into an RLS refusal on every open and close, forever.
    const adopted = draftVersion;
    canWriteBoardOnce(boardId).then((ok) => {
      if (destroyed || poisoned) return;
      if (ok === true) { localEdits = true; persistSoon(); }
      // Can't write here: the draft can never be saved, so drop it. Unknown
      // (the ask failed) keeps it for the next open.
      else if (ok === false) clearLocalDraft(boardId, adopted);
    });
  };
  // The cold-load fetch failed: keep trying in the background, so a network
  // blip on open doesn't leave this session's edits stuck in the draft.
  const retryServerMerge = (delay) => {
    mergeRetryTimer = setTimeout(async () => {
      mergeRetryTimer = null;
      if (destroyed || poisoned || serverMerged) return;
      let b64;
      try { b64 = await loadBoardSnapshot(boardId); }
      catch (_) {
        if (!destroyed && !poisoned) retryServerMerge(Math.min(delay * 2, MERGE_RETRY_MAX_MS));
        return;
      }
      if (destroyed || poisoned || serverMerged) return;
      if (b64) {
        try { Y.applyUpdate(ydoc, b64ToBytes(b64), 'snapshot'); }
        catch (e) { try { logClientError(e, { kind: 'yboard-snapshot-merge' }); } catch (_) {} return; }
        serverApplied = true;
      }
      serverMerged = true;
      saveCarried();
    }, delay);
  };

  // Whether the SERVER's snapshot has been applied — not just the instant
  // cache/draft paint, which can be a day stale. A cleanup that deletes what
  // it judges unfinished must not judge from that paint (useYBoard `synced`).
  let serverApplied = false;
  let hadDraft = false;
  const ready = (async () => {
    try {
      const localDraft = fresh ? null : readLocalDraft(boardId);
      hadDraft = !!localDraft?.doc;
      // Own the draft we are about to merge: the save that later confirms
      // this doc clears it by version, whichever session wrote it.
      if (hadDraft) draftVersion = localDraft.version;
      if (localDraft?.doc) {
        const bytes = b64ToBytes(localDraft.doc);
        const _t0 = perf.isEnabled() ? performance.now() : 0;
        Y.applyUpdate(ydoc, bytes, 'snapshot');
        if (_t0) {
          const ms = performance.now() - _t0;
          perf.mark('yboard.applyDraft.ms', ms);
          perf.bump('yboard.applyDraft');
          if (ms > 100) console.warn('[perf] slow yboard.applyDraft', `${ms.toFixed(0)}ms`, `${(bytes.length/1024).toFixed(1)}KB`, boardId);
        }
      }
      // Instant reopen: paint the last-cached snapshot before the network
      // lands. origin 'snapshot' = same semantics as the draft/server applies
      // (never marks dirty / never persists). The server fetch below still runs
      // and reconciles — its full state carries tombstones, so nothing stale
      // survives. Skipped when a local draft exists (that's newer, unsaved).
      let paintedEarly = !!localDraft?.doc;
      if (!localDraft?.doc && !fresh) {
        try {
          const cached = await getSnapshot(boardId, userId);
          if (cached?.b64 && !destroyed) {
            Y.applyUpdate(ydoc, b64ToBytes(cached.b64), 'snapshot');
            paintedEarly = true;
            perf.bump('yboard.cacheHit');
          }
        } catch (_) {}
      }
      // Render whatever we have NOW (cache or draft) so the board appears
      // instantly, ahead of the network snapshot.
      if (paintedEarly) { try { onEarlyContent?.(); } catch (_) {} }

      // Consume a hover-warmed snapshot if one is sitting in the
      // prefetch cache; otherwise fall through to the fetcher (which
      // dedupes against any in-flight prefetch from the same hover).
      let b64 = fresh ? null : peekBoardSnapshot(boardId);
      if (fresh) {
        // Straight from the server, past the prefetch cache AND its in-flight
        // dedupe: either may hold board_state from before the restore.
        try { invalidatePrefetch(`board:${boardId}`); } catch (_) {}
        b64 = await loadBoardSnapshot(boardId);
      } else if (b64 == null) {
        const _tFetch0 = perf.isEnabled() ? performance.now() : 0;
        b64 = await prefetchBoard(boardId, { lane: 'high' });
        if (_tFetch0) {
          const ms = performance.now() - _tFetch0;
          perf.mark('yboard.prefetch.ms', ms);
          perf.bump('yboard.prefetch');
          if (ms > 200) console.warn('[perf] slow yboard.prefetch', `${ms.toFixed(0)}ms`, boardId);
        }
      } else {
        perf.bump('yboard.prefetch.hot');
      }
      if (b64) {
        const bytes = b64ToBytes(b64);
        const _t0 = perf.isEnabled() ? performance.now() : 0;
        Y.applyUpdate(ydoc, bytes, 'snapshot');
        serverApplied = true;
        if (_t0) {
          const ms = performance.now() - _t0;
          perf.mark('yboard.applySnapshot.ms', ms);
          perf.bump('yboard.applySnapshot');
          perf.gauge('yboard.lastSnapshotBytes', bytes.length);
          if (ms > 100) console.warn('[perf] slow yboard.applySnapshot', `${ms.toFixed(0)}ms`, `${(bytes.length/1024).toFixed(1)}KB`, boardId);
        }
        // Refresh the instant-reopen cache with the authoritative server state.
        if (!destroyed) putSnapshot(boardId, userId, b64);
      }
      // Reached only when the fetch AND the apply succeeded (null = a board
      // with no board_state yet, which is merged by definition).
      serverMerged = true;
    } catch (e) {
      console.error('loadBoardSnapshot failed', e);
      try { logClientError(e, { kind: 'yboard-snapshot-load' }); } catch (_) {}
    }
    initialized = true;
    if (serverMerged) saveCarried();
    else if (!destroyed) retryServerMerge(MERGE_RETRY_MS);
    if (_loadT0) {
      const ms = performance.now() - _loadT0;
      perf.mark('yboard.loadYBoard.ms', ms);
      perf.bump('yboard.loadYBoard');
      if (ms > 300) console.warn('[perf] slow yboard.loadYBoard', `${ms.toFixed(0)}ms`, boardId);
    }
    return ydoc;
  })();

  // Open the realtime channel after the cold-load snapshot is applied so
  // peers don't see a brief "empty doc" while we're catching up.
  let realtime = { destroy() {}, awareness: null };
  ready.then(() => {
    if (destroyed || discarded) return;
    realtime = attachRealtime(ydoc, boardId, { user });
    // Backfill the stored preview for boards that don't have one yet (e.g.
    // existing boards opened for the first time since this shipped, even
    // view-only with zero edits). Boards that already have a thumb refresh
    // via the on-edit / on-close paths instead. Idle-scheduled so it never
    // competes with first paint.
    if (!hasThumb && workspaceId) {
      _scheduleIdle(() => {
        if (destroyed) return;
        canWriteBoardOnce(boardId).then((ok) => {
          // Not from a doc missing the server's copy (a failed cold-load
          // fetch): that would upload a preview of the stale cache paint.
          if (ok && !destroyed && !poisoned && serverMerged) maybeGenerateThumbnail(boardId, ydoc, { workspaceId, userId });
        });
      });
    }
  }).catch((e) => {
    // Attaching the realtime provider (or the cold-load it awaits) rejected —
    // previously silent (no .catch). Log so it's visible; the perf.js guard
    // already handles any Yjs-apply throw inside the provider.
    try { logClientError(e, { kind: 'yboard-attach' }); } catch (_) {}
  });

  // Flush on hard page close. The localStorage draft protects the user's own
  // data — it is debounced, so land any pending draft synchronously first —
  // and the snapshot flush shrinks the window where another peer would
  // cold-load a stale snapshot. We use pagehide instead of beforeunload
  // because mobile Safari only reliably fires pagehide on tab close.
  const onPageHide = () => {
    if (poisoned) return;
    writeDraftNow();
    if (!initialized || !serverMerged) return;
    if (snapTimer) {
      clearTimeout(snapTimer);
      snapTimer = null;
      saveBoardSnapshot(boardId, ydoc).catch(() => {});
    }
  };
  if (typeof window !== 'undefined') window.addEventListener('pagehide', onPageHide);

  // Flush any pending debounced snapshot to the backend immediately. Called
  // e.g. when a doc card closes, so an edit made in the last ~250ms can't be
  // lost if the tab is closed right after. No-op when nothing is pending.
  const flushNow = () => {
    if (destroyed || !initialized || !serverMerged || poisoned) return;
    if (snapTimer) {
      clearTimeout(snapTimer);
      snapTimer = null;
      saveBoardSnapshot(boardId, ydoc).catch(() => {});
    }
  };

  const destroy = () => {
    destroyed = true;
    if (snapTimer) clearTimeout(snapTimer);
    if (mergeRetryTimer) clearTimeout(mergeRetryTimer);
    if (idleTimer) clearTimeout(idleTimer);
    if (periodicTimer) clearTimeout(periodicTimer);
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', onPageHide);
    try { realtime?.destroy?.(); } catch (_) {}
    ydoc.off('update', onUpdate);
    // A poisoned (corrupt or discarded) doc skips ALL persistence — writing
    // its state back to the draft / snapshot cache / server / version history
    // would re-seed the corruption, or undo the restore that replaced it.
    if (poisoned) {
      if (draftTimer) { clearTimeout(draftTimer); draftTimer = null; }
    } else if (!initialized || !serverMerged) {
      // Left before the server's copy merged: edits made on the early paint,
      // or after a failed cold-load fetch, go to the draft only (see onUpdate,
      // serverMerged). The next open merges them.
      writeDraftNow();
    } else {
      const version = writeDraftNow();
      // Refresh the instant-reopen cache with the latest state on close so the
      // next open of this board paints current content, not last session's.
      try { putSnapshot(boardId, userId, bytesToB64(Y.encodeStateAsUpdate(ydoc))); } catch (_) {}
      if (localEdits) {
        saveBoardSnapshot(boardId, ydoc)
          .then(() => {
            clearLocalDraft(boardId, version);
            invalidateBoardPreview(boardId);
            invalidatePrefetch(`board:${boardId}`);
          })
          .catch(() => {});
      } else {
        // Nothing of ours to save (a viewer, or a writer who only watched).
        // The prefetch cache may still hold board_state from before the peer
        // edits this session showed, so drop it.
        try { invalidatePrefetch(`board:${boardId}`); } catch (_) {}
      }
      if (dirty) {
        saveBoardVersion(boardId, ydoc, {
          label: 'close',
          userId,
          sessionId,
          triggerKind: 'destroy',
        });
        // Final stored-preview refresh on close, but only if the board was
        // actually edited this session (otherwise the existing thumb / the
        // open-backfill already covers it). Capture data synchronously NOW
        // — ydoc.destroy() runs just below — then fire-and-forget the async
        // render+upload+stamp from the detached plain-JS arrays.
        if (workspaceId && localEdits) {
          try {
            const cards = readCards(ydoc);
            const arrows = ydoc.getArray('arrows').toArray().map(a => (a && a.toJSON) ? a.toJSON() : a);
            const strokes = ydoc.getArray('strokes').toArray().map(s => (s && s.toJSON) ? s.toJSON() : s);
            const hash = quickVisualHash(cards, strokes, arrows);
            if (_lastThumbHash.get(boardId) !== hash && (cards.some(isDrawn) || strokes.length)) {
              void _renderUploadStampThumb({ boardId, cards, arrows, strokes, hash, workspaceId, userId });
            }
          } catch (_) { /* never block teardown */ }
        }
      }
    }
    undoManager.destroy();
    ydoc.destroy();
  };

  return {
    ydoc,
    undoManager,
    ready,
    destroy,
    flushNow,
    sessionId,
    getAwareness: () => realtime?.awareness || null,
    // After `ready` (the cold load) the realtime attach runs; this waits for it
    // to finish syncing with the room. true = synced, false = timed out.
    whenRoomSynced: async (timeoutMs = 8000) => {
      await ready;
      await Promise.resolve();   // the attach is a then() on `ready`
      if (destroyed || typeof realtime?.whenSynced !== 'function') return false;
      return realtime.whenSynced(timeoutMs);
    },
    serverApplied: () => serverApplied,
    boardId,
    // Mark this handle's doc corrupt so its teardown skips all persistence.
    // Called by useYBoard right before it purges caches + remounts.
    poison: () => { poisoned = true; },
    // The server's copy of this board was replaced under this doc — a version
    // restore, a move into it, a room reset. This doc is now the pre-reset
    // state in the SAME Yjs lineage as the replacement, so anything it writes
    // (draft, cache, board_state, or a push into the wiped room through a
    // provider reconnect) merges back over the reset and silently undoes it.
    // So: stop persisting, drop the local copies, and leave the room NOW —
    // useYBoard's remount comes after a jitter of up to 1.5s.
    discard: () => {
      if (discarded) return;
      discarded = true;
      poisoned = true;
      if (snapTimer) { clearTimeout(snapTimer); snapTimer = null; }
      if (draftTimer) { clearTimeout(draftTimer); draftTimer = null; }
      if (mergeRetryTimer) { clearTimeout(mergeRetryTimer); mergeRetryTimer = null; }
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
      if (periodicTimer) { clearTimeout(periodicTimer); periodicTimer = null; }
      try { realtime?.destroy?.(); } catch (_) {}
      realtime = { destroy() {}, awareness: null };
      try { invalidatePrefetch(`board:${boardId}`); } catch (_) {}
      purgeLocalBoardState(boardId, userId, { stash: false });
    },
  };
}

// Drop the locally-cached bytes for a board (localStorage draft + IndexedDB
// snapshot) so the next cold-load pulls clean state from the server instead of
// re-applying a possibly-corrupt cached/draft update. Used by the Yjs
// corruption self-heal in useYBoard.
//
// The draft is STASHED (not silently destroyed) under a `corrupt.` key first:
// any edits that never reached board_state ride in that draft, and support can
// recover them. One stash per board — a repeat corruption overwrites it.
// `stash: false` for a restore/reset, where the draft is just the replaced state.
export function purgeLocalBoardState(boardId, uid = null, { stash = true } = {}) {
  if (!boardId) return;
  try {
    if (typeof localStorage !== 'undefined') {
      const draft = stash ? localStorage.getItem(draftKey(boardId)) : null;
      if (draft) {
        try { localStorage.setItem(`soleil.boards.ydoc.corrupt.${boardId}`, draft); } catch (_) {}
      }
      localStorage.removeItem(draftKey(boardId));
    }
  } catch (_) {}
  try { void deleteSnapshot(boardId, uid); } catch (_) {}
}

// (restoreVersionInto lived here until 2026-08: clear-the-doc + applyUpdate
// is BROKEN for Yjs — the clear-ops out-clock the snapshot's set-ops and the
// doc empties instead of restoring. All restores go through boardsApi's
// bulletproofRestore, which replaces board_state and resets the room.)
