// The Shared page's two lists — files shared with you, files you've shared —
// and the sidebar's unread count, read once for the whole app and shared
// (0424: list_shared_with_me, list_my_file_shares). They are read again when
// something changes them (SHARED_FILES_CHANGED_EVENT from the viewer, the
// page or the bell; FILE_SHARE_CHANGED_EVENT from the owner's dialog) and when
// the window comes back, at most once a minute.
//
// Thumbnails come from the party (/file-thumbs: presigned posters, never
// keys), for the rows the page shows, and are kept until shortly before they
// expire.
import { useEffect, useState } from 'react';
import { listSharedWithMe, listMyFileShares, fetchSharedThumbs } from '../lib/fileShares.js';
import { SHARED_FILES_CHANGED_EVENT } from '../lib/sharedFileBus.js';
import { FILE_SHARE_CHANGED_EVENT } from '../lib/fileShareBus.js';

const FOCUS_MIN_MS = 60 * 1000;
const THUMB_KEEP_MS = 50 * 60 * 1000;   // the party signs them for an hour

const state = {
  withMe: [], byMe: [], loading: false, loaded: false, error: false,
  thumbs: {},          // token → { url, at }
};
const listeners = new Set();
let lastRead = 0;
// The DEV harness (?fileshareqa=shared-page) reads a fake instead.
let source = null;
export function setSharedFilesSource(api) {
  source = api || null;
  Object.assign(state, { withMe: [], byMe: [], loading: false, loaded: false, error: false, thumbs: {} });
  lastRead = 0;
}
let inflight = null;
let wired = false;

function emit() { for (const fn of listeners) { try { fn(); } catch (_) {} } }
function set(patch) { Object.assign(state, patch); emit(); }

export function unreadCount(items) {
  return (items || []).filter((x) => x && x.unread).length;
}

export function refreshSharedFiles({ force = false } = {}) {
  if (inflight) return inflight;
  if (!force && state.loaded && Date.now() - lastRead < FOCUS_MIN_MS) return Promise.resolve();
  set({ loading: true });
  inflight = (async () => {
    try {
      const api = source || { listSharedWithMe, listMyFileShares };
      const [w, b] = await Promise.all([api.listSharedWithMe({ limit: 200 }), api.listMyFileShares({ limit: 200 })]);
      const withMe = Array.isArray(w?.data?.items) ? w.data.items : state.withMe;
      const byMe = Array.isArray(b?.data?.items) ? b.data.items : state.byMe;
      lastRead = Date.now();
      set({ withMe, byMe, loading: false, loaded: true, error: !!(w?.error && b?.error) });
    } catch (_) {
      set({ loading: false, error: true });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

// Presigned thumbnails for these tokens (the rows on screen), fetched in one
// call for the ones without a fresh one.
export async function loadSharedThumbs(tokens) {
  const now = Date.now();
  const need = [...new Set(tokens || [])].filter((t) => {
    const have = state.thumbs[t];
    return !have || now - have.at > THUMB_KEEP_MS;
  }).slice(0, 50);
  if (!need.length) return;
  const urls = await (source?.fetchSharedThumbs || fetchSharedThumbs)(need);
  const at = Date.now();
  const next = { ...state.thumbs };
  for (const t of need) next[t] = { url: urls[t] || null, at };
  set({ thumbs: next });
}

function wire() {
  if (wired || typeof document === 'undefined') return;
  wired = true;
  document.addEventListener(SHARED_FILES_CHANGED_EVENT, () => { void refreshSharedFiles({ force: true }); });
  document.addEventListener(FILE_SHARE_CHANGED_EVENT, () => { void refreshSharedFiles({ force: true }); });
  window.addEventListener('focus', () => { void refreshSharedFiles(); });
}

// { withMe, byMe, unread, loading, loaded, error, thumbs }. `enabled` false
// (the hold) reads nothing.
export function useSharedFiles({ enabled = true } = {}) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    const fn = () => tick((n) => n + 1);
    listeners.add(fn);
    wire();
    void refreshSharedFiles();
    return () => { listeners.delete(fn); };
  }, [enabled]);
  return {
    withMe: state.withMe,
    byMe: state.byMe,
    unread: unreadCount(state.withMe),
    loading: state.loading,
    loaded: state.loaded,
    error: state.error,
    thumbs: state.thumbs,
  };
}

// Tests only.
export function __resetSharedFiles() {
  Object.assign(state, { withMe: [], byMe: [], loading: false, loaded: false, error: false, thumbs: {} });
  lastRead = 0; inflight = null;
}
