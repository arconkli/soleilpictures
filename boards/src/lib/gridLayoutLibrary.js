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

import { PRESETS, sanitizeLayout, computeCellRects, readingOrder } from './gridLayout.js';

// Where a template came from. Drives the section it lands in, and which row
// actions it offers (a built-in can't be renamed or deleted).
export const SOURCES = Object.freeze({
  BUILTIN: 'builtin',
  // The templates WE ship with a use-case and labels — the same catalogue
  // /templates sells. Distinct from BUILTIN, which is the ten bare shapes.
  STORE: 'store',
  USER: 'user',
  WORKSPACE: 'workspace',
  // Somebody else's, copied into your library from a share link or the public
  // gallery. Kept apart from USER because both are `scope:'user'` rows owned by
  // you — without grid_layouts.origin (0270) they are indistinguishable, and a
  // list of thirty "yours" that you mostly did not make is not a useful list.
  DOWNLOADED: 'downloaded',
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
    // Sanitized on the way OUT as well as in: a community template's labels are
    // text somebody else wrote, and this is the boundary they cross.
    hints: sanitizeHints(body.hints),
    // The proportions it was built at, so a storyboard you saved comes back a
    // storyboard rather than a square. Absent on every row written before this
    // shipped, which is exactly what `null` means to addGrid: use the default.
    size: sanitizeSize(body.size),
    // 'own' | 'link' | 'gallery' (0270) — which section this belongs in.
    origin: rec.origin || 'own',
    // Set only when this template is live in the public gallery — the row's
    // actions offer Publish or Remove based on it, never both.
    publishedSlug: rec.published_slug || null,
    slug: rec.slug || null,
  });
}

export function rowsFromRecords(records, source) {
  return (records || []).map((r) => rowFromRecord(r, source)).filter(Boolean);
}

// Section list for the panel, ordered by how close the templates are to you:
// what you made, what your team shares, what you took from elsewhere, then the
// store (ours, then everyone's), and the bare shapes last — that is the section
// you stop needing.
//
// Empty sections are dropped, so a signed-out or local-mode user sees just
// "Defaults" with no hollow headers above it.
export function mergeSections({ mine, workspace, downloaded, store, community } = {}) {
  return [
    { id: SOURCES.USER, title: 'Yours', rows: mine || [] },
    { id: SOURCES.WORKSPACE, title: 'Workspace', rows: workspace || [] },
    { id: SOURCES.DOWNLOADED, title: 'Downloaded', rows: downloaded || [] },
    { id: SOURCES.STORE, title: 'Store', rows: store || [] },
    { id: SOURCES.COMMUNITY, title: 'Community', rows: community || [] },
    // "Shapes", not "Defaults": these ten are bare geometry with generic names,
    // and calling them defaults beside a Store section of named, labelled
    // templates invites the reader to think the Store is optional extra.
    { id: SOURCES.BUILTIN, title: 'Shapes', rows: BUILT_IN_LAYOUTS },
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

// ── cell hints ───────────────────────────────────────────────────────────────
//
// A hint is the label a template puts in an empty cell — "WIDE SHOT", "ACTION" —
// so a stranger opening your storyboard template knows what goes where.
//
// A hint is NOT content. It renders only while the cell is empty and is never
// written to gridCells, which is what makes it disappear at exactly the right
// moment and keeps it out of everything downstream: it does not count toward
// the card cap (isCellFilled never sees it), does not sync to card_index, and
// does not export.
//
// Indexed by READING ORDER, not by leaf id. A template's leaf ids are
// placeholders that instantiateLayout re-mints on every use, so an id-keyed map
// would need remapping on every placement; reading order is stable for a given
// tree and is also how a person describes a cell ("the second box").
//
// Bounds are enforced in three places on purpose. Here, so the UI cannot author
// something out of range; in the migration's CHECK constraint, so no client can
// write one; and implicitly by the body size cap. Hints are the only part of a
// template that is free text, and they publish to a public page.

// ── the card size a template wants ───────────────────────────────────────────
//
// A layout is a set of PROPORTIONS, and proportions only produce the shape they
// are meant to at one aspect ratio: place the six-panel storyboard in the default
// 360×300 and its 16:9 panels come out square. So a template may carry the size
// it was built at, and addGrid is handed it.
//
// No migration: 0265 shaped `body` to grow a key without one, and this is a key.
// It arrives from other people's records, so it is clamped rather than trusted —
// a card 90000px wide is not a template, it is a denial of service on the canvas.

export const SIZE_LIMITS = Object.freeze({ MIN: 80, MAX: 2400 });

export function sanitizeSize(size) {
  if (!size || typeof size !== 'object') return null;
  const w = Number(size.w);
  const h = Number(size.h);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
  const clamp = (n) => Math.round(Math.min(SIZE_LIMITS.MAX, Math.max(SIZE_LIMITS.MIN, n)));
  return { w: clamp(w), h: clamp(h) };
}

export const HINT_LIMITS = Object.freeze({
  MAX_CELLS: 64,   // past this a grid is not a layout anyone labels by hand
  MAX_LEN: 40,     // a label, not a caption — longer will not fit a small cell
});

export function sanitizeHints(hints, cellCount = HINT_LIMITS.MAX_CELLS) {
  if (!Array.isArray(hints)) return null;
  const cap = Math.max(0, Math.min(cellCount, HINT_LIMITS.MAX_CELLS));
  const out = hints.slice(0, cap).map((h) => (
    typeof h === 'string'
      // Plain text only. A hint renders as a text node, so markup could never
      // execute — but stripping it here means the STORED value is clean too,
      // which matters when it is a community template an admin has to read.
      ? h.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, HINT_LIMITS.MAX_LEN)
      : ''
  ));
  // An array of nothing but empty strings is noise — drop it entirely so a
  // template that was never labelled carries no `hints` key at all.
  return out.some((h) => h) ? out : null;
}

// Reading-order array → { cellId: label } for a specific instantiated tree.
// This is the one place the index-keyed storage meets the id-keyed runtime, and
// it runs AFTER instantiateLayout has minted the real ids — which is the whole
// reason hints are stored by index in the first place.
export function hintsToCellMap(tree, hints, box = { x: 0, y: 0, w: 1000, h: 1000 }) {
  const clean = sanitizeHints(hints);
  if (!tree || !clean) return null;
  const ids = readingOrder(computeCellRects(tree, box));
  const out = {};
  ids.forEach((id, i) => { if (clean[i]) out[id] = clean[i]; });
  return Object.keys(out).length ? out : null;
}

// The payload written to grid_layouts.body when someone saves the grid they have
// selected. Geometry and labels only, by design: no image refs means no
// cross-workspace R2 grants to solve, and a template stays ~1KB of JSON that is
// trivially shareable.
export function bodyFromGrid(layout, textStyle, hints, size) {
  const tree = sanitizeLayout(layout);
  if (!tree) return null;
  const body = { layout: tree };
  if (textStyle) body.textStyle = textStyle;
  const clean = sanitizeHints(hints);
  if (clean) body.hints = clean;
  const dims = sanitizeSize(size);
  if (dims) body.size = dims;
  return body;
}
