// makeBoard — the board a /make link becomes (lib/makeLink.js reads the link).
//
// Every card's size, each section's colour, a note's tint and where every card
// sits, worked out once, the way the API works them out for an assistant's
// board: notes written and fitted to their text (noteCompose, noteFit), a
// palette sized to its swatches, pictures at their true shape, sections in the
// API's named colours, and `auto` laying it out (layoutAuto). The page shows
// `cards`; keeping it sends `wire` through the API's ordinary card route
// (worker-make.js) with every size, colour and place already set, so the board
// that is kept is the board that was shown.
//
// Pure. The page gives each picture's size as its browser drew it; keeping
// gives the same sizes, so the same board comes out.
import { composeNoteHtml } from './noteCompose.js';
import { fitNoteSize } from './noteFit.js';
import { paletteSize, pictureSize, readSections, readSwatches, resolveSections, sectionKey } from './apiCards.js';
import { tintNewNotes } from './boardStyle.js';
import { arrangeAuto } from './layoutAuto.js';

// A picture's sides, as given: no wider than this many times its height either
// way (a sliver laid out across a section would be a line).
const MAX_ASPECT = 8;

// { width, height } a picture loaded at, or null when it didn't.
export function pictureShape(d) {
  const width = Number(d?.width);
  const height = Number(d?.height);
  if (!(width > 0) || !(height > 0)) return null;
  const aspect = Math.min(MAX_ASPECT, Math.max(1 / MAX_ASPECT, width / height));
  return { aspect, ...pictureSize(aspect * 1000, 1000) };
}

/**
 * The board `board` (makeLink's reading of a link) makes.
 *   pictures: by picture, in the order they come: { width, height } when it
 *             loaded, null when it didn't (it is left out).
 *   max:      keep only the first this many cards (an account with room for
 *             fewer than the link holds).
 *   now:      the time new groups are stamped with.
 * → { name, groups, wireGroups, cards, wire, left, over }
 *   groups: the sections, { id, name, color, … } as the canvas stores them.
 *   cards:  the cards as the canvas stores them, laid out, in order.
 *   wire:   the same cards as POST /boards/:id/cards takes them (a picture's
 *           `pic` is its place among the link's pictures; keeping swaps it
 *           for the stored picture's key), and `wireGroups` its sections.
 *   left:   pictures left out; over: cards past `max`.
 */
export function composeMakeBoard(board, { pictures = [], max = Infinity, now = new Date().toISOString() } = {}) {
  const fresh = [];
  let pic = -1;
  let left = 0;
  let over = 0;
  for (const s of board?.sections || []) {
    for (const it of s.items || []) {
      let card = null;
      if (it.kind === 'picture') {
        pic += 1;
        const shape = pictureShape(pictures[pic]);
        if (!shape) { left += 1; continue; }
        card = { kind: 'image', src: it.url, pic, w: shape.w, h: shape.h, aspect: shape.aspect };
        if (it.caption) card.caption = it.caption;
      } else if (it.kind === 'note') {
        const html = composeNoteHtml({ title: it.title, body: it.body });
        const fit = fitNoteSize({ html });
        card = { kind: 'note', html, w: fit.w, h: fit.h };
        if (it.title) card.title = it.title;
        if (it.body) card.body = it.body;
      } else if (it.kind === 'palette') {
        const { swatches } = readSwatches(it.swatches);
        if (!swatches) continue;
        card = { kind: 'palette', title: it.title || 'Palette', swatches, ...paletteSize(swatches.length) };
      }
      if (!card) continue;
      if (fresh.length >= max) { over += 1; continue; }
      card.id = `make-${fresh.length + 1}`;
      card.section = s.name || null;
      fresh.push(card);
    }
  }

  // The sections that kept a card, in order, coloured as the API colours new
  // ones: the colour the link gave, else the next named colour not yet worn.
  const named = [];
  const seen = new Set();
  for (const s of board?.sections || []) {
    if (!s.name || seen.has(sectionKey(s.name)) || !fresh.some((c) => c.section && sectionKey(c.section) === sectionKey(s.name))) continue;
    seen.add(sectionKey(s.name));
    named.push({ name: s.name, color: s.color || null });
  }
  const { wanted } = readSections(named, []);
  let n = 0;
  const plan = resolveSections([], wanted || [], { now, newId: () => `make-group-${(n += 1)}` });
  const colours = new Map(plan.created.map((g) => [g.id, g.color]));
  const grouped = fresh.map((c) => {
    const groupId = c.section ? plan.idByKey.get(sectionKey(c.section)) ?? null : null;
    return groupId ? { ...c, groupId } : c;
  });

  // A note takes its section's tint where the board tints its notes (two
  // sections or more, not led by pictures): decided now, with every card here.
  const tinted = tintNewNotes(grouped, [], colours);
  // Whole pixels, as the card route stores them.
  const laid = arrangeAuto([], tinted).map((c) => ({
    ...c, x: Math.round(c.x), y: Math.round(c.y), w: Math.round(c.w), h: Math.round(c.h),
  }));
  const cards = laid.map(({ aspect: _a, section: _s, pic: _p, ...c }, i) => ({
    ...c,
    ...(c.kind === 'note' ? { bgColor: c.bgColor ?? null, color: null } : {}),
    z: i + 1,
  }));

  const wire = laid.map((c) => {
    const base = { kind: c.kind, x: c.x, y: c.y, w: c.w, h: c.h };
    if (c.section) base.group = c.section;
    if (c.kind === 'note') {
      return {
        ...base,
        ...(c.title ? { title: c.title } : {}),
        ...(c.body ? { body: c.body } : {}),
        html: c.html,
        // Given either way, so the card route doesn't decide a tint again.
        color: c.bgColor || '',
      };
    }
    if (c.kind === 'palette') return { ...base, title: c.title, swatches: c.swatches };
    return { ...base, ...(c.caption ? { body: c.caption } : {}), pic: c.pic };
  });

  return {
    name: board?.title || 'Untitled',
    groups: plan.created,
    wireGroups: plan.created.map((g) => ({ name: g.name, color: g.color })),
    cards,
    wire,
    left,
    over,
  };
}
