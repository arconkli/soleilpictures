// postBoardRobots.js — whether a /c/<slug> board is kept out of search.
//
// Public boards are meant to rank, so the Worker never noindexes one. The one
// exception: an unlisted post board, which the TikTok machine publishes for its
// own posts (public_boards.unlisted, returned by get_public_board_meta). It
// answers at /c/<word> but stays out of search, the sitemap and every listing.
// Only an explicit `unlisted: true` counts: a missing or failed meta fails open
// to indexable, as every other public board does.

/** True only for a board whose meta says unlisted. */
export function isUnlistedBoard(meta) {
  return !!meta && meta.unlisted === true;
}

/** The X-Robots-Tag value for the board's page and images, or null when it is listed. */
export function postBoardRobots(meta) {
  return isUnlistedBoard(meta) ? 'noindex' : null;
}
