// The card_index projection — ONE definition.
//
// WHY THIS FILE EXISTS. card_index is written from two places: the browser
// (boardsApi.js `syncCardIndex`, on every board edit) and the server
// (scripts/lib/cardEncode.mjs `buildCardIndexRows`, used by /api/v1 and the
// board generator). Both built the row by hand, and both carried a comment
// telling the next person to keep them in lockstep. They did not stay in
// lockstep. Four divergences had accumulated:
//
//   · htmlToText — the browser replaced `&amp;` with a SPACE, so "Tom & Jerry"
//     was indexed as "Tom  Jerry", and dropped paragraph breaks the public
//     /c/<slug> article renders from.
//   · doc meta — the browser emitted { pageCount, lineCount }, the server only
//     { lineCount }.
//   · weight — the browser weighed a grid by its FILLED CELLS, the server
//     always wrote 1. So a grid created through the API counted as one card
//     against the demo cap until a human opened the board, and then counted as
//     twenty-five. The cap moved under the user.
//   · groupId / groupName — browser only.
//
// Each of those means the same card gets a different row depending on who wrote
// it last, which is a bug on its own. It became a worse one when webhooks
// landed: the card_index UPDATE trigger fires on `meta is distinct from`, so
// every card written through the API would emit a phantom `card.updated` the
// first time somebody opened the board in a browser.
//
// The accessor is a function rather than a plain object because that is what
// both callers already had: the browser reads a Y.Map (`v.get(k)`), the server
// reads a plain object (`card[k]`). Everything else is shared.

import { cardWeight } from './gridCount.js';
import { resolveTagText } from './gridSequence.js';
import { schedItems, schedLegacyRows } from './schedLayout.js';

export const TITLE_MAX = 200;
export const BODY_MAX = 500;

// The richer of the two implementations, and the correct one. The browser's
// collapsed every entity to a space and every block to nothing.
export function htmlToText(html) {
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

// Grid and calendar cells arrive as a Y.Map in the browser and a plain object
// on the server. A Y.Map (and a JS Map) has BOTH forEach and get; a plain
// object has neither, and an array has forEach but not get.
export function cellsOf(get) {
  const raw = get('gridCells') ?? get('cells');
  if (!raw) return {};
  if (typeof raw.forEach === 'function' && typeof raw.get === 'function') {
    const out = {};
    raw.forEach((cv, ck) => { out[ck] = (cv && cv.toJSON) ? cv.toJSON() : cv; });
    return out;
  }
  return raw;
}

// Per-kind preview data. Drives the universal popover's previews AND
// get_public_board_page (0181), which renders the public /c/<slug> article:
// schedules as tables, grids as cell lists, shapes as labelled lines.
export function buildCardMeta(kind, get) {
  switch (kind) {
    case 'image':
      return {
        src: get('src') || null, alt: get('alt') || null,
        w: get('w') || null, h: get('h') || null,
      };
    case 'palette':
      return { swatches: (get('swatches') || []).slice(0, 12) };
    case 'link':
      return { url: get('link') || get('source') || get('url') || null };
    case 'board':
    case 'boardlink':
      return { boardId: get('id') || get('target') || null };
    case 'doc':
      return {
        pageCount: (get('pages') || []).length || null,
        lineCount: (get('lines') || []).length || null,
      };
    case 'schedule': {
      if (get('schedView')) {
        const items = schedItems(cellsOf(get), { max: 30 });
        return {
          schedView: get('schedView'),
          anchor: get('anchor') || null,
          items,
          rows: schedLegacyRows(items),
        };
      }
      return { rows: (get('rows') || []).slice(0, 30) };
    }
    case 'grid': {
      const cells = cellsOf(get);
      const fmt = get('seqFormat') || {};
      const out = [];
      let idx = 0;
      for (const cell of Object.values(cells)) {
        const i = idx++;
        if (!cell || cell.type === 'empty') { out.push({ type: 'empty' }); continue; }
        out.push({
          type: cell.type,
          src: cell.src || null,
          alt: cell.alt || null,
          // [#]/[A] auto-number tags resolve with the app's real resolver, so
          // the article shows "01 · Master" and never a literal "[#]".
          text: cell.type === 'text'
            ? htmlToText(resolveTagText(cell.html || '', { index: i, format: fmt }))
            : null,
        });
      }
      return { cells: out.slice(0, 60) };
    }
    case 'shape':
      return { shape: get('shape') || 'rect', label: get('label') || null };
    case 'video':
      return { src: get('src') || null, poster: get('poster') || null };
    default:
      return null;
  }
}

export function cardIndexTitle(get) {
  return String(get('title') || get('name') || get('label') || get('url') || '').slice(0, TITLE_MAX);
}

// Kind-aware, so search and the public page RPC see the real content rather
// than an empty string for anything that keeps its text somewhere structured.
export function cardIndexBody(kind, get) {
  const raw = get('body') || get('caption') || '';
  let body = raw || htmlToText(get('html') || '');
  const lines = get('lines');
  if (kind === 'doc' && Array.isArray(lines)) {
    body = lines.map((l) => (l.bullet ? `• ${l.text}` : l.text || '')).join('\n').trim() || body;
  } else if (kind === 'schedule' && get('schedView')) {
    body = schedLegacyRows(schedItems(cellsOf(get)))
      .map((r) => [r.day, r.what, r.loc].filter(Boolean).join(' — ')).join('\n') || body;
  } else if (kind === 'schedule' && Array.isArray(get('rows'))) {
    body = get('rows').map((r) => [r.day, r.what, r.loc].filter(Boolean).join(' — ')).join('\n') || body;
  }
  return String(body).slice(0, BODY_MAX);
}

// A cell container weighs its FILLED cells, minimum 1 — so a grid of 25 images
// counts ~25 toward the demo cap, not 1. Everything else, including a LEGACY
// rows schedule, weighs 1.
export function cardIndexWeight(kind, get) {
  if (kind === 'grid' || (kind === 'schedule' && get('schedView'))) {
    return cardWeight(kind, cellsOf(get));
  }
  return 1;
}

// Onboarding seeds never enter the index. The seeded "Ideas" board uses a real
// UUID card id, so the id prefix alone is not enough — the durable seed flag is
// also honoured. Keeping these out stops _stamp_first_card /
// _stamp_first_populated_board (0120) falsely stamping activation at seed time.
export function isSeedCard(cardId, get) {
  return get('seed') === true || (cardId && String(cardId).startsWith('onb-'));
}

/**
 * One card_index row, or null if the card does not belong in the index.
 *
 * `get` reads a field: `(k) => yMap.get(k)` in the browser, `(k) => card[k]` on
 * the server. `groupNameById` is optional — only the browser has the groups map.
 */
export function buildCardIndexRow({ workspaceId, boardId, cardId, get, groupNameById }) {
  if (isSeedCard(cardId, get)) return null;

  const kind = get('kind') || 'note';
  const meta = buildCardMeta(kind, get) || {};

  // Layout + section meta for get_public_board_page (0181): spatial article
  // ordering, and H2 section grouping on /c/<slug>.
  const x = get('x');
  const y = get('y');
  if (Number.isFinite(x) && Number.isFinite(y)) {
    meta.pos = {
      x: Math.round(x), y: Math.round(y),
      w: Math.round(get('w') || 0), h: Math.round(get('h') || 0),
    };
  }
  if (get('sectionHeader')) {
    meta.sectionHeader = true;
    const sub = get('sub');
    if (sub) meta.sub = String(sub).slice(0, 300);
  }

  const groupId = get('groupId') || null;
  const groupName = groupId ? (groupNameById?.get(String(groupId)) || '') : '';
  const withGroup = (groupId || groupName) ? { ...meta, groupId, groupName } : meta;

  return {
    workspace_id: workspaceId,
    board_id: boardId,
    card_id: cardId,
    kind,
    title: cardIndexTitle(get),
    body: cardIndexBody(kind, get),
    meta: withGroup,
    weight: cardIndexWeight(kind, get),
  };
}
