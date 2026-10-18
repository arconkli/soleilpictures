// Ordering, grouping and filtering for the sidebar's lists.
//
// A closed cluster is sorted by the server (sidebar_cluster_items, 0419) and
// the open one by the browser, and the two have to put the same card first, so
// compareItems mirrors that ORDER BY: the chosen key, then created_at desc,
// then card_id. Only the name sort differs in mechanism — Postgres compares
// the lowercased key bytewise, here it is localeCompare with numeric: true —
// which is why the sidebar always re-sorts a page it fetched.

import { SHELVES, SHELF_IDS } from './sidebarShelves.js';
import { nameSortKey } from './indexRowCard.js';

export const SORTS = ['newest', 'name', 'size', 'canvas'];
export const DEFAULT_SORT = 'newest';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// a before b; a null goes last whichever way it runs.
function byNumber(a, b, dir) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return dir * (a - b);
}

const LOCALE = { sensitivity: 'base', numeric: true };

function byName(a, b) {
  const ka = nameSortKey(a);
  const kb = nameSortKey(b);
  if (!ka && !kb) return 0;
  if (!ka) return 1;
  if (!kb) return -1;
  return ka.localeCompare(kb, undefined, LOCALE);
}

export function compareItems(sort) {
  const primary = {
    name: byName,
    size: (a, b) => byNumber(num(a.sizeBytes), num(b.sizeBytes), -1),
    canvas: (a, b) => (
      byNumber(num(a.meta?.pos?.y), num(b.meta?.pos?.y), 1)
      || byNumber(num(a.meta?.pos?.x), num(b.meta?.pos?.x), 1)
    ),
  }[sort];
  return (a, b) => (
    (primary ? primary(a, b) : 0)
    || byNumber(num(a.createdAt), num(b.createdAt), -1)
    || (a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : 0)
  );
}

export function sortItems(items, sort) {
  return [...items].sort(compareItems(sort));
}

function byType(items) {
  const out = [];
  for (const s of SHELVES) {
    const mine = items.filter((i) => i.shelf === s.id);
    if (mine.length) out.push({ id: s.id, label: s.label, layout: s.layout, items: mine });
  }
  return out;
}

export function groupItems(items, { groupBy = 'type' } = {}) {
  if (groupBy !== 'canvas') return byType(items);
  const groups = new Map();
  const loose = [];
  for (const item of items) {
    const gid = item.meta?.groupId;
    if (!gid) { loose.push(item); continue; }
    if (!groups.has(gid)) {
      groups.set(gid, {
        id: `group:${gid}`,
        label: item.meta?.groupName || 'Untitled group',
        items: [],
      });
    }
    const g = groups.get(gid);
    if (g.label === 'Untitled group' && item.meta?.groupName) g.label = item.meta.groupName;
    g.items.push(item);
  }
  const shelves = [...groups.values()]
    .map((g) => ({ ...g, layout: 'rows' }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
  return [...shelves, ...byType(loose)];
}

export function filterItems(items, { chip = 'all', query = '' } = {}) {
  const q = String(query || '').trim().toLowerCase();
  return items.filter((i) => {
    if (chip === 'unplaced') { if (!i.unplaced) return false; }
    else if (chip !== 'all' && SHELF_IDS.includes(chip)) { if (i.shelf !== chip) return false; }
    if (!q) return true;
    return [i.name, i.snippet, i.meta?.fileName]
      .some((s) => typeof s === 'string' && s.toLowerCase().includes(q));
  });
}
