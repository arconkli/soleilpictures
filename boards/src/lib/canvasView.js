// canvasView — a board as it is drawn, for something that draws it somewhere
// else: the inline view in an AI chat (show_board, an MCP App) through
// GET /api/v1/boards/:id/canvas. Where every card sits and how big it is, what
// each kind shows at a glance, the groups round them, and an address for each
// picture that works for an hour without a session.
//
// Pure: the route reads the board, its cards and the picture rows (as the
// caller) and signs; this decides what goes out. Small on purpose: Claude
// writes a tool result over about 150,000 characters to a file, and the view
// then gets nothing.

import { htmlToText } from './cardIndexRow.js';
import { pickRendition, readingOrder } from './gallery.js';

export const CANVAS = {
  // Cards drawn, in reading order; past it the rest are counted in `hidden`.
  maxCards: 400,
  // Pictures given an address; past it a picture is drawn in its colour.
  maxPictures: 80,
  // Characters of a card's text, and of a title or name.
  textMax: 160,
  titleMax: 80,
  // Colours on a palette card.
  swatchesMax: 12,
};

const r2Key = (v) => (typeof v === 'string' && v.startsWith('r2:') && v.length > 3 ? v.slice(3) : null);
const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);
const round1 = (v) => Math.round(v * 10) / 10;
function clip(s, n) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

// Only a plain hex colour goes out: these end up in a style attribute.
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const colour = (v) => (typeof v === 'string' && HEX.test(v.trim()) ? v.trim().toLowerCase() : null);

// A blurhash's first four characters after the size and the maximum are its
// average colour, an sRGB integer in base 83: the picture's colour before
// (or instead of) the picture.
const B83 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';
export function blurhashTone(hash) {
  if (typeof hash !== 'string' || hash.length < 6) return null;
  let v = 0;
  for (const ch of hash.slice(2, 6)) {
    const d = B83.indexOf(ch);
    if (d < 0) return null;
    v = v * 83 + d;
  }
  return v > 0xffffff ? null : `#${v.toString(16).padStart(6, '0')}`;
}

function domainOf(u) {
  if (typeof u !== 'string' || !u) return null;
  try {
    return new URL(u).hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

// A doc card's preview lines, as the thumbnail reads them: strings, or
// { t } / { text } objects.
function docLines(lines) {
  if (!Array.isArray(lines)) return null;
  return lines.map((l) => (l && typeof l === 'object' ? (l.t || l.text || '') : String(l ?? ''))).join(' ');
}

function swatchesOf(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const s of list) {
    const hex = colour(typeof s === 'string' ? s : (s?.hex || s?.color));
    if (!hex) continue;
    const name = s && typeof s === 'object' ? clip(s.name, 40) : null;
    out.push(name ? { hex, name } : { hex });
    if (out.length >= CANVAS.swatchesMax) break;
  }
  return out.length ? out : null;
}

// Which R2 key a card's picture is, and where it comes from. Pictures are
// signed only once the caller's own read has found them (an images row read
// as the caller, or a cluster's thumbnail on a boards row read as the caller):
// a card can name any key it likes, so naming one proves nothing.
function pictureSource(c) {
  const kind = c.kind || 'note';
  if (kind === 'image') return { key: r2Key(c.src) };
  if (kind === 'video') return { key: r2Key(c.poster) };
  if (kind === 'link') return { key: r2Key(c.image) };
  if (kind === 'board') return { board: typeof c.id === 'string' ? c.id : null };
  return null;
}

/**
 * What to read before answering: the cards that will be drawn (in reading
 * order, capped), the picture keys whose rows to read, and the clusters whose
 * names and thumbnails to read. The groups ride along to be drawn round them.
 */
export function planCanvas(cards, groups = []) {
  const placed = (cards || []).filter((c) => c && c.unplaced !== true);
  const order = readingOrder(placed);
  const drawn = order.slice(0, CANVAS.maxCards);
  const keys = new Set();
  const boardIds = new Set();
  for (const c of drawn) {
    const p = pictureSource(c);
    if (p?.key) keys.add(p.key);
    if (p?.board) boardIds.add(p.board);
    if (c.kind === 'boardlink' && typeof c.target === 'string') boardIds.add(c.target);
  }
  return { placed: placed.length, drawn, keys: [...keys], boardIds: [...boardIds], groups: groups || [] };
}

function textFor(c, kind) {
  if (kind === 'note') return clip(c.html ? htmlToText(c.html) : (c.body ?? c.text), CANVAS.textMax);
  if (kind === 'image' || kind === 'video') return clip(c.caption ?? c.body, CANVAS.textMax);
  if (kind === 'doc') return clip(docLines(c.lines), CANVAS.textMax);
  if (kind === 'boardlink') return clip(c.note, CANVAS.textMax);
  if (kind === 'board') return null;
  return clip(c.body, CANVAS.textMax);
}

function titleFor(c, kind, boardName) {
  if (kind === 'board' || kind === 'boardlink') return clip(boardName, CANVAS.titleMax);
  if (kind === 'pdf' || kind === 'audio' || kind === 'file') {
    return clip(c.title || c.fileName || c.name, CANVAS.titleMax);
  }
  return clip(c.title, CANVAS.titleMax);
}

/**
 * The answer. `sign(key)` → an absolute address good until `expiresAt`
 * (seconds); `imageRows` are the `images` rows the caller may read, `boardRows`
 * the clusters (id, name, thumb_key) they may read.
 */
export async function canvasAnswer({ board, boardUrl, plan, imageRows = [], boardRows = [], sign, expiresAt }) {
  const rowByKey = new Map((imageRows || []).map((r) => [r.storage_path, r]));
  const boardById = new Map((boardRows || []).map((r) => [String(r.id), r]));
  let pictures = 0;
  let signed = 0;

  const out = [];
  for (const c of plan.drawn) {
    const kind = c.kind || 'note';
    const other = kind === 'board' ? boardById.get(String(c.id))
      : kind === 'boardlink' ? boardById.get(String(c.target)) : null;
    const card = {
      id: String(c.id),
      kind,
      x: round1(num(c.x, 0)),
      y: round1(num(c.y, 0)),
      w: round1(Math.max(1, num(c.w, 100))),
      h: round1(Math.max(1, num(c.h, 100))),
    };
    if (Number.isFinite(c.z)) card.z = c.z;
    if (Number.isFinite(c.rotation) && c.rotation !== 0) card.rotation = c.rotation;
    if (c.groupId) card.group_id = String(c.groupId);
    const title = titleFor(c, kind, other?.name);
    if (title) card.title = title;
    const text = textFor(c, kind);
    if (text) card.text = text;
    if (kind === 'note') {
      if (c.bgColor === 'transparent') card.color = 'transparent';
      else if (colour(c.bgColor)) card.color = colour(c.bgColor);
      if (colour(c.textColor)) card.ink = colour(c.textColor);
    }
    if (kind === 'palette') {
      const sw = swatchesOf(c.swatches);
      if (sw) card.swatches = sw;
    }
    if (kind === 'link') {
      const d = domainOf(c.url ?? c.link);
      if (d) card.domain = d;
    }

    const src = pictureSource(c);
    let picture = null;
    if (src?.key && rowByKey.has(src.key)) {
      const row = rowByKey.get(src.key);
      const rendition = pickRendition(row, 'sm');
      picture = {
        width: rendition?.width ?? row.width ?? null,
        height: rendition?.height ?? row.height ?? null,
        tone: blurhashTone(row.blur_hash),
        key: rendition?.key || null,
      };
    } else if (src?.board && boardById.get(src.board)?.thumb_key) {
      picture = { width: null, height: null, tone: null, key: boardById.get(src.board).thumb_key };
    }
    if (picture) {
      pictures += 1;
      const { key, ...rest } = picture;
      const shown = { ...rest };
      if (key && signed < CANVAS.maxPictures) {
        shown.url = await sign(key);
        signed += 1;
      }
      for (const k of Object.keys(shown)) if (shown[k] == null) delete shown[k];
      card.picture = shown;
    }
    out.push(card);
  }

  // Drawn in their stacking order, as the canvas does: z, then the order read.
  const order = new Map(out.map((c, i) => [c.id, i]));
  out.sort((a, b) => num(a.z, 0) - num(b.z, 0) || order.get(a.id) - order.get(b.id));

  // A group is drawn round the cards that point at it.
  const boxes = new Map();
  for (const c of out) {
    if (!c.group_id) continue;
    const g = boxes.get(c.group_id) || { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    g.minX = Math.min(g.minX, c.x);
    g.minY = Math.min(g.minY, c.y);
    g.maxX = Math.max(g.maxX, c.x + c.w);
    g.maxY = Math.max(g.maxY, c.y + c.h);
    boxes.set(c.group_id, g);
  }
  const groups = [];
  for (const g of plan.groups || []) {
    const box = boxes.get(String(g.id));
    if (!box) continue;
    const entry = {
      id: String(g.id),
      x: round1(box.minX), y: round1(box.minY),
      w: round1(box.maxX - box.minX), h: round1(box.maxY - box.minY),
    };
    const name = clip(g.name, CANVAS.titleMax);
    if (name) entry.name = name;
    if (colour(g.color)) entry.color = colour(g.color);
    if (g.outline === false) entry.outline = false;
    groups.push(entry);
  }

  let bounds = null;
  if (out.length) {
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (const c of out) {
      minX = Math.min(minX, c.x);
      minY = Math.min(minY, c.y);
      maxX = Math.max(maxX, c.x + c.w);
      maxY = Math.max(maxY, c.y + c.h);
    }
    bounds = { x: round1(minX), y: round1(minY), w: round1(maxX - minX), h: round1(maxY - minY) };
  }

  const background = colour(board.bg_color);
  return {
    board: {
      id: board.id,
      name: board.name,
      url: boardUrl,
      card_count: plan.placed,
      ...(background ? { background } : {}),
    },
    bounds,
    cards: out,
    groups,
    picture_count: pictures,
    hidden: plan.placed - out.length,
    expires_at: new Date(expiresAt * 1000).toISOString(),
  };
}
