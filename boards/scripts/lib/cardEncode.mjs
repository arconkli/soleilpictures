// Card encoding for the board generator.
//
// Turns a recipe's plain card objects into (a) the base64 Y.Doc snapshot the
// app stores in board_state.doc and (b) the card_index rows the SQL SEO RPCs
// read. Reuses the app's REAL yhelpers (cardToYMap / readCards / bytesToB64) so
// what we write is byte-identical to what the editor writes — no drift.
//
// The card_index mirror is the easy-to-miss, must-get-right step: the public
// /c/<slug> content RPCs and the image sitemap read card_index, NOT the Y.Doc
// blob. A board with a snapshot but no card_index rows renders blank.

import * as Y from 'yjs';
import { cardToYMap, readCards, bytesToB64 } from '../../src/lib/yhelpers.js';
import { buildCardIndexRow } from '../../src/lib/cardIndexRow.js';


// Strip HTML to text for the card_index.body column (notes carry `html`).

// Stamp the fields the editor stamps (stampCreate) so a generated board is
// indistinguishable from a hand-built one on load.
export function stampCard(card, i, nowIso) {
  const z = card.z != null ? card.z : i + 1;
  return {
    ...card,
    z,
    createdBy: card.createdBy || null,
    createdAt: card.createdAt || nowIso,
    updatedBy: card.updatedBy || null,
    updatedAt: card.updatedAt || nowIso,
  };
}

// Grid cards need NESTED Y.Maps (gridCells) to render in production — a plain
// object won't render (readGridModel reads cardYMap.get('gridCells').forEach).
// Everything else is a flat Y.Map via cardToYMap. `layout` stays a plain object.
function cardToYMapDeep(card) {
  if (card.kind !== 'grid') return cardToYMap(card);
  const m = new Y.Map();
  for (const [k, v] of Object.entries(card)) {
    if (k === 'cells' || k === 'gridCells') continue;
    m.set(k, v);
  }
  const gc = new Y.Map();
  const cells = card.gridCells || card.cells || {};
  for (const [cid, cell] of Object.entries(cells)) gc.set(cid, cell);
  m.set('gridCells', gc);
  m.set('gridMeta', new Y.Map());
  return m;
}

// Build a rows×cols grid: a plain `layout` fraction-tree (col of rows, each a row
// of leaves) + a `cells` map keyed by leaf id. cellContents is row-major.
export function buildGridStructure(cellContents, rows, cols) {
  const cells = {};
  const rowNodes = [];
  for (let r = 0; r < rows; r++) {
    const leaves = [];
    for (let c = 0; c < cols; c++) {
      const id = `gc-${r}-${c}`;
      cells[id] = cellContents[r * cols + c] || { type: 'empty' };
      leaves.push({ type: 'leaf', id, frac: 1 / cols });
    }
    rowNodes.push({ type: 'row', frac: 1 / rows, children: leaves });
  }
  return { layout: { type: 'col', frac: 1, children: rowNodes }, cells };
}

// Build the base64 board_state.doc snapshot from stamped cards + arrows (+ the
// optional board-level structures). Matches saveBoardSnapshot(): Y.Map('cards')
// keyed by card.id + Y.Array('arrows') + Y.Array('strokes') + Y.Map('groups')
// (values MUST be nested Y.Maps — readGroups calls .forEach on them) +
// Y.Map('gridTemplates') / Y.Map('gridSequences') (plain-object values are fine —
// readGridTemplates/readGridSequences handle both).
export function encodeBoardSnapshot(cards, arrows = [], extras = {}) {
  const { strokes = [], groups = [], gridTemplates = [], gridSequences = [] } = extras;
  const doc = new Y.Doc();
  const map = doc.getMap('cards');
  doc.transact(() => {
    for (const c of cards) map.set(c.id, cardToYMapDeep(c));
    if (Array.isArray(arrows) && arrows.length) {
      doc.getArray('arrows').push(arrows.map((a) => ({ ...a })));
    }
    if (Array.isArray(strokes) && strokes.length) {
      doc.getArray('strokes').push(strokes.map((s) => ({ ...s })));
    }
    if (Array.isArray(groups) && groups.length) {
      const gm = doc.getMap('groups');
      for (const g of groups) {
        const ym = new Y.Map();
        for (const [k, v] of Object.entries(g)) ym.set(k, v);
        gm.set(g.id, ym);
      }
    }
    if (Array.isArray(gridTemplates) && gridTemplates.length) {
      const tm = doc.getMap('gridTemplates');
      for (const t of gridTemplates) tm.set(t.id, { ...t });
    }
    if (Array.isArray(gridSequences) && gridSequences.length) {
      const sm = doc.getMap('gridSequences');
      for (const s of gridSequences) sm.set(s.id, { ...s });
    }
  });
  const b64 = bytesToB64(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  return b64;
}

// Round-trip a snapshot back to cards (for local verification without prod).
export function decodeBoardSnapshot(b64) {
  const doc = new Y.Doc();
  const bytes = Uint8Array.from(Buffer.from(b64, 'base64'));
  Y.applyUpdate(doc, bytes);
  const out = readCards(doc);
  doc.destroy();
  return out;
}

// Build the card_index rows the SEO RPCs read. Mirrors syncCardIndex()'s row
// shape exactly: { workspace_id, board_id, card_id, kind, title, body, meta, weight }.
export function buildCardIndexRows({ workspaceId, boardId, cards }) {
  const rows = [];
  for (const card of cards) {
    // Same projection the browser uses — see src/lib/cardIndexRow.js for why
    // that is one function now and not two that were supposed to match.
    const row = buildCardIndexRow({
      workspaceId, boardId, cardId: card.id, get: (k) => card[k],
    });
    if (row) rows.push(row);
  }
  return rows;
}
