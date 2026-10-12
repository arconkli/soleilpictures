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
