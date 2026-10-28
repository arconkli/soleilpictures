// apiCards — what the API makes of the cards an assistant writes (P7). Pure, so
// normalizeIncomingCard and the card routes stay thin and the tests need no
// network.
//
// Three things an assistant sent that the canvas never showed, found on a board
// ChatGPT made (2026-10-27):
//   · a note's colour: the API stored `color`, and a note paints `bgColor`
//   · a palette: not a kind the API could make, so a moodboard's colours went
//     into a note as hex codes
//   · a section by its name: a group had to be made first, and its id copied
//     onto every card that belonged in it

import { CANVAS } from './canvasView.js';
import { hasCustomName } from './paletteLayout.js';
import { composeNoteHtml } from './noteCompose.js';
import { fitNoteSize, NOTE_FIT } from './noteFit.js';
import { htmlHasText, noteSourceHtml } from './noteBody.js';

export const PALETTE = Object.freeze({
  // Swatches on one palette card through the API: as many as the inline view
  // draws, so whatever an assistant makes, the chat shows whole.
  maxSwatches: CANVAS.swatchesMax,
  maxName: 40,
  // A new palette's size when the caller gives none: every swatch wide enough
  // to show its name over its hex (paletteLayout: a band 60px wide and 78 tall
  // under the 22px title strip).
  h: 150,
  minW: 300,
  perSwatch: 72,
});

// A picture added by its key with no size: a note's width at the picture's own
// shape, so it sits among notes as one of them and shows whole, and no taller
// than maxH (a tall picture narrows instead).
export const PICTURE = Object.freeze({
  w: NOTE_FIT.width,
  maxH: 420,
});

export const SECTIONS = Object.freeze({
  // A group's name, as POST /boards/:id/groups takes it.
  maxName: 120,
  // Sections one add may name in `groups`.
  maxPerCall: 50,
});

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

// "#abc", "abc", "#AABBCC" → "#aabbcc"; anything else → null.
export function hexColour(v) {
  if (typeof v !== 'string') return null;
  const m = v.trim().match(HEX);
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((ch) => ch + ch).join('') : m[1];
  return `#${h.toLowerCase()}`;
}

// A note's fill. The canvas picks the note's ink from the fill's hex
// (readableInk's 0.6 cut), so a word like "yellow" would paint with ink chosen
// for black: refused, with what to send. null or '' takes the colour off.
//   { color } | { problem }
export function readNoteColor(v) {
  if (v == null || v === '') return { color: null };
  const hex = hexColour(v);
  return hex ? { color: hex }
    : { problem: `a note's color is a hex colour like "#f3ddaa" — got ${JSON.stringify(String(v).slice(0, 40))}` };
}

// A palette's colours as the app stores them, [{ name, hex }], from
// [{ hex, name }] or plain hex strings. A swatch with no name is stored as the
// app's own new swatch is ('Color', which paletteLayout never prints).
//   { swatches } | { problem }
export function readSwatches(list) {
  const example = '[{"hex":"#1d3557","name":"Navy"}, …]';
  if (!Array.isArray(list) || !list.length) return { problem: `swatches lists the palette's colours: ${example}` };
  if (list.length > PALETTE.maxSwatches) {
    return { problem: `a palette holds at most ${PALETTE.maxSwatches} swatches — got ${list.length}` };
  }
  const swatches = [];
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    const hex = hexColour(typeof s === 'string' ? s : s?.hex);
    if (!hex) return { problem: `swatches[${i}] needs a hex colour like "#1d3557": ${example}` };
    const name = s && typeof s === 'object' && s.name != null
      ? String(s.name).replace(/\s+/g, ' ').trim().slice(0, PALETTE.maxName) : '';
    swatches.push({ name: name || 'Color', hex });
  }
  return { swatches };
}

export const paletteSize = (count) => ({
  w: Math.max(PALETTE.minW, count * PALETTE.perSwatch),
  h: PALETTE.h,
});

// A palette's colours on the wire: a name only where someone gave one.
export const publicSwatches = (list) => (Array.isArray(list) ? list : [])
  .filter((s) => s && typeof s === 'object')
  .map((s) => ({ hex: s.hex ?? null, name: hasCustomName(s.name) ? s.name : null }));

// A section's name as given: runs of spaces one space, trimmed, capped. null
// when nothing is left (or nothing was given).
export function sectionName(v) {
  if (typeof v !== 'string') return null;
  const name = v.replace(/\s+/g, ' ').trim().slice(0, SECTIONS.maxName);
  return name || null;
}

// How two section names are told apart: a board's "Canon" and "canon" are one.
export const sectionKey = (name) => name.toLowerCase();

// The sections one write names, in order: `groups` [{ name, color }] first,
// then any a card names that the list didn't.
//   { wanted: [{ name, color }] } | { problem }
export function readSections(groups, cards) {
  const wanted = [];
  const seen = new Set();
  if (groups != null) {
    if (!Array.isArray(groups)) return { problem: 'groups lists sections: [{"name":"Canon","color":"#3f7ab5"}, …]' };
    if (groups.length > SECTIONS.maxPerCall) return { problem: `at most ${SECTIONS.maxPerCall} groups in one call` };
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      const name = sectionName(typeof g === 'string' ? g : g?.name);
      if (!name) return { problem: `groups[${i}] needs a name` };
      if (seen.has(sectionKey(name))) continue;
      seen.add(sectionKey(name));
      const color = g && typeof g === 'object' && g.color != null ? String(g.color).slice(0, 40) || null : null;
      wanted.push({ name, color });
    }
  }
  for (const c of cards || []) {
    const name = sectionName(c?.group);
    if (!name || seen.has(sectionKey(name))) continue;
    seen.add(sectionKey(name));
    wanted.push({ name, color: null });
  }
  return { wanted };
}

// Which group each wanted section is on a board holding `existing` groups
// (oldest first, as groupsOf reads them): the oldest one already carrying that
// name, else a new group, made the way POST /boards/:id/groups makes one. A
// section that already exists keeps its colour; `color` only colours a new one.
//   { idByKey: Map(sectionKey → id), created: [group record], order: [id] }
export function resolveSections(existing, wanted, { userId = null, now = new Date().toISOString(), newId } = {}) {
  const idByKey = new Map();
  for (const g of existing || []) {
    const name = sectionName(g?.name);
    if (name && !idByKey.has(sectionKey(name))) idByKey.set(sectionKey(name), String(g.id));
  }
  const created = [];
  const order = [];
  for (const { name, color } of wanted || []) {
    const key = sectionKey(name);
    if (!idByKey.has(key)) {
      const group = {
        id: newId ? newId() : crypto.randomUUID(),
        name,
        color: color || null,
        shape: 'box',
        outline: true,
        kind: null,
        createdAt: now,
        createdBy: userId,
      };
      created.push(group);
      idByKey.set(key, group.id);
    }
    order.push(idByKey.get(key));
  }
  return { idByKey, created, order };
}

// A picture's size on the board from its own pixels (PICTURE). null when they
// aren't a size.
export function pictureSize(width, height) {
  const aspect = Number(width) / Number(height);
  if (!Number.isFinite(aspect) || aspect <= 0) return null;
  let w = PICTURE.w;
  let h = Math.round(w / aspect);
  if (h > PICTURE.maxH) {
    h = PICTURE.maxH;
    w = Math.max(1, Math.round(h * aspect));
  }
  return { w, h: Math.max(1, h) };
}

const LEADS_WITH_HEADING = /^\s*<h[1-3][\s>]/i;
// Html with something to show: text, or a picture.
const htmlShows = (html) => htmlHasText(html) || /<img\b/i.test(String(html || ''));

// The html a note the API writes shows: its own html, under the title it names
// when that html doesn't open with a heading of its own; else its title and
// body composed (noteCompose). The html as given when there is nothing to show.
export function noteHtmlFor({ title, body, html }) {
  if (htmlShows(html)) {
    return title && !LEADS_WITH_HEADING.test(html) ? composeNoteHtml({ title }) + html : html;
  }
  if (title || body) return composeNoteHtml({ title, body: body ?? null });
  return html;
}

// The height every note the API made had before notes were fitted to their
// text (P7 step 2a).
const OLD_NOTE_H = 180;

// A note the API wrote, as the API writes one now: its title and body in the
// html the canvas draws, a hex colour on the fill the canvas paints, and tall
// enough for its text. Only a note nobody has touched in the app: the API's own
// (an `api-` id), never opened in the note editor, never sized by hand. Its
// height changes only when its text doesn't fit, or when it is still the height
// every API note used to get. The fields to write, or null when it is current.
export function noteRepair(c) {
  if (c?.kind !== 'note' || !String(c.id ?? '').startsWith('api-')) return null;
  if (c.noteFragmentSeeded || c.manuallyResized) return null;
  const fix = {};
  const html = noteHtmlFor({ title: c.title, body: c.body, html: c.html });
  if (typeof html === 'string' && html !== c.html) fix.html = html;
  if (!c.bgColor) {
    const hex = hexColour(c.color);
    if (hex) {
      fix.bgColor = hex;
      fix.color = null;
    }
  }
  const text = noteSourceHtml(fix.html ?? c.html, c.body);
  if (htmlHasText(text) && Number.isFinite(c.w) && c.w > 0) {
    const { h } = fitNoteSize({ html: text, w: c.w });
    if (h !== c.h && (c.h === OLD_NOTE_H || h > c.h)) fix.h = h;
  }
  return Object.keys(fix).length ? fix : null;
}
