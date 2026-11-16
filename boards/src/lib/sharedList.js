// sharedList — what's shared with you and by you, in the order and state the
// sidebar's Shared with you and the Shared page show it. Pure; no Lingui, no
// DOM. The words are the components'; matching is sharedPeople.js's.
//
// What's new and what you took off your list come from 0901
// (list_shared_board_meta); who shared a cluster from 0896 (shared_by* on
// list_shared_boards). Either can be missing (a database without it, or not
// loaded yet): then nothing is new, nothing is hidden, and clusters group by
// their workspace, as before.

import { searchKey } from './textFold.js';
import { matchesFind, findHitKind } from './sharedPeople.js';

// The sidebar lists this many, newest first; the rest are on the Shared page.
export const SIDEBAR_SHARED_CAP = 5;

// What 0424's _file_share_person_card says when the sharer has no name. Two
// such files are rarely from one person, so it never joins anyone's group.
export const NAMELESS_SHARER = 'Someone on Clusters';

const HEX = /^#[0-9a-f]{6}$/i;
const ms = (v) => {
  const n = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(n) ? n : 0;
};
const byName = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), undefined, { sensitivity: 'base', numeric: true });
const named = (s) => typeof s === 'string' && s.trim() !== '';
const hex = (c) => (typeof c === 'string' && HEX.test(c) ? c : null);

// ── What's new, what's off your list ─────────────────────────────────────

// list_shared_board_meta rows → Map(board_id → { sharedAt, openedAt, hiddenAt, viaLink }).
export function sharedMetaMap(rows) {
  const map = new Map();
  for (const r of rows || []) {
    if (!r || !r.board_id) continue;
    map.set(r.board_id, {
      sharedAt: r.shared_at ?? null,
      openedAt: r.opened_at ?? null,
      hiddenAt: r.hidden_at ?? null,
      viaLink: !!r.via_link,
    });
  }
  return map;
}

// A copy of the map with one share's state changed (opened, removed, put back).
export function patchSharedMeta(map, boardId, patch) {
  const next = new Map(map || []);
  if (!boardId) return next;
  const was = next.get(boardId) || { sharedAt: null, openedAt: null, hiddenAt: null, viaLink: false };
  next.set(boardId, { ...was, ...patch });
  return next;
}

// New: shared with you and not opened since, and still on your list.
export function isNewShare(m) {
  return !!m && !m.openedAt && !m.hiddenAt;
}

// Taken off your list with Remove from my list.
export function isHiddenShare(m) {
  return !!m && !!m.hiddenAt;
}

// When it was shared with you, for sorting: the share's own time (0901),
// else list_shared_boards' created_at (the share's since 0896); 0 unknown.
export function sharedAtMs(row, m) {
  return ms(m?.sharedAt) || ms(row?.created_at);
}

const metaOf = (meta, id) => (meta && typeof meta.get === 'function' ? meta.get(id) : undefined);

// Shared roots on your list, newest share first (name breaks a tie).
export function visibleSharedRoots(roots, meta) {
  return (roots || [])
    .filter((r) => r && r.board_id && !isHiddenShare(metaOf(meta, r.board_id)))
    .sort((a, b) => (sharedAtMs(b, metaOf(meta, b.board_id)) - sharedAtMs(a, metaOf(meta, a.board_id)))
      || byName(a.board_name, b.board_name));
}

// The sidebar's rows: the newest `cap`, and the one you are in when it is
// further down, so the open cluster always has its row.
export function sidebarSharedRoots(roots, meta, { activeRootId = null, cap = SIDEBAR_SHARED_CAP } = {}) {
  const all = visibleSharedRoots(roots, meta);
  const rows = all.slice(0, cap);
  if (activeRootId && !rows.some((r) => r.board_id === activeRootId)) {
    const active = all.find((r) => r.board_id === activeRootId);
    if (active) rows.push(active);
  }
  return { rows, total: all.length };
}

// How many shared clusters on your list you haven't opened yet.
export function newSharedCount(roots, meta) {
  let n = 0;
  for (const r of roots || []) {
    const m = metaOf(meta, r?.board_id);
    if (isNewShare(m)) n += 1;
  }
  return n;
}

// The shared root a cluster sits under (itself when it is one), walking the
// boards map's parents while they stay shared; null for your own clusters.
export function sharedRootOf(boards, boardId) {
  let id = boardId;
  for (let hops = 0; id && hops < 64; hops += 1) {
    const b = boards ? boards[id] : null;
    if (!b || !b._shared) return null;
    if (b._sharedRoot) return id;
    id = b.parent_board_id || null;
  }
  return null;
}

// The ids from that shared root down to the cluster, for the navigation
// stack, so the trail starts at the root; just [boardId] when it isn't under one.
export function sharedPathOf(boards, boardId) {
  const path = [];
  let id = boardId;
  for (let hops = 0; id && hops < 64; hops += 1) {
    const b = boards ? boards[id] : null;
    if (!b || !b._shared) break;
    path.unshift(id);
    if (b._sharedRoot) return path;
    id = b.parent_board_id || null;
  }
  return boardId ? [boardId] : [];
}

// parent id → the shared clusters directly under it, by name (Day 2 before
// Day 10). Rows are list_shared_boards'; roots are never anyone's child here.
export function sharedChildrenMap(rows) {
  const map = new Map();
  for (const r of rows || []) {
    if (!r || r.is_shared_root !== false || !r.parent_board_id) continue;
    if (!map.has(r.parent_board_id)) map.set(r.parent_board_id, []);
    map.get(r.parent_board_id).push(r);
  }
  for (const list of map.values()) list.sort((a, b) => byName(a.board_name, b.board_name));
  return map;
}

// ── The Shared page: With you ─────────────────────────────────────────────

// Clusters (list_shared_boards roots) and files (list_shared_with_me rows) as
// one kind of item. Clusters you took off your list are left out; files you
// removed never come back from the server.
export function withYouItems({ clusters = [], files = [], meta = null } = {}) {
  const items = [];
  for (const r of clusters || []) {
    if (!r || !r.board_id) continue;
    const m = metaOf(meta, r.board_id);
    if (isHiddenShare(m)) continue;
    items.push({
      type: 'cluster',
      id: r.board_id,
      name: r.board_name || '',
      personId: r.shared_by || null,
      personName: named(r.shared_by_name) ? r.shared_by_name.trim() : null,
      personColor: hex(r.shared_by_color),
      avatarUrl: null,
      viaLink: !!(m && m.viaLink),
      workspaceId: r.source_workspace_id || null,
      workspaceName: named(r.source_workspace_name) ? r.source_workspace_name.trim() : null,
      role: r.role || null,
      at: sharedAtMs(r, m),
      isNew: isNewShare(m),
      row: r,
    });
  }
  for (const f of files || []) {
    if (!f || !f.token) continue;
    const fromLink = f.source === 'link';
    const who = !fromLink && named(f.shared_by?.name) ? f.shared_by.name.trim() : null;
    items.push({
      type: 'file',
      id: f.token,
      name: f.name || '',
      personId: null,
      personName: who,
      personColor: null,
      avatarUrl: (!fromLink && typeof f.shared_by?.avatar_url === 'string' && f.shared_by.avatar_url) || null,
      viaLink: fromLink,
      workspaceId: null,
      workspaceName: null,
      role: f.access || null,
      at: ms(f.shared_at) || ms(f.opened_at) || ms(f.activity_at),
      isNew: !!f.unread,
      row: f,
    });
  }
  return items;
}

// One group per person, newest first. A file joins the group of a cluster
// from the person of the same name (files carry a name, not an id). Kinds:
//   person    — someone named (or a cluster's sharer, by id)
//   workspace — a cluster whose sharer the server didn't say (before 0896)
//   links     — files you opened from a link
//   unknown   — files from someone with no name
export function groupWithYou(items) {
  const keyByName = new Map();
  for (const it of items || []) {
    if (it.type !== 'cluster' || !it.personId || !it.personName) continue;
    const k = searchKey(it.personName);
    if (k && !keyByName.has(k)) keyByName.set(k, 'p:' + it.personId);
  }
  const groups = new Map();
  const add = (key, kind, it) => {
    if (!groups.has(key)) {
      groups.set(key, {
        key, kind,
        personId: null, personName: null, personColor: null, avatarUrl: null,
        workspaceName: null, newest: 0, items: [],
      });
    }
    const g = groups.get(key);
    g.items.push(it);
    if (it.personId && !g.personId) g.personId = it.personId;
    if (it.personName && !g.personName) g.personName = it.personName;
    if (it.personColor && !g.personColor) g.personColor = it.personColor;
    if (it.avatarUrl && !g.avatarUrl) g.avatarUrl = it.avatarUrl;
    if (it.workspaceName && !g.workspaceName) g.workspaceName = it.workspaceName;
  };
  for (const it of items || []) {
    if (it.type === 'cluster') {
      if (it.personId) add('p:' + it.personId, 'person', it);
      else add('w:' + (it.workspaceId || '?'), 'workspace', it);
    } else if (it.viaLink) {
      add('links', 'links', it);
    } else if (!it.personName || it.personName === NAMELESS_SHARER) {
      add('unknown', 'unknown', { ...it, personName: null });
    } else {
      const folded = searchKey(it.personName);
      const key = keyByName.get(folded) || 'n:' + folded;
      add(key, 'person', it);
    }
  }
  const out = [...groups.values()];
  for (const g of out) {
    g.items.sort((a, b) => (b.at - a.at) || byName(a.name, b.name));
    g.newest = g.items.length ? g.items[0].at : 0;
  }
  return out.sort((a, b) => (b.newest - a.newest)
    || byName(a.personName ?? a.workspaceName ?? '', b.personName ?? b.workspaceName ?? ''));
}

// ── The Shared page: By you ───────────────────────────────────────────────

// Clusters (list_my_board_shares) and files (list_my_file_shares) you've
// shared, newest first. A cluster's people are names and colours, never emails.
export function byYouItems({ clusters = [], files = [] } = {}) {
  const items = [];
  for (const r of clusters || []) {
    if (!r || !r.board_id) continue;
    const people = (Array.isArray(r.people) ? r.people : []).map((p) => ({
      userId: p?.user_id || null,
      name: named(p?.name) ? p.name.trim() : null,
      color: hex(p?.color),
      role: p?.role || null,
    }));
    items.push({
      type: 'cluster',
      id: r.board_id,
      name: r.board_name || '',
      cover: r.board_cover || 'neutral',
      workspaceId: r.workspace_id || null,
      workspaceName: named(r.workspace_name) ? r.workspace_name.trim() : null,
      people,
      peopleCount: Number.isFinite(r.people_count) ? r.people_count : people.length,
      linkOn: !!r.link_on,
      at: ms(r.last_shared_at),
      row: r,
    });
  }
  for (const f of files || []) {
    if (!f || !f.token) continue;
    items.push({
      type: 'file',
      id: f.token,
      name: f.name || '',
      cover: null,
      workspaceId: null,
      workspaceName: null,
      boardName: f.board_name || null,
      people: [],
      peopleCount: Number.isFinite(f.people_count) ? f.people_count : 0,
      linkOn: !!f.link_access && f.link_access !== 'none',
      at: ms(f.updated_at),
      row: f,
    });
  }
  return items.sort((a, b) => (b.at - a.at) || byName(a.name, b.name));
}

// ── Finding ───────────────────────────────────────────────────────────────

// The fields a typed search looks in: the item's name, the person who shared
// it (With you) or the people you shared it with (By you), its workspace or
// cluster, and the words its row shows (its kind, in the reader's language),
// which callers pass as `shown`.
export function itemFindFields(item, shown = []) {
  const people = (item.people || []).map((p) => p.name);
  return [item.name, item.personName, ...people, item.workspaceName, item.boardName, ...shown];
}

// Groups (or a flat list wrapped as one group) cut down to what matches;
// groups left empty drop out.
export function filterGroups(groups, query, shownOf = () => []) {
  return (groups || [])
    .map((g) => ({ ...g, items: g.items.filter((it) => matchesFind(query, itemFindFields(it, shownOf(it)))) }))
    .filter((g) => g.items.length > 0);
}

export function countItems(groups) {
  return (groups || []).reduce((n, g) => n + g.items.length, 0);
}

// Which side made a match, for find_used: the thing itself or its people.
export function itemHitKind(query, item, shown = []) {
  const people = [item.personName, ...(item.people || []).map((p) => p.name)];
  return findHitKind(query, [item.name, item.workspaceName, item.boardName, ...shown], people) || 'name';
}
