// Helpers for the Grid card's Yjs shape — mirrors lib/docState.js (the doc-card
// container precedent). A Grid card stores its per-cell content as nested Y types
// ON ITS OWN card Y.Map, and (when LINKED) reads its layout tree from a shared
// top-level gridTemplates map; when UNLINKED it carries its own `layout` field.
//
//   gridCells: Y.Map<cellId, record>   — per-cell content, keyed by layout leaf id
//   gridMeta:  Y.Map                    — per-grid extras
// A cell record is a plain object discriminated by `type`:
//   { type:'empty' } | { type:'image', src, adjust, fit, pos } | { type:'text', html }
//   | { type:'link', source, title, image, favicon, embed } | { type:'video', src }
//   | { type:'file', fileSrc, fileName, mime, sizeBytes, ext }
//
// Top-level (per-board) types, created in yboard.js loadYBoard:
//   gridTemplates: Y.Map<id, { id, name, layout }>   — shared layout (global sync)
//   gridSequences: Y.Map<id, { id, name, pattern, format }>  — sequence config
//
// readGridModel is the single normalized read that BOTH the Yjs path and the
// local array-state path (LocalBoardsApp, which has no Yjs) go through.

import * as Y from 'yjs';

// Origin for grid STRUCTURAL init only. Layout + cell-content edits use 'local'
// (tracked by the board UndoManager) so Cmd+Z undoes a divider drag / image drop
// — grids have no competing editor history, so unlike doc cards they don't need
// an off-stack origin. Like initCardDocStore, this runs reentrant inside addGrid's
// 'local' transact, so the OUTER 'local' wins and create+init is one undo step.
const GRID_ORIGIN = 'grid-struct';

// Initialize the Y types on a fresh Grid card YMap. Idempotent. Call once when a
// new Grid card is created (via addCard's afterInsert).
export function initCardGridStore(ydoc, cardYMap) {
  if (!cardYMap) return;
  ydoc.transact(() => {
    if (!cardYMap.get('gridCells')) cardYMap.set('gridCells', new Y.Map());
    if (!cardYMap.get('gridMeta')) cardYMap.set('gridMeta', new Y.Map());
  }, GRID_ORIGIN);
}

export function gridCellsMap(cardYMap) { return (cardYMap && cardYMap.get) ? (cardYMap.get('gridCells') || null) : null; }
export function gridMetaMap(cardYMap) { return (cardYMap && cardYMap.get) ? (cardYMap.get('gridMeta') || null) : null; }

// Live cardYMap for a grid id (Yjs path); null in local mode.
export function gridCardYMap(ydoc, cardId) {
  return ydoc?.getMap?.('cards')?.get?.(cardId) || null;
}

// Normalized { layout, cells, templateId, seqId } for a grid card. Resolves the
// layout from the shared template when linked, and reads cell content from the
// live gridCells Y.Map (Yjs) or the card.cells plain field (local mode).
export function readGridModel(card, ydoc, templates) {
  const templateId = card?.templateId || null;
  const layout = templateId
    ? ((templates && templates[templateId] && templates[templateId].layout) || card?.layout || null)
    : (card?.layout || null);
  let cells = {};
  const ym = gridCardYMap(ydoc, card?.id);
  const cm = ym && ym.get && ym.get('gridCells');
  if (cm && typeof cm.forEach === 'function') {
    cm.forEach((v, k) => { cells[k] = (v && typeof v.toJSON === 'function') ? v.toJSON() : v; });
  } else if (card?.cells && typeof card.cells === 'object') {
    cells = { ...card.cells };
  }
  return { layout, cells, templateId, seqId: card?.seqId || null };
}

// ── cell content (Yjs path) ──────────────────────────────────────────────────
export function setGridCell(ydoc, cardYMap, cellId, patch, origin = 'local') {
  const cm = gridCellsMap(cardYMap);
  if (!cm) return;
  ydoc.transact(() => {
    const prev = cm.get(cellId) || {};
    cm.set(cellId, { ...prev, ...patch });
  }, origin);
}
export function clearGridCell(ydoc, cardYMap, cellId, origin = 'local') {
  const cm = gridCellsMap(cardYMap);
  if (!cm) return;
  ydoc.transact(() => { cm.set(cellId, { type: 'empty' }); }, origin);
}

// ── shared layout templates (global sync) ────────────────────────────────────
export function upsertGridTemplate(ydoc, id, patch, origin = 'local') {
  const m = ydoc.getMap('gridTemplates');
  ydoc.transact(() => {
    const prev = m.get(id) || { id };
    m.set(id, { ...prev, ...patch, id });
  }, origin);
}
// Replace a template's layout tree → every linked Grid reflows live.
export function setTemplateLayout(ydoc, templateId, layout, origin = 'local') {
  const m = ydoc.getMap('gridTemplates');
  const prev = m.get(templateId);
  if (!prev) return;
  ydoc.transact(() => { m.set(templateId, { ...prev, layout }); }, origin);
}

// ── sequences ────────────────────────────────────────────────────────────────
export function upsertGridSequence(ydoc, id, patch, origin = 'local') {
  const m = ydoc.getMap('gridSequences');
  ydoc.transact(() => {
    const prev = m.get(id) || { id };
    m.set(id, { ...prev, ...patch, id });
  }, origin);
}
