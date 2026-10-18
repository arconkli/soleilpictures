// The shelves a cluster's contents sit on in the sidebar.
//
// The sidebar lists EVERYTHING in a cluster, so it has to sort it before it
// shows it: sub-clusters first, then one shelf per kind of thing, in the order
// people look for them. Every shelf is a list of rows, a small thumbnail beside
// each name: the board is the visual place, the sidebar a calm list (owner,
// 2026-10-18). Links and everything else can fold into one line until opened.
//
// SHELF_OF_KIND has a twin in SQL — sidebar_shelf_of() in
// supabase/migrations/0419_sidebar_files.sql — because a closed cluster is
// counted and paged on the server. sidebarShelves.test.mjs reads that migration
// and fails when the two disagree, so change both or neither.

export const SHELVES = [
  { id: 'photos',  label: 'Photos',  layout: 'rows' },
  { id: 'video',   label: 'Video',   layout: 'rows' },
  { id: 'audio',   label: 'Audio',   layout: 'rows' },
  { id: 'files',   label: 'Files',   layout: 'rows' },
  { id: 'writing', label: 'Writing', layout: 'rows' },
  { id: 'links',   label: 'Links',   layout: 'fold' },
  { id: 'more',    label: 'More',    layout: 'fold' },
];

export const SHELF_IDS = SHELVES.map((s) => s.id);

const BY_ID = new Map(SHELVES.map((s) => [s.id, s]));
export function shelfById(id) {
  return BY_ID.get(id) || null;
}

// null = not contents at all: a cluster card is drawn from the boards table as
// a sub-cluster, never as an item on a shelf.
export const SHELF_OF_KIND = Object.freeze({
  image: 'photos',
  video: 'video',
  audio: 'audio',
  pdf: 'files',
  file: 'files',
  note: 'writing',
  doc: 'writing',
  link: 'links',
  board: null,
  boardlink: null,
});

// A card with no kind is a note (cardIndexRow: `get('kind') || 'note'`), and any
// kind not named — grid, schedule, palette, shape, art, the next one somebody
// adds — lands on More rather than disappearing.
export function shelfOf(kind) {
  const k = kind || 'note';
  return Object.prototype.hasOwnProperty.call(SHELF_OF_KIND, k) ? SHELF_OF_KIND[k] : 'more';
}

// What the full-page Files view filters to when a shelf's ⤢ opens it there:
// ListSurface's own type buckets (listItem.js typeBucket).
export const SHELF_BUCKETS = Object.freeze({
  photos: ['image'],
  video: ['video'],
  audio: ['audio'],
  files: ['pdf', 'file'],
  writing: ['note', 'doc'],
  links: ['link'],
  more: ['palette', 'other'],
});

// The chips across the top of the sidebar. 'all' and 'unplaced' aren't
// shelves: one clears the filter, the other keeps only what's stored off the
// board, whatever shelf it sits on.
export const FILTER_CHIPS = [
  { id: 'all', label: 'All' },
  { id: 'photos', label: 'Photos' },
  { id: 'video', label: 'Video' },
  { id: 'audio', label: 'Audio' },
  { id: 'files', label: 'Files' },
  { id: 'writing', label: 'Writing' },
  { id: 'links', label: 'Links' },
  { id: 'unplaced', label: 'Not on board' },
];
