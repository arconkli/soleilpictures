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
import { loadBoardSnapshot, saveBoardSnapshot, saveBoardVersion, updateBoardThumb, getBoardBgColor } from './boardsApi.js';
import { b64ToBytes, bytesToB64, readCards } from './yhelpers.js';
import { invalidateBoardPreview } from '../hooks/useBoardPreview.js';
// Round 23: render each board's preview ONCE on the editing client and
// upload it to private R2, so board tiles display a static image instead
// of re-decoding the Y.Doc + re-rasterizing Canvas2D on every view.
import { renderThumbnailBlob, quickVisualHash, RENDER_VERSION } from './renderThumbnail.js';
import { uploadBoardThumbnail } from './uploads.js';
import { peekBoardSnapshot, prefetchBoard } from './prefetchKinds.js';
import { getSnapshot, putSnapshot } from './snapshotCache.js';
import { invalidate as invalidatePrefetch } from './prefetch.js';
import * as perf from './perf.js';
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
    // Re-read bg_color live (the yboard handle outlives the board row it
    // was opened with, so a passed-in value would go stale if the user
    // repaints the canvas mid-session). Failure → default canvas bg.
    let bgColor = null;
    try { bgColor = await getBoardBgColor(boardId); } catch (_) {}
    const blob = await renderThumbnailBlob({ cards, strokes, arrows, bgColor });
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
  if (cards.length === 0 && strokes.length === 0) {          // empty board — nothing to render
    _lastThumbHash.set(boardId, hash);
    return;
  }
  _lastThumbAttempt.set(boardId, now);
  void _renderUploadStampThumb({ boardId, cards, arrows, strokes, hash, workspaceId, userId });
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

function clearLocalDraft(boardId, version) {
  if (typeof localStorage === 'undefined') return;
  try {
    const draft = readLocalDraft(boardId);
    if (!draft || draft.version === version) localStorage.removeItem(draftKey(boardId));
  } catch (_) {}
}

export function loadYBoard(boardId, { userId = null, user = null, workspaceId = null, hasThumb = false, onEarlyContent = null } = {}) {
  const _loadT0 = perf.isEnabled() ? performance.now() : 0;
  const ydoc = new Y.Doc();
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

  // captureTimeout (Yjs default 500ms) coalesces transactions fired within
  // the window into ONE undo step — desirable for gesture commits (a drag/
  // resize is one transaction anyway) and per-keystroke note edits. Discrete
  // actions (add/delete/group/…) call undoManager.stopCapturing() via the
  // `breakUndo` helper in buildMutators so two quick clicks don't collapse
  // into a single Cmd+Z. Made explicit here to document the intent.
  const undoManager = new Y.UndoManager(
    [cards, arrows, strokes, groups, docPages, docPageContent, docBookmarks, docComments],
    { trackedOrigins: new Set(['local']), captureTimeout: 500 }
  );

  let snapTimer = null;
  let idleTimer = null;
  let periodicTimer = null;
  let periodicCount = 0;
  let dirty = false;
  let destroyed = false;
  let initialized = false;
  let draftVersion = 0;
  let pendingLocal = false; // a local edit is awaiting a remote save
  const sessionId = genSessionId();

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

  const persistSoon = () => {
    const version = saveLocalDraft(boardId, ydoc, ++draftVersion);
    if (snapTimer) clearTimeout(snapTimer);
    snapTimer = setTimeout(async () => {
      snapTimer = null;
      if (destroyed) return;
      try {
        await saveBoardSnapshot(boardId, ydoc);
        clearLocalDraft(boardId, version);
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

  const onUpdate = (_update, origin) => {
    if (!initialized) return;
    if (origin === 'snapshot') return;
    if (origin === 'restore') return;
    dirty = true;
    // Only a LOCAL edit drives the "Saving…" footer (peer edits shouldn't
    // flip your own save indicator).
    if (origin === 'local') { pendingLocal = true; emitSaveState('saving'); }
    persistSoon();
    armIdleVersion();
    armPeriodicVersion();
  };
  ydoc.on('update', onUpdate);

  const ready = (async () => {
    try {
      const localDraft = readLocalDraft(boardId);
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
      if (!localDraft?.doc) {
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
      let b64 = peekBoardSnapshot(boardId);
      if (b64 == null) {
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
    } catch (e) {
      console.error('loadBoardSnapshot failed', e);
    }
    initialized = true;
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
    if (destroyed) return;
    realtime = attachRealtime(ydoc, boardId, { user });
    // Backfill the stored preview for boards that don't have one yet (e.g.
    // existing boards opened for the first time since this shipped, even
    // view-only with zero edits). Boards that already have a thumb refresh
    // via the on-edit / on-close paths instead. Idle-scheduled so it never
    // competes with first paint.
    if (!hasThumb && workspaceId) {
      _scheduleIdle(() => {
        if (destroyed) return;
        maybeGenerateThumbnail(boardId, ydoc, { workspaceId, userId });
      });
    }
  });

  // Flush on hard page close. The localStorage draft already protects the
  // user's own data (saveLocalDraft runs synchronously on every change);
  // this just shrinks the window where another peer would cold-load a
  // stale snapshot. We use pagehide instead of beforeunload because mobile
  // Safari only reliably fires pagehide on tab close.
  const onPageHide = () => {
    if (!initialized) return;
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
    if (destroyed || !initialized) return;
    if (snapTimer) {
      clearTimeout(snapTimer);
      snapTimer = null;
      saveBoardSnapshot(boardId, ydoc).catch(() => {});
    }
  };

  const destroy = () => {
    destroyed = true;
    if (snapTimer) clearTimeout(snapTimer);
    if (idleTimer) clearTimeout(idleTimer);
    if (periodicTimer) clearTimeout(periodicTimer);
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', onPageHide);
    try { realtime?.destroy?.(); } catch (_) {}
    ydoc.off('update', onUpdate);
    if (initialized) {
      const version = saveLocalDraft(boardId, ydoc, ++draftVersion);
      // Refresh the instant-reopen cache with the latest state on close so the
      // next open of this board paints current content, not last session's.
      try { putSnapshot(boardId, userId, bytesToB64(Y.encodeStateAsUpdate(ydoc))); } catch (_) {}
      saveBoardSnapshot(boardId, ydoc)
        .then(() => {
          clearLocalDraft(boardId, version);
          invalidateBoardPreview(boardId);
          invalidatePrefetch(`board:${boardId}`);
        })
        .catch(() => {});
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
        if (workspaceId) {
          try {
            const cards = readCards(ydoc);
            const arrows = ydoc.getArray('arrows').toArray().map(a => (a && a.toJSON) ? a.toJSON() : a);
            const strokes = ydoc.getArray('strokes').toArray().map(s => (s && s.toJSON) ? s.toJSON() : s);
            const hash = quickVisualHash(cards, strokes, arrows);
            if (_lastThumbHash.get(boardId) !== hash && (cards.length || strokes.length)) {
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
  };
}

export function restoreVersionInto(ydoc, b64) {
  if (!b64) return;
  const bytes = b64ToBytes(b64);
  ydoc.transact(() => {
    const cards = ydoc.getMap('cards');
    cards.forEach((_v, k) => cards.delete(k));
    const arrows = ydoc.getArray('arrows');
    if (arrows.length > 0) arrows.delete(0, arrows.length);
    const strokes = ydoc.getArray('strokes');
    if (strokes.length > 0) strokes.delete(0, strokes.length);
    const groups = ydoc.getMap('groups');
    groups.forEach((_v, k) => groups.delete(k));
    const docPages = ydoc.getArray('docPages');
    if (docPages.length > 0) docPages.delete(0, docPages.length);
    const docPageContent = ydoc.getMap('docPageContent');
    docPageContent.forEach((_v, k) => docPageContent.delete(k));
    const docBookmarks = ydoc.getMap('docBookmarks');
    docBookmarks.forEach((_v, k) => docBookmarks.delete(k));
    const docComments = ydoc.getMap('docComments');
    docComments.forEach((_v, k) => docComments.delete(k));
  }, 'restore');
  const _t0 = perf.isEnabled() ? performance.now() : 0;
  Y.applyUpdate(ydoc, bytes, 'restore');
  if (_t0) {
    const ms = performance.now() - _t0;
    perf.mark('yboard.applyRestore.ms', ms);
    perf.bump('yboard.applyRestore');
    if (ms > 100) console.warn('[perf] slow yboard.applyRestore', `${ms.toFixed(0)}ms`, `${(bytes.length/1024).toFixed(1)}KB`);
  }
}
