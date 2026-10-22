// Stars on clusters and files live in one table (starred_items) and show in
// two places: the files sidebar's Starred list (hooks/useSidebarFiles.js) and
// the card of a cluster picked on Home (hooks/useClusterStars.js). Whichever
// changes one says so here, and the other reads again.
export const STARS_CHANGED = 'soleil-stars-changed';

export function announceStars(from) {
  try { window.dispatchEvent(new CustomEvent(STARS_CHANGED, { detail: { from } })); } catch (_) { /* no window */ }
}
