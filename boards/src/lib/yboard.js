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
import { b64ToBytes, bytesToB64 } from './yhelpers.js';
import { invalidateBoardPreview } from '../hooks/useBoardPreview.js';
import { peekBoardSnapshot, prefetchBoard } from './prefetchKinds.js';
import { invalidate as invalidatePrefetch } from './prefetch.js';
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
const LOCAL_DRAFT_PREFIX = 'soleil.boards.ydoc.';

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
  let dirty = false;
  let destroyed = false;
  let initialized = false;
  let draftVersion = 0;

  const persistSoon = () => {
    const version = saveLocalDraft(boardId, ydoc, ++draftVersion);
    if (snapTimer) clearTimeout(snapTimer);
    snapTimer = setTimeout(async () => {
      snapTimer = null;
      if (destroyed) return;
      try {
        await saveBoardSnapshot(boardId, ydoc);
        clearLocalDraft(boardId, version);
      }
      catch (e) { console.error('saveBoardSnapshot failed', e); }
    }, SNAP_DEBOUNCE_MS);
  };

  const armIdleVersion = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (destroyed || !dirty) return;
      saveBoardVersion(boardId, ydoc, { label: 'session', userId })
        .then(() => { dirty = false; })
        .catch((e) => console.warn('session-idle saveBoardVersion failed', e));
    }, SESSION_IDLE_MS);
  };

  const onUpdate = (_update, origin) => {
    if (!initialized) return;
    if (origin === 'snapshot') return;
    dirty = true;
    persistSoon();
    armIdleVersion();
  };
  ydoc.on('update', onUpdate);

  const ready = (async () => {
    try {
      const localDraft = readLocalDraft(boardId);
      if (localDraft?.doc) Y.applyUpdate(ydoc, b64ToBytes(localDraft.doc), 'snapshot');
      // Consume a hover-warmed snapshot if one is sitting in the
      // prefetch cache; otherwise fall through to the fetcher (which
      // dedupes against any in-flight prefetch from the same hover).
      const b64 = peekBoardSnapshot(boardId) ?? await prefetchBoard(boardId, { lane: 'high' });
      if (b64) Y.applyUpdate(ydoc, b64ToBytes(b64), 'snapshot');
    } catch (e) {
      console.error('loadBoardSnapshot failed', e);
    }
    initialized = true;
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
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', onPageHide);
    try { realtime?.destroy?.(); } catch (_) {}
    ydoc.off('update', onUpdate);
    // CRITICAL: only flush if we actually finished loading. Otherwise we'd
    // overwrite the real persisted state with our empty pre-load state —
    // which is exactly what happens during a React StrictMode double-mount
    // (mount → cleanup → mount) before the async ready promise resolves.
    if (initialized) {
      const version = saveLocalDraft(boardId, ydoc, ++draftVersion);
      saveBoardSnapshot(boardId, ydoc)
        .then(() => {
          clearLocalDraft(boardId, version);
          // Force-refresh thumbnail caches for this board (parent canvases
          // showing it will refetch the latest snapshot).
          invalidateBoardPreview(boardId);
          // Drop the prefetch cache too — next navigation should pull fresh.
          invalidatePrefetch(`board:${boardId}`);
        })
        .catch(() => {});
      if (dirty) {
        saveBoardVersion(boardId, ydoc, { label: 'close', userId }).catch(() => {});
      }
    }
    undoManager.destroy();
    ydoc.destroy();
  };

  return { ydoc, undoManager, ready, destroy, getAwareness: () => realtime?.awareness || null };
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
  }, 'restore');
  Y.applyUpdate(ydoc, bytes, 'restore');
}
