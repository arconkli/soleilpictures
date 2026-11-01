// Where everything goes on a share card (the 1200x630 picture a pasted
// cluster link shows; drawn by lib/shareCard.js). Pure — the caller hands in
// `measure(text, fontPx) -> width` — so node can pin it without a canvas.
//
// The look is the search pages' (lib/sunArt.js 'og'): the logo's orbits on the
// right with up to four of the cluster's pictures piled on them, the cluster's
// name big on the left. The card carries the NAME and pictures only: never a
// note's or a doc's words.

export const CARD_W = 1200;
export const CARD_H = 630;
export const MAX_PICTURES = 4;
export const MAX_NAME_LINES = 3;

// The name's column: left edge, width, and the line its block centres on.
export const NAME_BOX = { x: 72, w: 470, cy: 315 };
const FONT_MAX = 92;
const FONT_MIN = 44;
const TWO_LINE_MIN = 68;
const LINE_H = 1.02;   // line height as a multiple of the font size

// Where the pile sits, by how many pictures there are. Each slot is a centre,
// the biggest box a picture may fill (its aspect is kept inside it) and a tilt
// in degrees. The first slot is the main picture; later ones are drawn under
// it (the first picture goes on top).
const SLOTS = {
  1: [{ cx: 925, cy: 322, w: 340, h: 380, rot: -3 }],
  2: [
    { cx: 905, cy: 292, w: 300, h: 270, rot: -3 },
    { cx: 1062, cy: 372, w: 210, h: 280, rot: 6 },
  ],
  3: [
    { cx: 929, cy: 250, w: 290, h: 255, rot: -2 },
    { cx: 1060, cy: 330, w: 200, h: 270, rot: 7 },
    { cx: 921, cy: 439, w: 165, h: 210, rot: 4 },
  ],
  4: [
    { cx: 925, cy: 250, w: 280, h: 245, rot: -2 },
    { cx: 1062, cy: 322, w: 195, h: 260, rot: 7 },
    { cx: 905, cy: 445, w: 160, h: 200, rot: 4 },
    { cx: 1085, cy: 484, w: 150, h: 140, rot: -5 },
  ],
};

const r1 = (n) => Math.round(n * 10) / 10;

// Greedy word wrap. A word wider than the column is broken by letters.
function wrap(text, fontPx, maxW, measure) {
  const lines = [];
  let line = '';
  const push = () => { if (line) lines.push(line); line = ''; };
  for (const word of text.split(' ')) {
    const tryLine = line ? `${line} ${word}` : word;
    if (measure(tryLine, fontPx) <= maxW) { line = tryLine; continue; }
    push();
    if (measure(word, fontPx) <= maxW) { line = word; continue; }
    for (const ch of word) {
      if (line && measure(line + ch, fontPx) > maxW) push();
      line += ch;
    }
  }
  push();
  return lines;
}

// Cut a line back until it and an ellipsis fit: a word at a time while it has
// more than one, then by letters.
function ellipsize(line, fontPx, maxW, measure) {
  let s = line.replace(/\s+$/, '');
  while (s && measure(`${s}…`, fontPx) > maxW) {
    const at = s.lastIndexOf(' ');
    s = (at > 0 ? s.slice(0, at) : s.slice(0, -1)).replace(/\s+$/, '');
  }
  return `${s}…`;
}

// The name: as big as fits in at most three lines, shrinking for long names;
// past the smallest size the third line ends in an ellipsis.
export function layoutName(name, measure) {
  const text = String(name == null ? '' : name).replace(/\s+/g, ' ').trim() || 'Untitled cluster';
  const maxW = NAME_BOX.w;
  // Two lines at a still-big size read better than three at the biggest.
  for (let px = FONT_MAX; px >= TWO_LINE_MIN; px -= 2) {
    const two = wrap(text, px, maxW, measure);
    if (two.length <= 2) return { nameLines: two, fontPx: px };
  }
  let fontPx = FONT_MAX;
  let lines = wrap(text, fontPx, maxW, measure);
  while (lines.length > MAX_NAME_LINES && fontPx > FONT_MIN) {
    fontPx -= 2;
    lines = wrap(text, fontPx, maxW, measure);
  }
  if (lines.length > MAX_NAME_LINES) {
    lines = lines.slice(0, MAX_NAME_LINES);
    lines[MAX_NAME_LINES - 1] = ellipsize(lines[MAX_NAME_LINES - 1], fontPx, maxW, measure);
  }
  return { nameLines: lines, fontPx };
}

// pictures: [{ w, h }] (natural sizes, biggest first). Returns
//   nameLines  the name, wrapped
//   fontPx     its size
//   lineH      px between its baselines' centres
//   nameX, nameY  the left edge and the top of the name block
//   pictures   one { x, y, w, h, rot } per picture used (the first four), in
//              the order given; x/y is the top-left BEFORE the tilt (rot, deg,
//              turns about the middle); draw the last first so the first sits
//              on top.
export function layoutShareCard({ name, pictures = [], measure }) {
  const { nameLines, fontPx } = layoutName(name, measure);
  const lineH = r1(fontPx * LINE_H);
  const blockH = lineH * nameLines.length;

  const used = (Array.isArray(pictures) ? pictures : []).slice(0, MAX_PICTURES);
  const slots = SLOTS[used.length] || [];
  const placed = used.map((p, i) => {
    const slot = slots[i];
    const pw = Number(p?.w) > 0 ? Number(p.w) : 1;
    const ph = Number(p?.h) > 0 ? Number(p.h) : 1;
    const k = Math.min(slot.w / pw, slot.h / ph);
    const w = r1(pw * k), h = r1(ph * k);
    return { x: r1(slot.cx - w / 2), y: r1(slot.cy - h / 2), w, h, rot: slot.rot };
  });

  return {
    nameLines,
    fontPx,
    lineH,
    nameX: NAME_BOX.x,
    nameY: r1(NAME_BOX.cy - blockH / 2),
    pictures: placed,
  };
}
