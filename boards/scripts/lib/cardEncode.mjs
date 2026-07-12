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
import { resolveTagText } from '../../src/lib/gridSequence.js';
import { schedItems, schedLegacyRows } from '../../src/lib/schedLayout.js';

// Per-kind card_index.meta — mirrors buildCardMeta() in src/lib/boardsApi.js.
// image → { src, alt, w, h } is what get_public_board_content turns into
// media.src_key, which /api/public-img and the image sitemap serve.
// get_public_board_page (0181) additionally reads: swatches (palette),
// rows (schedule), cells/rows/cols (grid), shape/label (shape), poster (video).
export function buildCardMeta(kind, card) {
  const g = (k) => card[k];
  switch (kind) {
    case 'image':
      return { src: g('src') || null, alt: g('alt') || null, w: g('w') || null, h: g('h') || null };
    case 'palette':
      return { swatches: (g('swatches') || []).slice(0, 12) };
    case 'link':
      return { url: g('link') || g('source') || g('url') || null };
    case 'board':
    case 'boardlink':
      return { boardId: g('id') || g('target') || null };
    case 'doc':
      // The legacy flat doc card renders `lines`, not `pages`.
      return { lineCount: (g('lines') || []).length || null };
    case 'schedule': {
      // New-model calendar (schedView + date-keyed cells) — lockstep with
      // src/lib/boardsApi.js buildCardMeta. The generator still only emits
      // legacy rows tables; this fork exists for parity.
      if (g('schedView')) {
        const items = schedItems(card.gridCells || card.cells || {}, { max: 30 });
        return { schedView: g('schedView'), anchor: g('anchor') || null, items, rows: schedLegacyRows(items) };
      }
      return { rows: (g('rows') || []).slice(0, 30) };
    }
    case 'grid': {
      // Row-major cell summary for the page RPC. The RPC strips `src`
      // before it reaches the client; it's kept here for future image-
      // sitemap use only. [#]/[A] auto-number tags resolve with the app's
      // real gridSequence resolver (row-major == 'z' spatial order for a
      // uniform generator grid), so the article shows "01 · Master", never
      // a literal "[#]".
      const cells = card.gridCells || card.cells || {};
      const fmt = card.seqFormat || {};
      const out = [];
      let idx = 0;
      for (const cell of Object.values(cells)) {
        const i = idx++;
        if (!cell || cell.type === 'empty') { out.push({ type: 'empty' }); continue; }
        out.push({
          type: cell.type,
          src: cell.src || null,
          alt: cell.alt || null,
          text: cell.type === 'text'
            ? htmlToText(resolveTagText(cell.html || '', { index: i, format: fmt }))
            : null,
        });
      }
      return { rows: g('gridRows') || null, cols: g('gridCols') || null, cells: out.slice(0, 60) };
    }
    case 'shape':
      return { shape: g('shape') || 'rect', label: g('label') || null };
    case 'video':
      // src/poster keys recorded for R2-sweep ref-counting; the page RPC
      // exposes neither.
      return { src: g('src') || null, poster: g('poster') || null };
    default:
      return null;
  }
}

// Strip HTML to text for the card_index.body column (notes carry `html`).
function htmlToText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

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
    if (card.seed === true || (card.id && String(card.id).startsWith('onb-'))) continue;
    const g = (k) => card[k];
    const kind = g('kind') || 'note';
    const title = g('title') || g('name') || g('label') || g('url') || '';
    const rawBody = g('body') || g('caption') || '';
    let body = rawBody || htmlToText(g('html') || '');
    // Kind-aware bodies so the page RPC / search see the real content.
    if (kind === 'doc' && Array.isArray(card.lines)) {
      body = card.lines.map((l) => (l.bullet ? `• ${l.text}` : l.text || '')).join('\n').trim() || body;
    } else if (kind === 'schedule' && card.schedView) {
      body = schedLegacyRows(schedItems(card.gridCells || card.cells || {})).map((r) => [r.day, r.what, r.loc].filter(Boolean).join(' — ')).join('\n') || body;
    } else if (kind === 'schedule' && Array.isArray(card.rows)) {
      body = card.rows.map((r) => [r.day, r.what, r.loc].filter(Boolean).join(' — ')).join('\n') || body;
    }
    const meta = buildCardMeta(kind, card) || {};
    // Layout metadata for the page RPC's spatial ordering + section grouping
    // (0181 get_public_board_page orders by meta.pos and splits sections at
    // meta.sectionHeader boundaries).
    if (Number.isFinite(card.x) && Number.isFinite(card.y)) {
      meta.pos = { x: Math.round(card.x), y: Math.round(card.y),
                   w: Math.round(card.w || 0), h: Math.round(card.h || 0) };
    }
    if (card.sectionHeader) {
      meta.sectionHeader = true;
      if (card.sub) meta.sub = String(card.sub).slice(0, 300);
    }
    rows.push({
      workspace_id: workspaceId,
      board_id: boardId,
      card_id: card.id,
      kind,
      title: String(title).slice(0, 200),
      body: String(body).slice(0, 500),
      meta,
      weight: 1,
    });
  }
  return rows;
}
