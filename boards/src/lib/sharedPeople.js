// sharedPeople — label and find shared things by PERSON. Pure; no Lingui, no DOM.
//
// Nearly every workspace still carries the default name, so three people's
// workspaces look identical in the menu and every "Shared with me" group reads
// "From Personal Workspace". The person is what tells them apart: this groups
// by them and matches a typed query against names and people alike.
// Words live in sharedPeopleWords.js.

import { searchKey } from './textFold.js';

// What every workspace was called before the setup asked for a name. Read
// back to a joiner it would sound like a name someone chose.
export const UNNAMED_WORKSPACE = 'Personal Workspace';

export function isUnnamedWorkspace(name) {
  if (typeof name !== 'string') return true;
  const n = name.trim();
  return !n || n.toLowerCase() === UNNAMED_WORKSPACE.toLowerCase();
}

export function findTokens(query) {
  return searchKey(query).split(/\s+/).filter(Boolean);
}

// Every token of the query is found in at least one field.
export function matchesFind(query, fields) {
  const tokens = findTokens(query);
  if (!tokens.length) return true;
  const keys = (fields || []).filter((f) => f != null && f !== '').map(searchKey).filter(Boolean);
  return tokens.every((tok) => keys.some((k) => k.includes(tok)));
}

// Which side made the match, for analytics only.
export function findHitKind(query, nameFields, personFields) {
  const names = nameFields || [];
  const people = personFields || [];
  if (!matchesFind(query, [...names, ...people])) return null;
  if (findTokens(query).length && matchesFind(query, names)) return 'name';
  return 'person';
}

const HEX = /^#[0-9a-f]{6}$/i;
const ms = (v) => { const n = Date.parse(v); return Number.isFinite(n) ? n : 0; };
const byName = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), undefined, { sensitivity: 'base' });

// list_shared_boards ROOT rows -> one group per sharer (the workspace when the
// server did not say who), newest share first.
export function groupSharedByPerson(rows) {
  const map = new Map();
  for (const r of rows || []) {
    const key = r.shared_by ? 'p:' + r.shared_by : 'w:' + r.source_workspace_id;
    if (!map.has(key)) map.set(key, { key, personId: r.shared_by || null, rows: [] });
    map.get(key).rows.push(r);
  }
  const groups = [];
  for (const g of map.values()) {
    const rows = [...g.rows].sort((a, b) => (ms(b.created_at) - ms(a.created_at)) || byName(a.board_name, b.board_name));
    const named = rows.map((r) => (typeof r.shared_by_name === 'string' ? r.shared_by_name.trim() : '')).find(Boolean);
    const color = rows.map((r) => r.shared_by_color).find((c) => typeof c === 'string' && HEX.test(c));
    groups.push({
      key: g.key,
      personId: g.personId,
      personName: named || null,
      personColor: color || null,
      workspaceId: rows[0].source_workspace_id,
      workspaceName: rows[0].source_workspace_name,
      newest: ms(rows[0].created_at),
      rows,
    });
  }
  return groups.sort((a, b) => (b.newest - a.newest)
    || byName(a.personName ?? a.workspaceName ?? '', b.personName ?? b.workspaceName ?? ''));
}

// Which workspaces were opened last on this device.
export const OPENED_KEY = 'soleil.ws.opened';
const OPENED_KEEP = 30;

function defaultStorage() {
  try { return globalThis.localStorage || null; } catch (_) { return null; }
}

export function readOpenedWorkspaces(storage = defaultStorage()) {
  try {
    const o = JSON.parse(storage.getItem(OPENED_KEY));
    if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
    const out = {};
    for (const [id, v] of Object.entries(o)) if (typeof v === 'number' && Number.isFinite(v)) out[id] = v;
    return out;
  } catch (_) { return {}; }
}

export function noteWorkspaceOpened(id, now = Date.now(), storage = defaultStorage()) {
  if (!id) return;
  try {
    const o = { ...readOpenedWorkspaces(storage), [id]: now };
    const keep = Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, OPENED_KEEP);
    storage.setItem(OPENED_KEY, JSON.stringify(Object.fromEntries(keep)));
  } catch (_) { /* storage can throw or be missing */ }
}

// Opened-last first; the rest newest-joined first. Callers pass the list
// oldest-joined first, so the item that came later wins a tie.
export function orderSharedWorkspaces(list, opened, joinedAt = null) {
  const seen = opened || {};
  const items = (list || []).map((ws, i) => ({ ws, i }));
  const was = (x) => seen[x.ws?.id];
  const isOpened = (x) => typeof was(x) === 'number' && Number.isFinite(was(x));
  const joined = (x) => {
    if (!joinedAt) return null;
    const v = joinedAt(x.ws);
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  const a = items.filter(isOpened).sort((x, y) => (was(y) - was(x)) || (y.i - x.i));
  const b = items.filter((x) => !isOpened(x)).sort((x, y) => {
    const jx = joined(x), jy = joined(y);
    if (jx != null && jy != null && jx !== jy) return jy - jx;
    return y.i - x.i;
  });
  return [...a, ...b].map((x) => x.ws);
}

// The switcher's short list of shared workspaces. `ordered` is
// orderSharedWorkspaces' order (opened last first). Searching, expanded, or a
// list no longer than `threshold` shows every row; otherwise the first `cap`,
// plus the active one appended when it is further down. `hidden` is how many
// are left out.
export function shortSharedList(ordered, { activeId = null, expanded = false, searching = false, cap = 4, threshold = 5 } = {}) {
  const all = ordered || [];
  if (searching || expanded || all.length <= threshold) return { rows: all, hidden: 0 };
  const rows = all.slice(0, cap);
  if (activeId != null && !rows.some((w) => w.id === activeId)) {
    const active = all.find((w) => w.id === activeId);
    if (active) rows.push(active);
  }
  return { rows, hidden: all.length - rows.length };
}
