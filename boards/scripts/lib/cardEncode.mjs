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

// Per-kind card_index.meta — mirrors buildCardMeta() in src/lib/boardsApi.js.
// image → { src, alt, w, h } is what get_public_board_content turns into
// media.src_key, which /api/public-img and the image sitemap serve.
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
      return { pageCount: (g('pages') || []).length || null };
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

// Build the base64 board_state.doc snapshot from stamped cards. Matches
// saveBoardSnapshot(): Y.Map('cards') keyed by card.id, then
// bytesToB64(Y.encodeStateAsUpdate(doc)).
export function encodeBoardSnapshot(cards) {
  const doc = new Y.Doc();
  const map = doc.getMap('cards');
  doc.transact(() => {
    for (const c of cards) map.set(c.id, cardToYMap(c));
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
    const body = rawBody || htmlToText(g('html') || '');
    const meta = buildCardMeta(kind, card) || {};
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
