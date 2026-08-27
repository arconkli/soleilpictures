import { useState, useCallback, useRef } from 'react';
import { listGridLayouts } from '../lib/gridLayoutsApi.js';

// Saved grid layouts for the Templates panel.
//
// Shaped after useWorkspacePalettes: a module-scoped cache plus an inflight map,
// loaded lazily by ensureLoaded() when the panel first opens. That matters more
// here than it looks — the panel is closed almost all of the time, and
// CanvasSurface mounts on every board navigation. Fetching on mount would be a
// round-trip per board open for data nobody asked to see.
//
// It is deliberately NOT modelled on useVoteCards, which also opens a realtime
// channel. Templates change when YOU save, rename or delete one, not when a
// collaborator does something — so a subscription would buy nothing and cost a
// channel per board open. The mutation paths call reload() instead.
//
// The one thing this adds over useWorkspacePalettes is an invalidation path.
// That hook writes _cache once and its loadedFor ref then short-circuits
// forever, which is fine for palettes (read-only, derived from cards) and wrong
// for a library you can write to.
//
// Keyed by USER, not workspace: RLS returns everything the caller may see in one
// query — their own templates plus every workspace they belong to — so there is
// one fetch per session and the active-workspace split happens in the caller.

const _cache = new Map();     // userId -> rows
const _inflight = new Map();  // userId -> Promise<rows>

function fetchFor(userId) {
  let p = _inflight.get(userId);
  if (!p) {
    p = listGridLayouts()
      .then((rows) => { _cache.set(userId, rows); _inflight.delete(userId); return rows; })
      .catch((e) => { _inflight.delete(userId); throw e; });
    _inflight.set(userId, p);
  }
  return p;
}

export function useGridLayouts(userId) {
  const [rows, setRows] = useState(() => _cache.get(userId) || []);
  const loadedFor = useRef(null);

  const ensureLoaded = useCallback(() => {
    if (!userId) return;
    if (loadedFor.current === userId) return;
    loadedFor.current = userId;
    if (_cache.has(userId)) { setRows(_cache.get(userId)); return; }
    fetchFor(userId)
      .then((next) => { if (loadedFor.current === userId) setRows(next); })
      // A library that fails to load leaves the built-in section intact; the
      // panel is still usable, which is better than an error state over a
      // feature the user may not even be reaching for.
      .catch(() => {});
  }, [userId]);

  // Call after any write. Busts the cache and re-reads, so the panel shows what
  // the database actually holds rather than what we hoped it would.
  const reload = useCallback(() => {
    if (!userId) return Promise.resolve([]);
    _cache.delete(userId);
    _inflight.delete(userId);
    loadedFor.current = userId;
    return fetchFor(userId)
      .then((next) => { if (loadedFor.current === userId) setRows(next); return next; })
      .catch(() => []);
  }, [userId]);

  return { rows, ensureLoaded, reload };
}
