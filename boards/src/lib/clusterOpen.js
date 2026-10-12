// Opening a cluster from somewhere other than the tree: an entity link, a
// notification, a search hit, a tag's "appears in" row.
//
// Those carry an id from a cache, an index or another person's message, so
// the id can name a cluster that is not in this workspace's live boards map
// any more. Putting it on the stack anyway was the bug (SHELL-02): currentId
// became the missing id while currentBoard fell back to the root, so the
// breadcrumb showed a raw UUID over the root canvas and Version history opened
// for the trashed cluster. The prune effect never fixed it, because it only
// re-runs when the boards map changes. App asks the boards table instead and
// says why it won't open.

// The toast for an id that isn't in the boards map, from the boards row the
// lookup found (null when RLS returned nothing). The Trash button is offered
// only for this workspace's Trash, which is the only one the Trash dialog
// lists.
export function unopenableClusterNotice(row, currentWorkspaceId) {
  if (row && row.deleted_at) {
    return {
      message: 'That cluster is in the Trash.',
      openTrash: !!currentWorkspaceId && row.workspace_id === currentWorkspaceId,
    };
  }
  return { message: "That cluster isn't available to you any more.", openTrash: false };
}

// Resolve true as soon as ready() holds, or false once `timeout` ms pass
// without it. Replaces "dispatch the flash/open event 200 ms after
// navigating", which lost the event whenever the cluster took longer than
// that to mount: the listener lives in the mounted canvas, so an event sent
// before it exists reaches nobody. Callers act on false too (the old
// behaviour, just later), so a slow mount degrades to what it was.
export function waitUntil(ready, { timeout = 5000, interval = 50, now = Date.now, schedule = setTimeout } = {}) {
  return new Promise((resolve) => {
    const start = now();
    const tick = () => {
      let ok = false;
      try { ok = !!ready(); } catch (_) { ok = false; }
      if (ok) { resolve(true); return; }
      if (now() - start >= timeout) { resolve(false); return; }
      schedule(tick, interval);
    };
    tick();
  });
}
