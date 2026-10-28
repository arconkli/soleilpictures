// boardStyle — the colours a board the API makes wears unless it's told
// otherwise (P7). Pure; the API's card and group writes use it.
//
// The owner, shown the P7 mockups (sections outlined in named colours, notes
// plain or tinted to their section): "it should do whatever makes the most
// sense for the task at hand". So:
//   · a section the API makes without a colour takes the next of eight named
//     colours no section on the board wears yet (a section with no colour is
//     drawn in the app's gold, which the app keeps for what is selected)
//   · a note made without a colour, in a section that has one, takes the
//     section's tint, so the sections read apart at a glance: not on a board
//     that is mostly pictures (layoutAuto's leadsWithPictures: the pictures
//     and palettes carry the colour there, and the words stay quiet beside
//     them), and not on a board of one section (nothing to tell apart)
//   · a colour may be given by name: "blue" is the named blue, as a section's
//     outline or as a note's tint, and a plain word ("red") the named colour
//     nearest it
//
// The tones and tints were drawn for both canvases in the P7 mockups: every
// tone about 4.2:1 on the dark canvas and on the light one, every tint
// oklch(0.905 0.045 h), light enough for the dark ink a note picks over it.

import { leadsWithPictures } from './layoutAuto.js';

export const SECTION_COLOURS = Object.freeze([
  { name: 'blue', tone: '#3f7ab5', tint: '#cae2fd' },
  { name: 'clay', tone: '#af6440', tint: '#fbd8c9' },
  { name: 'green', tone: '#3d8550', tint: '#c9e6ce' },
  { name: 'plum', tone: '#9864a4', tint: '#efd8f5' },
  { name: 'teal', tone: '#008686', tint: '#bce7e7' },
  { name: 'rose', tone: '#b25e6c', tint: '#fdd6da' },
  { name: 'moss', tone: '#6d7e2b', tint: '#dae4c2' },
  { name: 'slate', tone: '#6d7889', tint: '#dbe0e7' },
].map(Object.freeze));

// The tint of any other colour: its hue at the named tints' lightness, no more
// saturated than they are (a grey stays a grey).
const TINT = Object.freeze({ l: 0.905, c: 0.045, keep: 0.41 });

const HEX6 = /^#([0-9a-f]{6})$/i;
const HEX3 = /^#([0-9a-f]{3})$/i;

// "#abc" / "#AABBCC" → "#aabbcc"; anything else → null.
function hex(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (HEX6.test(s)) return s.toLowerCase();
  const m = s.match(HEX3);
  return m ? `#${[...m[1]].map((ch) => ch + ch).join('')}`.toLowerCase() : null;
}

// The plain colour words an assistant reaches for instead of a name, each the
// named colour nearest it: by hue (OKLCH), then by eye where two sit close
// (red is rose, brown is clay). Gold is moss, never the app's gold. CSS would
// draw "red" as a pure red outline, and a note can't take a word at all.
export const COLOUR_WORDS = Object.freeze({
  blue: Object.freeze(['navy', 'sky', 'azure', 'cobalt']),
  clay: Object.freeze(['orange', 'amber', 'brown', 'rust', 'terracotta', 'copper', 'coral', 'peach', 'tan']),
  green: Object.freeze(['lime', 'emerald', 'forest', 'mint', 'jade']),
  plum: Object.freeze(['purple', 'violet', 'indigo', 'lavender', 'lilac', 'mauve', 'magenta', 'fuchsia']),
  teal: Object.freeze(['cyan', 'aqua', 'turquoise']),
  rose: Object.freeze(['red', 'crimson', 'scarlet', 'maroon', 'burgundy', 'pink']),
  moss: Object.freeze(['yellow', 'gold', 'mustard', 'olive', 'khaki', 'sage']),
  slate: Object.freeze(['grey', 'gray', 'silver', 'charcoal']),
});

const BY_WORD = new Map(SECTION_COLOURS.flatMap((c) => [
  [c.name, c], ...(COLOUR_WORDS[c.name] || []).map((w) => [w, c]),
]));

/**
 * The named colour called `v` ("Blue", " teal "), or that a plain colour word
 * means ("red", "dark red"), or null.
 */
export function namedColour(v) {
  if (typeof v !== 'string') return null;
  const word = v.trim().toLowerCase().replace(/^(?:light|dark|pale|deep|bright)[\s-]+(?=\S)/, '');
  return BY_WORD.get(word) || null;
}

/**
 * A section's colour as it is stored: a named colour's tone for its name,
 * anything else as given (the canvas draws the outline in it), capped. null
 * for nothing.
 */
export function sectionColour(v) {
  if (v == null) return null;
  const named = namedColour(String(v));
  if (named) return named.tone;
  const s = String(v).trim().slice(0, 40);
  return s || null;
}

/**
 * The colours `count` new sections take on a board whose sections wear
 * `worn` (their colours, any case): the named tones in order, those worn
 * passed over until every one is.
 */
export function nextSectionColours(worn, count) {
  const used = new Map(SECTION_COLOURS.map((c) => [c.tone, 0]));
  for (const w of worn || []) {
    const h = hex(w);
    if (h && used.has(h)) used.set(h, used.get(h) + 1);
  }
  const out = [];
  for (let i = 0; i < count; i++) {
    // The least worn, the first of equals.
    let pick = SECTION_COLOURS[0];
    for (const c of SECTION_COLOURS) if (used.get(c.tone) < used.get(pick.tone)) pick = c;
    used.set(pick.tone, used.get(pick.tone) + 1);
    out.push(pick.tone);
  }
  return out;
}

// sRGB hex ↔ OKLab (Björn Ottosson's matrices).
const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const fromLinear = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

function oklab(h) {
  const n = parseInt(h.slice(1), 16);
  const r = toLinear((n >> 16) / 255);
  const g = toLinear(((n >> 8) & 255) / 255);
  const b = toLinear((n & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  };
}

function hexFromOklab({ L, a, b }) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
  return `#${rgb.map((v) => Math.round(Math.min(1, Math.max(0, fromLinear(v))) * 255)
    .toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The tint a note takes in a section of colour `v`: the named tint for a named
 * tone (or name), else the colour's hue made as light as the named tints. null
 * for a colour that isn't a hex or a name.
 */
export function tintOf(v) {
  const named = namedColour(String(v ?? '')) || SECTION_COLOURS.find((c) => c.tone === hex(v));
  if (named) return named.tint;
  const h = hex(v);
  if (!h) return null;
  const { a, b } = oklab(h);
  const chroma = Math.hypot(a, b);
  const c = Math.min(TINT.c, chroma * TINT.keep);
  const k = chroma > 0 ? c / chroma : 0;
  return hexFromOklab({ L: TINT.l, a: a * k, b: b * k });
}

/**
 * Whether the notes on a board holding `cards` (each with its kind and
 * groupId) take their sections' tints: two sections or more, and not mostly
 * pictures.
 */
export function tintsNotes(cards) {
  const list = (cards || []).filter(Boolean);
  const sections = new Set(list.map((c) => c.groupId).filter(Boolean).map(String));
  return sections.size > 1 && !leadsWithPictures(list);
}

/**
 * Tints the notes in `fresh` that came with no colour of their own (no
 * bgColor key) and sit in a section with a colour, when the board they join
 * (`existing` plus them) tints its notes. `colours`: Map(group id → colour).
 * Returns the cards, tinted ones as copies.
 */
export function tintNewNotes(fresh, existing, colours) {
  if (!colours?.size || !tintsNotes([...(existing || []), ...(fresh || [])])) return fresh;
  return fresh.map((c) => {
    if (c?.kind !== 'note' || 'bgColor' in c || !c.groupId) return c;
    const tint = tintOf(colours.get(String(c.groupId)));
    return tint ? { ...c, bgColor: tint } : c;
  });
}
