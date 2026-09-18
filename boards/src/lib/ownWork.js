// ownWork — pictures of what this person has actually built, for the upgrade
// surfaces to show back to them.
//
// Why this exists at all. The offer is the only screen in a product made of
// images that shows the reader none of their own. Across every upgrade surface
// the abstract feature rows go almost entirely unread — at the wall, where the
// reader is provably motivated, not one has ever been read — while the one line
// anybody could be shown to care about is `ownWorkSummary`, which until now ran
// on a single header. Describing the product to someone who has spent an hour
// filling a board is the weakest available move; showing them the board is the
// strongest, and it costs nothing we have not already paid for.
//
// Why a module store rather than props. There is exactly one publisher — App,
// which holds the board list — and three readers: the modal mounted from App
// (wall, storage gate), from UpgradeChip (the pill and the first-value banner),
// and from Settings → Billing. The chip mounts in TierRouter, outside App's
// tree entirely, so there is no common ancestor to thread a prop through. Same
// shape as captureState.js / galleryState.js: React-free, module scope =
// page lifetime, readers take a snapshot rather than subscribing.
//
// Why board thumbnails and not card images. `boards.thumb_key` is a canvas
// RENDER of the board — literally a picture of their work, produced by
// renderThumbnail.js and already shown by the cluster browser, so R2's signed
// URL is warm. Card images live in each board's Y.Doc, which only the mounted
// CanvasSurface can see; reaching for them would mean the strip works from the
// wall and nowhere else. No table read, no RPC, no new query.

// Five is what fits the modal at its 460px width without the thumbs shrinking
// below the size at which a board is recognisable as itself.
export const OWN_WORK_MAX = 5;

let current = [];

// Publish the viewer's own clusters, newest first.
//
// `ownsWorkspace` is not a convenience flag, it is the safety property: a
// collaborator invited into someone else's workspace sees that workspace's
// boards in the same map, and showing those back to them under "what you've
// built" would be showing them another person's work. When it is false the
// strip is empty and the modal renders as it did before.
export function publishOwnWork(boardsMap, { ownsWorkspace = false } = {}) {
  if (!ownsWorkspace || !boardsMap) { current = []; return current; }
  const rows = [];
  for (const b of Object.values(boardsMap)) {
    // `_shared` marks a board normalized in from another workspace. Same
    // reasoning as ownsWorkspace, one level down.
    if (!b || b._shared || !b.thumb_key) continue;
    rows.push(b);
  }
  rows.sort((a, z) => String(z.updated_at || '').localeCompare(String(a.updated_at || '')));
  current = rows.slice(0, OWN_WORK_MAX).map((b) => ({
    id: b.id,
    // The R2 key, not a URL. R2Image resolves and caches the signed read.
    key: b.thumb_key,
    // Alt text, and the only place the board's name is used — deliberately not
    // rendered as a caption. The point is the picture.
    name: b.name || 'Untitled cluster',
    // Cache-buster, exactly as the cluster browser keys its own R2Image.
    version: b.thumb_updated_at || b.thumb_version || null,
  }));
  return current;
}

// A snapshot, not a subscription. The modal is short-lived and mounts once per
// exposure, so re-rendering it when a thumbnail regenerates behind the offer
// would be motion nobody asked for.
export function readOwnWork() {
  return current;
}

// Test seam, and the honest way to express "this is module state".
export function __resetOwnWork() {
  current = [];
}
