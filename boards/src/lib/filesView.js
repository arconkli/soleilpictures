// The full Files page in the files sidebar's look (direction A; the look is
// components/clusterBrowser/filesLook.js), as one vocabulary with the
// sidebar's Files card. Pure, so the page's menu, shelves and keyboard are
// tested here:
//   - the menu is the card's "All files ⌄" (Show, Sort) over the page's own
//     sort keys and type filters, both ways, so the button says what the
//     card's says;
//   - the shelves are the card's (lib/sidebarShelves.js): photos and video in
//     a justified grid, the rest in rows, the minor ones closed as the card
//     closes them;
//   - the keyboard walks one order across every shelf on screen, the arrows
//     stepping from one shelf's last tile to the next shelf's first.

import { SHELVES, SHELF_BUCKETS, FILTER_CHIPS, shelfOf } from './sidebarShelves.js';
import { gridNeighbor } from './justifiedGrid.js';

// The card's sorts, as the page sorts (lib/listItem.js sortItems).
export const SORT_TO_PAGE = Object.freeze({
  newest: Object.freeze({ key: 'created', dir: 'desc' }),
  name: Object.freeze({ key: 'name', dir: 'asc' }),
  size: Object.freeze({ key: 'size', dir: 'desc' }),
  canvas: Object.freeze({ key: 'board', dir: 'asc' }),
});
export const SORT_LABELS = Object.freeze({ newest: 'Newest first', name: 'Name', size: 'Size', canvas: 'Canvas order' });

// The card's sort a page sort is, or null for one the menu has no item for
// (a column head's: Kind, Modified, the audio columns, a reversed one).
export function sidebarSortOf(key, dir) {
  for (const [id, s] of Object.entries(SORT_TO_PAGE)) if (s.key === key && s.dir === dir) return id;
  return null;
}

// What a sort is called: the menu's word, else what its column says, with
// the way it runs.
const COLUMN_WORDS = {
  name: 'Name', type: 'Kind', size: 'Size', created: 'Added', updated: 'Modified', board: 'Canvas order',
  duration: 'Length', bpm: 'Tempo', key: 'Key', format: 'Format',
};
export function sortLabelOf(key, dir) {
  const id = sidebarSortOf(key, dir);
  if (id) return SORT_LABELS[id];
  return `${COLUMN_WORDS[key] || 'Custom'} ${dir === 'asc' ? '↑' : '↓'}`;
}

// A chip as the page filters: its shelf's type buckets, or Not on board.
export function chipToFilter(chip) {
  if (chip === 'unplaced') return { buckets: [], unplacedOnly: true };
  return { buckets: [...(SHELF_BUCKETS[chip] || [])], unplacedOnly: false };
}

// The chip a page filter is; null for a mix no chip names (buckets that
// aren't one shelf's, or a shelf and Not on board together).
export function filterToChip(buckets, unplacedOnly) {
  const set = new Set(buckets || []);
  if (!set.size) return unplacedOnly ? 'unplaced' : 'all';
  if (unplacedOnly) return null;
  for (const [id, list] of Object.entries(SHELF_BUCKETS)) {
    if (list.length === set.size && list.every((b) => set.has(b))) return id;
  }
  return null;
}

// What each chip would show, as the card counts its own: a shelf's count,
// Not on board over every shelf (only where the page marks placement), and
// All for everything.
export function chipCountsOf(items, { placement = true } = {}) {
  const out = { all: 0, unplaced: 0 };
  for (const it of items || []) {
    const shelf = shelfOf(it.kind);
    if (!shelf) continue;
    out.all += 1;
    out[shelf] = (out[shelf] || 0) + 1;
    if (placement && it.unplaced) out.unplaced += 1;
  }
  return out;
}

// The chips the menu offers: All, each with something behind it, and the one
// in force. The card has no chip for Other (its shelf only opens), but a
// shelf's ⤢ can filter the page to it, so it's offered while it filters.
export function pageChipsOf(counts, chip) {
  const out = FILTER_CHIPS.filter((c) => c.id === 'all' || c.id === chip || (counts?.[c.id] || 0) > 0);
  if (chip === 'more') {
    const at = out.findIndex((c) => c.id === 'unplaced');
    out.splice(at < 0 ? out.length : at, 0, { id: 'more', label: 'Other' });
  }
  return out;
}

export function chipLabelOf(chip) {
  if (chip == null) return 'Filtered';
  if (chip === 'all') return 'All files';
  if (chip === 'more') return 'Other';
  return FILTER_CHIPS.find((c) => c.id === chip)?.label || 'All files';
}

// The page's shelves over what it shows, in the card's order: photos and
// video in a justified grid, the rest in rows. A grid family is one entry on
// Other and counts its grids. Empty shelves aren't returned.
const GRID_SHELVES = new Set(['photos', 'video']);
export function sectionsOf(items) {
  const by = new Map(SHELVES.map((s) => [s.id, []]));
  for (const it of items || []) {
    const shelf = it.isGroup ? 'more' : shelfOf(it.kind);
    if (shelf && by.has(shelf)) by.get(shelf).push(it);
  }
  const out = [];
  for (const s of SHELVES) {
    const list = by.get(s.id);
    if (!list.length) continue;
    out.push({
      id: s.id, label: s.label, items: list,
      count: list.reduce((n, it) => n + (it.isGroup ? (it.count || 0) : 1), 0),
      layout: GRID_SHELVES.has(s.id) ? 'grid' : 'rows',
      minor: s.layout === 'fold',
    });
  }
  return out;
}

// Notes, Links and Other start closed, as the card's do, until opened this
// session, or while the search or a chip is looking for what's on them.
const looking = ({ chip = 'all', query = '' } = {}) => !!(query || '').trim() || (chip != null && chip !== 'all');
export function shelfClosed(section, opts = {}) {
  if (!section?.minor || looking(opts)) return false;
  return !opts.opened?.has?.(section.id);
}
export function shelfFoldable(section, opts = {}) {
  return !!section?.minor && !looking(opts);
}

// Every row and tile on screen in the order drawn: shelf by shelf, closed
// shelves skipped, an open grid family's members after it.
export function screenOrderOf(sections, { closed = null, expandedGroups = null } = {}) {
  const out = [];
  for (const s of sections || []) {
    if (closed?.has?.(s.id)) continue;
    for (const it of s.items) {
      out.push(it);
      if (it.isGroup && expandedGroups?.has?.(it.id)) out.push(...(it.members || []));
    }
  }
  return out;
}

// Where an arrow key goes from `id` over the shelves on screen. `parts` is
// one entry per open shelf, in screen order: { layout: 'grid', ids, tiles }
// (the gallery's laid-out tiles, lib/justifiedGrid.js) or { layout: 'rows',
// ids }. In a grid ←/→ walk the order and ↑/↓ go to the nearest tile in the
// next row; in rows only ↑/↓ move. Past a shelf's edge the step goes on to
// the next shelf's first (↓, →) or back to the one before's last (↑, ←).
// No cursor yet: the first thing (↓, →) or the last (↑, ←). Null when there's
// nothing at all; the same id where it can't move.
export function navStep(parts, id, arrow) {
  const list = (parts || []).filter((p) => p?.ids?.length);
  if (!list.length) return null;
  const forward = arrow === 'down' || arrow === 'right';
  const pi = id == null ? -1 : list.findIndex((p) => p.ids.includes(id));
  if (pi < 0) {
    const end = forward ? list[0] : list[list.length - 1];
    return forward ? end.ids[0] : end.ids[end.ids.length - 1];
  }
  const part = list[pi];
  const i = part.ids.indexOf(id);
  if (part.layout === 'grid' && part.tiles?.length === part.ids.length) {
    const j = gridNeighbor(part.tiles, i, arrow);
    if (j !== i) return part.ids[j];
  } else if (arrow === 'down' || arrow === 'up') {
    const j = i + (forward ? 1 : -1);
    if (j >= 0 && j < part.ids.length) return part.ids[j];
  } else {
    return id;
  }
  const next = list[pi + (forward ? 1 : -1)];
  if (!next) return id;
  return forward ? next.ids[0] : next.ids[next.ids.length - 1];
}
