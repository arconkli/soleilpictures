// The Templates library — the catalogue behind the grid tool's panel.
//
// ── "template" means two different things in this codebase; keep them apart ──
//
// A grid FAMILY (lib/gridState.js, the per-board `gridTemplates` Y.Map, a card's
// `templateId`) is a LIVE LINK between grids on one board: edit one grid's
// dividers and every linked grid reflows. It is board-scoped, collaborative, and
// has nothing to do with this file.
//
// A TEMPLATE here is a SAVED SHAPE — a detached fraction tree you can stamp out
// again later, on any board. Applying one is a one-time copy, not a subscription.
// The Y.Map key stays `gridTemplates` forever because every existing board's CRDT
// holds one under that name; renaming it would orphan every family in production.
//
// This module is the catalogue only — no React, no Supabase, no Yjs — so the node
// test and LocalBoardsApp (which has no backend at all) can both use it. The tree
// math lives in gridLayout.js; the database wrapper lives in gridLayoutsApi.js.

import { PRESETS, sanitizeLayout } from './gridLayout.js';

// Where a template came from. Drives the section it lands in, and which row
// actions it offers (a built-in can't be renamed or deleted).
export const SOURCES = Object.freeze({
  BUILTIN: 'builtin',
  USER: 'user',
  WORKSPACE: 'workspace',
  COMMUNITY: 'community',
});

// One row in the panel. Built-in and saved templates are the SAME shape so the
// renderer never branches on origin — only the row actions do.
//   { key, id, name, tree, source, ownerId?, shareToken?, slug? }
function row(id, name, tree, source, extra) {
  return { key: `${source}:${id}`, id, name, tree, source, ...(extra || {}) };
}

// The shipped catalogue, projected straight off gridLayout's PRESETS so there is
// exactly one definition of each built-in shape. Ships in the bundle: the panel
// opens instantly, works offline, and works under ?local=1 where there is no
// Supabase client at all.
export const BUILT_IN_LAYOUTS = Object.freeze(
  PRESETS.map((p) => Object.freeze(row(p.id, p.label, p.tree, SOURCES.BUILTIN))),
);

// A database row → a panel row. Returns null when the stored body is unusable, so
// one corrupt record can't take the panel down with it. `body` is
// { layout, textStyle } — see migration 0265; a future version may add `cells`,
// which this ignores rather than failing on.
export function rowFromRecord(rec, source) {
  if (!rec || !rec.id) return null;
  const body = rec.body || {};
  const tree = sanitizeLayout(body.layout);
  if (!tree) return null;
  return row(rec.id, rec.name || 'Untitled', tree, source, {
    ownerId: rec.created_by || null,
    workspaceId: rec.workspace_id || null,
    shareToken: rec.share_token || null,
    textStyle: body.textStyle || null,
    slug: rec.slug || null,
  });
}

export function rowsFromRecords(records, source) {
  return (records || []).map((r) => rowFromRecord(r, source)).filter(Boolean);
}

// Section list for the panel. Empty sections are dropped so a signed-out or
// local-mode user sees just "Built-in" with no hollow headers under it.
export function mergeSections({ mine, workspace, community } = {}) {
  return [
    { id: SOURCES.BUILTIN, title: 'Built-in', rows: BUILT_IN_LAYOUTS },
    { id: SOURCES.USER, title: 'My templates', rows: mine || [] },
    { id: SOURCES.WORKSPACE, title: 'Workspace', rows: workspace || [] },
    { id: SOURCES.COMMUNITY, title: 'Community', rows: community || [] },
  ].filter((s) => s.rows.length > 0);
}

// Case-insensitive filter across every section, for the panel's search field.
// Sections that end up empty drop out, same as mergeSections.
export function filterSections(sections, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return sections;
  return sections
    .map((s) => ({ ...s, rows: s.rows.filter((r) => (r.name || '').toLowerCase().includes(q)) }))
    .filter((s) => s.rows.length > 0);
}

// The payload written to grid_layouts.body when someone saves the grid they have
// selected. Layout only, by design: no image refs means no cross-workspace R2
// grants to solve, and a template stays ~1KB of JSON that is trivially shareable.
export function bodyFromGrid(layout, textStyle) {
  const tree = sanitizeLayout(layout);
  if (!tree) return null;
  return textStyle ? { layout: tree, textStyle } : { layout: tree };
}
