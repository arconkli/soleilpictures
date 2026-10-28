// The inline view's arithmetic and words, apart from the page so they can be
// tested under node: how a board fits a stage, what each card is drawn as,
// and what the view says.

// The answer's _meta entries the view draws from: BOARD_VIEW.metaKey
// (lib/mcpTools.js) and the draft's (lib/mcpDrafts.js draftAnswer). A test
// holds them to those files.
export const VIEW_KEYS = Object.freeze({ canvas: 'clusters/canvas', draft: 'clusters/draft' });

// Where pictures may come from and links may lead: production and the preview.
export const ORIGINS = Object.freeze([
  'https://clusters.soleilpictures.com',
  'https://main-soleil-boards.arconkli.workers.dev',
]);

// How a card is drawn. A picture is anything the canvas answer gave a picture
// (an image, a video's poster, a link's preview, a cluster's thumbnail).
export function drawAs(card) {
  if (card.picture) return 'pic';
  switch (card.kind) {
    case 'note': return 'note';
    case 'doc': return 'doc';
    case 'palette': return 'pal';
    case 'link': return 'link';
    case 'shape': return 'shape';
    case 'board': case 'boardlink': return 'board';
    case 'image': case 'video': case 'pdf': case 'audio': case 'file': return 'file';
    default: return 'card';
  }
}

// The scale that fits a board inside a stage, with `pad` around it; never
// larger than 1 (a few small cards are drawn at their own size).
export function fitScale(bounds, width, height, pad) {
  if (!bounds || !(bounds.w > 0) || !(bounds.h > 0)) return 1;
  const sx = (width - 2 * pad) / bounds.w;
  const sy = (height - 2 * pad) / bounds.h;
  return Math.max(0.01, Math.min(1, sx, sy));
}

// The inline stage: the board fitted to the width, as tall as that makes it
// but no taller than `maxHeight` (a tall board is then fitted to the height
// and centred), and never shorter than `minHeight`.
export function inlineStage(bounds, width, { pad = 14, maxHeight = 520, minHeight = 160 } = {}) {
  if (!bounds) return { width, height: minHeight, scale: 1 };
  const byWidth = fitScale(bounds, width, Infinity, pad);
  const natural = Math.round(bounds.h * byWidth + 2 * pad);
  const height = Math.max(minHeight, Math.min(maxHeight, natural));
  return { width, height, scale: fitScale(bounds, width, height, pad) };
}

// Where the board's corner goes so the board sits in the middle of the stage.
export function centred(bounds, width, height, scale) {
  return {
    x: (width - bounds.w * scale) / 2 - bounds.x * scale,
    y: (height - bounds.h * scale) / 2 - bounds.y * scale,
  };
}

// A zoom step about a point of the stage (cx, cy), kept within limits.
export const ZOOM = { min: 0.02, max: 4, step: 1.25 };
export function zoomAbout(view, factor, cx, cy) {
  const scale = Math.min(ZOOM.max, Math.max(ZOOM.min, view.scale * factor));
  const k = scale / view.scale;
  return { scale, x: cx - (cx - view.x) * k, y: cy - (cy - view.y) * k };
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// "25 Nov", in the person's own language when the host says what it is.
export function shortDate(iso, locale) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return d.toLocaleDateString(locale || undefined, { day: 'numeric', month: 'short' });
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

// The line under the board's name.
export function metaLine(canvas, draft, locale) {
  const parts = [plural(canvas.board?.card_count ?? 0, 'card')];
  if (canvas.picture_count) parts.push(plural(canvas.picture_count, 'picture'));
  if (canvas.hidden > 0) parts.push(`${canvas.hidden} not shown`);
  if (draft) {
    parts.push('free draft');
    const by = draft.expires_at ? shortDate(draft.expires_at, locale) : null;
    if (by) parts.push(`keep it by ${by}`);
  }
  return parts.join(' · ');
}

// What a card is called when it is asked about: its title, or what it is.
const KIND_WORDS = {
  image: 'a picture', video: 'a video', note: 'a note', doc: 'a doc', palette: 'a palette', link: 'a link',
  board: 'a cluster', boardlink: 'a linked cluster', pdf: 'a PDF', audio: 'a sound', file: 'a file',
  shape: 'a shape',
};
export function cardWords(card) {
  const what = KIND_WORDS[card.kind] || 'a card';
  return card.title ? `“${card.title}” (${what.replace(/^an? /, '')})` : what;
}

// The message "Ask about these" puts in the chat, as the person: what they
// picked, by name, with the ids a model needs to look at them.
export function askText(board, cards) {
  const names = cards.slice(0, 12).map(cardWords);
  const rest = cards.length > 12 ? `, and ${cards.length - 12} more` : '';
  const ids = cards.map((c) => c.id).join(', ');
  return `About ${cards.length === 1 ? 'this' : `these ${cards.length}`} on “${board.name || 'Untitled'}”: `
    + `${names.join(', ')}${rest}. (board ${board.id}; cards ${ids})`;
}

// What the model is told the person has picked, before they say anything.
export function selectionContext(board, cards) {
  if (!cards.length) return `Nothing is picked on “${board.name || 'Untitled'}”.`;
  return `On “${board.name || 'Untitled'}” (board ${board.id}) the person has picked `
    + `${cards.map(cardWords).join(', ')} (cards ${cards.map((c) => c.id).join(', ')}).`;
}

// An address the view may use: https on one of the origins it trusts, or a
// server on this machine (a test's, or the app's own dev server).
export function safeUrl(u, origins = ORIGINS) {
  if (typeof u !== 'string') return null;
  let url;
  try { url = new URL(u); } catch { return null; }
  if (/^(localhost|127\.0\.0\.1)$/.test(url.hostname) && /^https?:$/.test(url.protocol)) return url.href;
  return url.protocol === 'https:' && origins.includes(url.origin) ? url.href : null;
}

// A colour the canvas answer gave, checked again before it reaches a style.
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
export const safeColour = (v) => (typeof v === 'string' && HEX.test(v) ? v : null);

// Whether the pictures' addresses are past (or within a minute of) their time.
export const picturesExpired = (canvas, now = Date.now()) => {
  const t = Date.parse(canvas?.expires_at || '');
  return Number.isFinite(t) && t - 60_000 <= now;
};
