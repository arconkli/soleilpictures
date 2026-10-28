// makeLink — a board written into a link, for AIs that can't reach Clusters.
//
// An AI with the Clusters app (ChatGPT, Claude, an MCP client) makes a board
// for real and shows it in the chat. One without it can still write the board
// into a link, https://clusters.soleilpictures.com/make#…, or as text to paste
// at /make, and the page shows the board straight away and keeps it once
// someone signs in (pages/MakePage.jsx, worker-make.js). The owner, 10-28: the
// app first wherever there is one, the link everywhere else.
//
// The board rides in the link's FRAGMENT, which a browser never sends to a
// server: nothing reaches us, and nothing is saved, until someone keeps it.
//
//   #title=Tokyo noir, 1974
//   &section=Look|blue                    a section, with an optional colour
//   &pic=https://…/street.jpg|Wet street  a picture, with an optional caption
//   &palette=Night|#101820 Ink,#f2aa4c Sodium
//   &section=Story
//   &note=Logline|A night-shift cabbie…   a note: title|body, or just body
//   &end=4                                how many cards came before it
//
// Values are percent-encoded; `end` is how a link the chat cut short is told
// from a whole one. The same board can be written as text (parseMakeText):
// `# title`, `## section`, `### note title` over its lines, `![caption](url)`,
// and `Palette: #hex Name, …`.
//
// Pure: the page reads a link with it, and the Worker reads the same link
// again when it is kept, so what is kept is what was shown.
import { publicHttpsUrlProblem } from './safeUrl.js';
import { sectionName, sectionKey, hexColour, PALETTE } from './apiCards.js';
import { namedColour } from './boardStyle.js';

export const MAKE = Object.freeze({
  // Cards one link makes, and pictures among them: each picture is fetched
  // and stored when the board is kept.
  maxCards: 60,
  maxPictures: 40,
  maxSections: 12,
  // The longest link or text read, in characters.
  maxSource: 24000,
  maxTitle: 120,
  maxNoteTitle: 120,
  maxNoteBody: 1500,
  maxCaption: 200,
  maxPaletteTitle: 60,
  maxSwatches: PALETTE.maxSwatches,
  maxSwatchName: PALETTE.maxName,
});

export const MAKE_PATH = '/make';

const PICTURE_KEYS = new Set(['pic', 'img', 'image', 'picture', 'photo']);
const TITLE_KEYS = new Set(['title', 'name', 'board']);
const SECTION_KEYS = new Set(['section', 'group']);

const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const cap = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

// Link text keeps its words: an AI's [words](address) is the words alone, so no
// link anyone else wrote is ever one a click follows from our page.
const unlink = (s) => String(s ?? '').replace(/\[([^\[\]]+)\]\(([^()\s]+)\)/g, '$1');

// A note's body: lines kept, runs of blank lines one, capped.
function bodyText(s) {
  const text = unlink(String(s ?? ''))
    .replace(/\r\n?/g, '\n')
    .split('\n').map((l) => l.replace(/[ \t]+$/g, '')).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text ? cap(text, MAKE.maxNoteBody) : null;
}

const titleText = (s, n) => {
  const t = oneLine(unlink(s));
  return t ? cap(t, n) : null;
};

// A picture's address, when it is one we'd show and later fetch: https, the
// default port, a public host (the importer's own rule).
export function pictureUrl(raw) {
  const s = String(raw ?? '').trim().replace(/^<|>$/g, '');
  if (!s || publicHttpsUrlProblem(s)) return null;
  try {
    const u = new URL(s);
    if (u.username || u.password) return null;
    return u.href;
  } catch {
    return null;
  }
}

// "#101820 Ink, #f2aa4c Sodium", "101820:Ink; f2aa4c", "Ink #101820 Sodium
// #f2aa4c" → [{ hex, name }]. A colour is a #hex anywhere in its part, or six
// hex digits starting it (a link may leave the # out). Anything else is skipped.
export function readMakeSwatches(raw) {
  const out = [];
  // Split at the separators, then before each #hex after a part's first, so a
  // name written before its colour stays with it.
  const parts = String(raw ?? '')
    .split(/[,;·|]+|\s{2,}/)
    .flatMap((p) => {
      const at = [...p.matchAll(/#[0-9a-f]{3}(?:[0-9a-f]{3})?\b/gi)].map((m) => m.index);
      if (at.length < 2) return [p];
      return at.map((start, i) => p.slice(i === 0 ? 0 : start, at[i + 1] ?? p.length));
    });
  for (const part of parts) {
    const p = part.trim();
    const m = p.match(/#([0-9a-f]{6}|[0-9a-f]{3})\b/i) || p.match(/^([0-9a-f]{6})\b/i);
    if (!m) continue;
    const hex = hexColour(m[1]);
    if (!hex) continue;
    const name = oneLine(p.replace(m[0], ' ').replace(/[([{]\s*[)\]}]/g, ' '))
      .replace(/^[\s:=(\-–—"']+|[\s:=)"']+$/g, '');
    out.push({ hex, name: name ? cap(name, MAKE.maxSwatchName) : null });
    if (out.length >= MAKE.maxSwatches) break;
  }
  return out;
}

// A palette's value: "Title|swatches", or swatches alone (when what comes
// before a | is itself colours, the | only separated them).
function paletteParts(raw) {
  const [head, rest] = valueParts(raw);
  if (head == null) return [null, rest];
  return readMakeSwatches(head).length ? [null, `${head},${rest}`] : [head, rest];
}

// One board being read: sections in order, each with its cards; loose cards
// (before any section) in a section with no name.
function reader() {
  const board = { title: null, sections: [], expected: null };
  const counts = { cards: 0, pictures: 0, overCards: 0, overPictures: 0, badPictures: 0, emptyPalettes: 0 };
  let current = null;
  const section = (name, color) => {
    const n = sectionName(name);
    // The same name again carries on that section, as the API reads names.
    const found = n ? board.sections.find((s) => s.name && sectionKey(s.name) === sectionKey(n)) : null;
    if (found) { current = found; return; }
    if (n && board.sections.filter((s) => s.name).length >= MAKE.maxSections) {
      // Past the last section the board can take, cards stay in the last one.
      current = [...board.sections].reverse().find((s) => s.name) || current;
      return;
    }
    current = { name: n, color: n ? makeColour(color) : null, items: [] };
    board.sections.push(current);
  };
  const add = (item) => {
    if (counts.cards >= MAKE.maxCards) { counts.overCards += 1; return; }
    if (item.kind === 'picture') {
      if (counts.pictures >= MAKE.maxPictures) { counts.overPictures += 1; return; }
      counts.pictures += 1;
    }
    counts.cards += 1;
    if (!current) section(null, null);
    current.items.push(item);
  };
  return {
    board,
    counts,
    title(v) { if (!board.title) board.title = titleText(v, MAKE.maxTitle); },
    section,
    picture(url, caption) {
      const href = pictureUrl(url);
      if (!href) { counts.badPictures += 1; return; }
      add({ kind: 'picture', url: href, caption: titleText(caption, MAKE.maxCaption) });
    },
    note(title, body) {
      const t = titleText(title, MAKE.maxNoteTitle);
      const b = bodyText(body);
      if (!t && !b) return;
      add({ kind: 'note', title: t, body: b });
    },
    palette(title, raw) {
      const swatches = readMakeSwatches(raw);
      if (!swatches.length) { counts.emptyPalettes += 1; return; }
      add({ kind: 'palette', title: titleText(title, MAKE.maxPaletteTitle), swatches });
    },
    done(source) {
      board.sections = board.sections.filter((s) => s.items.length);
      return finish(board, counts, source);
    },
  };
}

function finish(board, counts, source) {
  const count = board.sections.reduce((n, s) => n + s.items.length, 0);
  const problems = [];
  if (counts.badPictures) {
    problems.push({ code: 'bad_pictures', n: counts.badPictures });
  }
  if (counts.overCards || counts.overPictures) {
    problems.push({ code: 'too_many', n: counts.overCards + counts.overPictures });
  }
  // A link that says how many cards it holds, and came with fewer, was cut
  // short on its way here (a chat's own limit on what it shows as a link):
  // `got` cards read, `missing` the ones that never arrived.
  const expected = Number.isInteger(board.expected) && board.expected > 0 ? board.expected : null;
  const read = count + counts.badPictures + counts.overCards + counts.overPictures + counts.emptyPalettes;
  const cut = expected != null && read < expected ? { expected, got: count, missing: expected - read } : null;
  return {
    source,
    title: board.title,
    sections: board.sections,
    count,
    pictures: board.sections.reduce((n, s) => n + s.items.filter((i) => i.kind === 'picture').length, 0),
    cut,
    problems,
  };
}

// A percent-encoded value, read leniently: a stray % stays a %. A form's +
// is a space unless the value spells its spaces %20 (then a + is a plus), and
// a typed \n is a line break.
function decodeText(raw) {
  let s = String(raw ?? '');
  if (!/%20/i.test(s)) s = s.replace(/\+/g, ' ');
  return lenientDecode(s).replace(/\\n/g, '\n');
}

function lenientDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s.replace(/(%[0-9a-f]{2})+/gi, (run) => {
      try { return decodeURIComponent(run); } catch { return run; }
    });
  }
}

// An address as written: only what the link's own grammar needs encoded (| &
// # =) is decoded, so its own escapes (a %2F in a storage path) stay as they
// were, unless the whole address was encoded (https%3A%2F%2F…, or
// https:%2F%2F… by an encoder that leaves colons be).
function decodeAddress(raw) {
  const s = String(raw ?? '').trim();
  if (/^https?(?:%3A|:)%2F%2F/i.test(s)) return lenientDecode(s);
  return s.replace(/%(7C|26|23|3D)/gi, (m) => decodeURIComponent(m));
}

// The text before the first | and the rest, or [null, all] when there is none.
function splitBar(s) {
  const i = s.indexOf('|');
  return i < 0 ? [null, s] : [s.slice(0, i), s.slice(i + 1)];
}

// A value's two parts, decoded: split at its first bare |, so a | written
// inside a part (as %7C) stays in it; at its first | once decoded when the link
// encoded every one.
function valueParts(raw) {
  const i = raw.indexOf('|');
  if (i >= 0) return [decodeText(raw.slice(0, i)), decodeText(raw.slice(i + 1))];
  return splitBar(decodeText(raw));
}

const KNOWN_KEYS = new Set([...PICTURE_KEYS, ...TITLE_KEYS, ...SECTION_KEYS,
  'note', 'text', 'palette', 'colors', 'colours', 'end', 'v']);

// The fragment's pairs. A picture's address with a query an AI didn't encode
// (…/photo.jpg?w=1200&q=80) splits at its own &s: a pair whose key the link
// doesn't use, right after a picture's, is the rest of that address.
function fragmentPairs(s) {
  const pairs = [];
  for (const part of s.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const key = eq > 0 ? part.slice(0, eq).trim().toLowerCase() : '';
    const last = pairs[pairs.length - 1];
    if (!KNOWN_KEYS.has(key)) {
      if (last && PICTURE_KEYS.has(last.key) && !/\||%7c/i.test(last.raw)) last.raw += `&${part}`;
      continue;
    }
    pairs.push({ key, raw: part.slice(eq + 1) });
  }
  return pairs;
}

// "Look|blue", "Look (blue)" → [name, colour].
function sectionParts(raw) {
  const [a, b] = valueParts(raw);
  if (a != null) return [a, b];
  const m = b.match(SECTION_COLOUR);
  return m && makeColour(m[2]) ? [m[1], m[2]] : [b, null];
}

/**
 * Reads a /make link's fragment (with or without its #, or the whole link).
 * { source, title, sections: [{ name, color, items }], count, pictures, cut,
 * problems } — items are { kind: 'picture', url, caption } | { kind: 'note',
 * title, body } | { kind: 'palette', title, swatches: [{ hex, name }] }.
 */
export function parseMakeFragment(input) {
  let s = String(input ?? '').trim();
  const at = s.indexOf('#');
  if (/^https?:\/\//i.test(s) || at === 0) s = at >= 0 ? s.slice(at + 1) : '';
  // A chat that shows the link as HTML writes each & as &amp;. A value's own &
  // is %26, so a bare &amp; is only ever that.
  s = s.slice(0, MAKE.maxSource).replace(/&amp;/gi, '&');
  // A link encoded a second time on its way (a chat or an app that encodes the
  // address it shows: every % a %25, every | a %7C) is read as it was written.
  if (/%25[0-9a-f]{2}/i.test(s) && !s.includes('|')) s = lenientDecode(s);
  const r = reader();
  for (const { key, raw } of fragmentPairs(s)) {
    if (PICTURE_KEYS.has(key)) {
      // The address runs to the first |; the caption after it is text.
      const bar = raw.search(/\||%7c/i);
      if (bar < 0) r.picture(decodeAddress(raw), null);
      else r.picture(decodeAddress(raw.slice(0, bar)), decodeText(raw.slice(bar + (raw[bar] === '|' ? 1 : 3))));
    } else if (TITLE_KEYS.has(key)) {
      r.title(decodeText(raw));
    } else if (SECTION_KEYS.has(key)) {
      const [name, color] = sectionParts(raw);
      r.section(name, color);
    } else if (key === 'note' || key === 'text') {
      const [title, body] = valueParts(raw);
      r.note(title, body);
    } else if (key === 'palette' || key === 'colors' || key === 'colours') {
      const [title, swatches] = paletteParts(raw);
      r.palette(title, swatches);
    } else if (key === 'end') {
      const n = Number(decodeText(raw).trim());
      if (Number.isInteger(n)) r.board.expected = n;
    }
  }
  return r.done('link');
}

const IMAGE_MD = /!\[([^\]]*)\]\(\s*<?([^()\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
// A picture's address alone on a line: one ending in a picture's extension,
// or on a host that serves only pictures.
const BARE_URL = /^[-*\s]*<?(https:\/\/\S+?)>?$/i;
const PICTURE_EXT = /\.(?:jpe?g|png|webp|gif|avif)(?:[?#]\S*)?$/i;
const PICTURE_HOSTS = /^(?:images\.unsplash\.com|upload\.wikimedia\.org|images\.pexels\.com|i\.imgur\.com|live\.staticflickr\.com|cdn\.pixabay\.com)$/i;
const PALETTE_LINE = /^[-*>\s]*(?:\*\*|__)?(?:palette|colou?rs)(?:\s*\(([^)]*)\))?\s*(?:\*\*|__)?\s*[:\-–—]\s*(?:\*\*|__)?\s*(.+)$/i;
// A line of two or more #hex colours and their names, and nothing else.
const HEX_LINE = /^(?:[-*\s]*#[0-9a-f]{6}\b[^#\n]*){2,}$/i;
// A whole line in bold, as AIs title a note when they don't use ###.
const BOLD_LINE = /^(?:\*\*|__)([^*_].*?)(?:\*\*|__):?$/;
const HEADING = /^(#{1,3})\s+(.*?)\s*#*\s*$/;
// "## Look (blue)", "## Look {#3f7ab5}": a section's colour after its name.
const SECTION_COLOUR = /^(.*?)\s*[({]\s*(#?[0-9a-f]{3,6}|[a-z]+)\s*[)}]\s*$/i;

// A section's colour: a named colour, a plain colour word ("red" is rose,
// lib/boardStyle.js) or a #hex. Anything else stays part of the name, so
// "Act One (1974)" is a section called that, never one coloured "1974".
function makeColour(v) {
  const named = namedColour(v);
  if (named) return named.tone;
  const s = String(v ?? '').trim();
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(s) ? s.toLowerCase() : null;
}

function isPictureAddress(raw) {
  try {
    const u = new URL(raw);
    return PICTURE_EXT.test(u.pathname) || PICTURE_HOSTS.test(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Reads a board written as text, as an AI writes one to paste at /make:
 * `# title`, `## section`, `### note title` (the lines under it are its body),
 * `![caption](https://…)` or a bare picture address on its own line, and
 * `Palette: #hex Name, …`. A paragraph under no ### is a note of its own. A
 * pasted /make link is read as a link. Lines before the first heading are the
 * AI talking, not the board, and are skipped. Same answer as parseMakeFragment.
 */
export function parseMakeText(input) {
  const text = String(input ?? '').slice(0, MAKE.maxSource);
  const link = text.match(/https?:\/\/[^\s#]+\/make\/?#\S+/i);
  if (link) return parseMakeFragment(link[0]);
  if (/^\s*#?(title|section|pic|note)=/i.test(text)) return parseMakeFragment(text.trim());

  const r = reader();
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const headed = lines.some((l) => HEADING.test(l.trim()));
  let started = !headed;
  let note = null;                 // { title, lines } while one is open
  let para = null;                 // a paragraph with no ### over it
  const closeNote = () => { if (note) r.note(note.title, note.lines.join('\n')); note = null; };
  const closePara = () => { if (para) r.note(null, para.join('\n')); para = null; };
  const close = () => { closeNote(); closePara(); };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const h = line.match(HEADING);
    if (h) {
      started = true;
      close();
      const level = h[1].length;
      const words = h[2].replace(/^(?:\*\*|__)(.*)(?:\*\*|__)$/, '$1');
      if (level === 1) {
        if (!r.board.title) r.title(words);
        else r.section(words, null);
      } else if (level === 2) {
        const m = words.match(SECTION_COLOUR);
        if (m && makeColour(m[2])) r.section(m[1], m[2]);
        else r.section(words, null);
      } else {
        note = { title: words, lines: [] };
      }
      continue;
    }
    if (!started) continue;

    const pictures = [...line.matchAll(IMAGE_MD)];
    if (pictures.length) {
      close();
      for (const m of pictures) r.picture(m[2], m[1]);
      continue;
    }
    const bare = line.match(BARE_URL);
    if (bare && isPictureAddress(bare[1])) { close(); r.picture(bare[1], null); continue; }
    const pal = line.match(PALETTE_LINE);
    if (pal && readMakeSwatches(pal[2]).length) { close(); r.palette(pal[1] || null, pal[2]); continue; }
    if (HEX_LINE.test(line) && readMakeSwatches(line).length >= 2) { close(); r.palette(null, line); continue; }
    const bold = line.match(BOLD_LINE);
    if (bold) { close(); note = { title: bold[1], lines: [] }; continue; }

    if (note) { note.lines.push(rawLine); continue; }
    if (!line) { closePara(); continue; }
    (para ||= []).push(rawLine);
  }
  close();
  return r.done('text');
}

/** A link, the text, or nothing to read: whichever `input` is. */
export function parseMakeSource(input, { kind = null } = {}) {
  if (kind === 'link') return parseMakeFragment(input);
  if (kind === 'text') return parseMakeText(input);
  const s = String(input ?? '').trim();
  return /^#?(title|section|pic|img|image|note|palette|name|board)=/i.test(s) ? parseMakeFragment(s) : parseMakeText(s);
}

// ── Writing one ─────────────────────────────────────────────────────────────

// Text in a link: encodeURIComponent's, with commas and colons left as they
// are (a fragment carries them, and they keep a link readable).
const enc = (s) => encodeURIComponent(String(s ?? '')).replace(/%2C/gi, ',').replace(/%3A/gi, ':');
// An address in a link: as it is, but for the characters the link's grammar
// uses (| & # =).
const encAddress = (u) => String(u).replace(/[|&#=]/g, (c) => encodeURIComponent(c));

/**
 * The /make link for a board in parseMakeFragment's shape (docs and tests;
 * an AI writes its own). `origin` is the site's.
 */
export function makeLinkFor(board, origin = 'https://clusters.soleilpictures.com') {
  const parts = [];
  if (board.title) parts.push(`title=${enc(board.title)}`);
  let n = 0;
  for (const s of board.sections || []) {
    if (s.name) parts.push(`section=${enc(s.name)}${s.color ? `|${enc(s.color)}` : ''}`);
    for (const it of s.items || []) {
      n += 1;
      if (it.kind === 'picture') {
        parts.push(`pic=${encAddress(it.url)}${it.caption ? `|${enc(it.caption)}` : ''}`);
      } else if (it.kind === 'note') {
        parts.push(`note=${it.title ? `${enc(it.title)}|` : ''}${enc(it.body || '')}`);
      } else if (it.kind === 'palette') {
        const sw = it.swatches.map((x) => `${x.hex}${x.name ? ` ${x.name}` : ''}`).join(',');
        parts.push(`palette=${it.title ? `${enc(it.title)}|` : ''}${enc(sw)}`);
      }
    }
  }
  parts.push(`end=${n}`);
  return `${origin}${MAKE_PATH}#${parts.join('&')}`;
}
