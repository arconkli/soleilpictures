// Keys a Settings tab has written but not yet seen come back from the server.
//
// merge_profile_settings merges one level deep (`settings || patch`), so a
// write of `ui` replaces the whole `ui` object. A tab that builds that object
// from the last FETCHED copy drops anything changed since: pick Light, toggle
// the sidebar before the refetch lands, and the second write carries the old
// theme back to the server. The page looked light; the next device did not.
//
// The tab keeps what it wrote here and lays it over the server copy, both for
// what it shows and for what it writes next. A key leaves only once the server
// copy agrees with it, so an early refetch (one that predates a later write)
// can't strip it, and a later change from elsewhere is not masked for long.
//
// Plain module, no React, so lib/settingsPendingPatch.test.mjs can run it.

const same = (a, b) => (a ?? null) === (b ?? null);

// The server copy with the pending keys on top.
export function overlayPending(server, pending) {
  return { ...(server || {}), ...(pending || {}) };
}

// `pending` minus every key the server copy now agrees with. Returns the same
// object when nothing settled, so a caller can skip a re-render.
export function settlePending(server, pending) {
  const src = server || {};
  let next = pending;
  for (const k of Object.keys(pending || {})) {
    if (!same(src[k], pending[k])) continue;
    if (next === pending) next = { ...pending };
    delete next[k];
  }
  return next;
}
