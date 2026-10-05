import { useState, useCallback, useRef } from 'react';
import { listGridLayouts, myGridLayoutPublications, listPublicGridLayouts } from '../lib/gridLayoutsApi.js';

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

// One trip for the library and one for "which of these are in the gallery".
// They are separate calls because the library comes straight from RLS while
// publication state has to come from a definer function (public_grid_layouts is
// revoked from clients entirely), and they are fetched together because the
// panel needs both before it can render a row's actions honestly.
// The published store rides along as a third call rather than a second hook.
// It is one more entry in a Promise.all that already exists, so the panel still
// costs ONE round-trip when it opens — and shopping the community catalogue has
// to be as cheap as opening the panel or nobody will do it. A failure resolves
// to [] rather than rejecting: not being able to browse other people's
// templates must never take your own library down with it.
function fetchFor(userId) {
  let p = _inflight.get(userId);
  if (!p) {
    p = Promise.all([
      listGridLayouts(),
      myGridLayoutPublications(),
      listPublicGridLayouts(120).catch(() => []),
    ])
      .then(([rows, pubs, community]) => {
        const bySlug = new Map(pubs.map((x) => [x.layout_id, x]));
        const merged = rows.map((r) => {
          const pub = bySlug.get(r.id);
          return pub?.published_at ? { ...r, published_slug: pub.slug } : r;
        });
        const out = { rows: merged, community };
        _cache.set(userId, out);
        _inflight.delete(userId);
        return out;
      })
      .catch((e) => { _inflight.delete(userId); throw e; });
    _inflight.set(userId, p);
  }
  return p;
}

const EMPTY = { rows: [], community: [] };

export function useGridLayouts(userId) {
  const [state, setState] = useState(() => _cache.get(userId) || EMPTY);
  const loadedFor = useRef(null);

  const ensureLoaded = useCallback(() => {
    if (!userId) return;
    if (loadedFor.current === userId) return;
    loadedFor.current = userId;
    if (_cache.has(userId)) { setState(_cache.get(userId)); return; }
    fetchFor(userId)
      .then((next) => { if (loadedFor.current === userId) setState(next); })
      // A library that fails to load leaves the built-in section intact; the
      // panel is still usable, which is better than an error state over a
      // feature the user may not even be reaching for.
      .catch(() => {});
  }, [userId]);

  // Call after any write. Busts the cache and re-reads, so the panel shows what
  // the database actually holds rather than what we hoped it would.
  const reload = useCallback(() => {
    if (!userId) return Promise.resolve(EMPTY);
    _cache.delete(userId);
    _inflight.delete(userId);
    loadedFor.current = userId;
    return fetchFor(userId)
      .then((next) => { if (loadedFor.current === userId) setState(next); return next; })
      .catch(() => EMPTY);
  }, [userId]);

  return { rows: state.rows, community: state.community, ensureLoaded, reload };
}
