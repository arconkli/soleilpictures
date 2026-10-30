// build.mjs — a recipe and its photos → the board's cards and sections.
//
// The board is composed by the app's own maker (lib/makeBoard.js
// composeMakeBoard): notes written and fitted to their text, palettes sized to
// their swatches, pictures at their true shape, sections in the named colours,
// note tints, and `auto` laying it all out. So an engine board is laid out the
// way an assistant's board is, and work on one improves the other.
//
// Two things the maker doesn't make, done here, each laid out as a picture of
// its shape and then turned into its own card in the same place: a video, and
// a script, which becomes the app's real screenplay doc (a doc card in
// screenplay mode, as a dropped .fountain file becomes one; the owner, 10-29:
// "we have a screenplay docs feature for screenplay kinda stuff and scenes").
// The card carries the scene's Fountain as `script`; cardEncode.mjs writes it
// into the card's own doc store and keeps it off the stored card.
//
// Pure. Cards carry `photo: 'si.ii'` (the recipe item their picture came from)
// and no src; withSources() fills the srcs in, once for the stored board (r2:
// keys) and once for the staged one the shooter photographs (local files).

import { composeMakeBoard } from '../../src/lib/makeBoard.js';
import { stampCard } from '../lib/cardEncode.mjs';

// A script's place on the board: a page, a little taller than wide, so the
// closed card shows the scene's opening lines under its name.
export const SCRIPT_SHAPE = Object.freeze({ width: 1000, height: 1250 });

// An image's caption is one line over the picture, cut with an ellipsis when it
// runs long (styles.css .ic .ic-cap.editable-overlay: 10.5px mono, .04em
// tracking, 8px inset, 7px padding). A caption that doesn't fit its card is cut
// back to whole words, or left off when fewer than two would remain: a board
// with "Opening wide. Hold it longer than f…" on it reads as broken.
export const CAPTION = Object.freeze({ charPx: 6.8, insetPx: 30 });

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
      if (it.kind === 'script') {
        pictures.push(SCRIPT_SHAPE);
        items.push({ key, kind: 'script', it });
        return [{ kind: 'picture', url: `script:${key}` }];
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
    } else if (src.kind === 'script') {
      card = { id: card.id, kind: 'doc', title: String(src.it.title || '').trim() || 'Untitled script', script: String(src.it.fountain || ''),
        x: card.x, y: card.y, w: card.w, h: card.h, ...(card.groupId ? { groupId: card.groupId } : {}) };
    }
    return stampCard(card, i, now);
  });

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
