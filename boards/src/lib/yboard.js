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
import { loadBoardSnapshot, saveBoardSnapshot, saveBoardVersion } from './boardsApi.js';
import { b64ToBytes, bytesToB64, readCards } from './yhelpers.js';
import { invalidateBoardPreview } from '../hooks/useBoardPreview.js';
import { peekBoardSnapshot, prefetchBoard } from './prefetchKinds.js';
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

export function loadYBoard(boardId, { userId = null, user = null } = {}) {
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

  const undoManager = new Y.UndoManager(
    [cards, arrows, strokes, groups, docPages, docPageContent, docBookmarks, docComments],
    { trackedOrigins: new Set(['local']) }
  );

  let snapTimer = null;
  let idleTimer = null;
  let periodicTimer = null;
  let periodicCount = 0;
  let dirty = false;
  let destroyed = false;
  let initialized = false;
  let draftVersion = 0;
  const sessionId = genSessionId();

  const persistSoon = () => {
    const version = saveLocalDraft(boardId, ydoc, ++draftVersion);
    if (snapTimer) clearTimeout(snapTimer);
    snapTimer = setTimeout(async () => {
      snapTimer = null;
      if (destroyed) return;
      try {
        await saveBoardSnapshot(boardId, ydoc);
        clearLocalDraft(boardId, version);
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
        } else {
          perf.bump('persistSoon.lsThrottled');
        }
      }
      catch (e) { console.error('saveBoardSnapshot failed', e); }
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
