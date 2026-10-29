// build.mjs — a recipe and its photos → the board's cards and sections.
//
// The board is composed by the app's own maker (lib/makeBoard.js
// composeMakeBoard): notes written and fitted to their text, palettes sized to
// their swatches, pictures at their true shape, sections in the named colours,
// note tints, and `auto` laying it all out. So an engine board is laid out the
// way an assistant's board is, and work on one improves the other.
//
// Two things the maker doesn't make, done here: a video (laid out as a picture
// of its shape, then turned into a video card in the same place) and a script
// excerpt (a note set in Courier Prime, a little taller for the wider face).
//
// Pure. Cards carry `photo: 'si.ii'` (the recipe item their picture came from)
// and no src; withSources() fills the srcs in, once for the stored board (r2:
// keys) and once for the staged one the shooter photographs (local files).

import { composeMakeBoard } from '../../src/lib/makeBoard.js';
import { stampCard } from '../lib/cardEncode.mjs';

export const SCRIPT_FONT = "'Courier Prime', 'Courier New', monospace";

// An image's caption is one line over the picture, cut with an ellipsis when it
// runs long (styles.css .ic .ic-cap.editable-overlay: 10.5px mono, .04em
// tracking, 8px inset, 7px padding). A caption that doesn't fit its card is cut
// back to whole words, or left off when fewer than two would remain: a board
// with "Opening wide. Hold it longer than f…" on it reads as broken.
export const CAPTION = Object.freeze({ charPx: 6.8, insetPx: 30 });

// A script page reads as a screenplay when its speeches sit in the middle:
// the character's name, a (parenthetical) and the lines under it centred, the
// action left as it is. Notes keep paragraph alignment (TextAlign is in the
// note schema, and sanitizeNoteHtml keeps the style). A speech is a paragraph
// run, between blank lines, that opens with a name in capitals.
const CUE = /^[A-Z][A-Z0-9 .'’-]{0,28}( \((V\.O\.|O\.S\.|O\.C\.|CONT'D|CONT’D)\))?$/;
const CENTRE = '<p style="text-align: center">';

export function screenplayHtml(html) {
  const parts = String(html || '').split(/(?=<p[ >])/);
  const head = parts[0].startsWith('<p') ? '' : parts.shift();
  const text = (p) => p.replace(/<[^>]+>/g, '').replace(/&#39;/g, "'").replace(/&amp;/g, '&').trim();
  let inSpeech = false;
  const out = parts.map((p, i) => {
    const t = text(p);
    if (!t) { inSpeech = false; return p; }
    const next = parts[i + 1] ? text(parts[i + 1]) : '';
    if (!inSpeech && CUE.test(t) && /[A-Z]{2}/.test(t) && next) inSpeech = true;
    return inSpeech ? p.replace(/^<p>/, CENTRE) : p;
  });
  return head + out.join('');
}

export function fitCaption(text, cardW) {
  const t = String(text || '').trim();
  const room = Math.floor((cardW - CAPTION.insetPx) / CAPTION.charPx);
  if (t.length <= room) return t;
  const words = t.split(/\s+/);
  let out = '';
  for (const w of words) {
    const next = out ? `${out} ${w}` : w;
    if (next.length > room) break;
    out = next;
  }
  out = out.replace(/[\s,;:·—–-]+$/, '');
  return out.split(/\s+/).filter(Boolean).length >= 2 ? out : null;
}
const SCRIPT_GROW = 1.22;

/**
 * recipe: recipe.mjs's; found: photos.mjs's Map('si.ii' → photo).
 * newId: () => a fresh unique id (crypto.randomUUID in the engine).
 * → { name, groups, cards, dropped }  (dropped: items whose photo wasn't found)
 */
export function buildBoard(recipe, found, { newId, now = new Date().toISOString() } = {}) {
  const items = [];
  const pictures = [];
  const dropped = [];
  const sections = (recipe.sections || []).map((s, si) => ({
    name: s.name,
    color: s.color,
    items: (s.items || []).flatMap((it, ii) => {
      const key = `${si}.${ii}`;
      if (it.kind === 'picture' || it.kind === 'video') {
        const ph = found.get(key);
        if (!ph) { dropped.push(key); return []; }
        pictures.push({ width: ph.w, height: ph.h });
        items.push({ key, kind: it.kind, it, ph });
        return [{ kind: 'picture', url: `photo:${key}`, ...(it.caption ? { caption: it.caption } : {}) }];
      }
      if (it.kind === 'note') {
        items.push({ key, kind: 'note', it });
        return [{ kind: 'note', title: it.title || '', body: it.body || '' }];
      }
      if (it.kind === 'palette') {
        items.push({ key, kind: 'palette', it });
        return [{ kind: 'palette', title: it.title || 'Palette', swatches: it.swatches }];
      }
      return [];
    }),
  }));

  const made = composeMakeBoard({ title: recipe.title, sections }, { pictures, now });

  const groupIds = new Map(made.groups.map((g) => [g.id, newId()]));
  const groups = made.groups.map((g) => ({ ...g, id: groupIds.get(g.id) }));

  // composeMakeBoard names its cards make-1, make-2 … in the order the items
  // came, which is the order `items` holds them in.
  const cards = made.cards.map((c, i) => {
    const n = Number(String(c.id).replace('make-', '')) - 1;
    const src = items[n];
    let card = { ...c, id: newId(), ...(c.groupId ? { groupId: groupIds.get(c.groupId) } : {}) };
    if (src.kind === 'picture' || src.kind === 'video') {
      const { src: _u, ...rest } = card;
      card = { ...rest, photo: src.key, alt: src.it.caption || src.ph.alt || '' };
      if (card.caption) {
        const fit = fitCaption(card.caption, card.w);
        if (fit) card.caption = fit; else delete card.caption;
      }
      if (src.kind === 'video') {
        const { caption: _c, ...v } = card;
        card = { ...v, kind: 'video', title: src.it.caption || '' };
      }
    } else if (src.kind === 'note' && src.it.font === 'script') {
      card = { ...card, html: screenplayHtml(card.html), fontFamily: SCRIPT_FONT, h: Math.round(card.h * SCRIPT_GROW) };
    }
    return stampCard(card, i, now);
  });

  // A script note grown taller can now reach the card under it: push every
  // card below it in its column down by the growth.
  const grown = cards.filter((c) => c.fontFamily === SCRIPT_FONT);
  for (const g of grown) {
    const extra = g.h - Math.round(g.h / SCRIPT_GROW);
    for (const c of cards) {
      if (c === g) continue;
      const sameColumn = c.x < g.x + g.w && c.x + c.w > g.x;
      if (sameColumn && c.y >= g.y + g.h - extra - 1) c.y += extra;
    }
  }

  return { name: made.name, groups, cards, dropped };
}

/**
 * The cards with their pictures' srcs: srcOf(photo, 'src' | 'poster') → string.
 * The `photo` key stays on the card for the caller and is stripped on write.
 */
export function withSources(cards, found, srcOf) {
  return cards.map((c) => {
    if (!c.photo) return c;
    const ph = found.get(c.photo);
    const size = { srcW: ph.w, srcH: ph.h };
    if (c.kind === 'video') return { ...c, src: srcOf(ph, 'video'), poster: srcOf(ph, 'poster'), ...size };
    return { ...c, src: srcOf(ph, 'src'), ...size };
  });
}

export const stripBuild = (cards) => cards.map(({ photo: _p, ...c }) => c);
