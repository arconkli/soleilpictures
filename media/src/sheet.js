// An archive's card as SVG, at 4x the card's size so it renders (vips) to the
// same view a photo gets. Pure: the caller hands in the tiles (archiveSheet.js)
// and the thumbnails it made, as data URLs. No links, no script, no fonts
// fetched; every name is escaped.
import { SHEET_ICONS } from './sheetIcons.js';

const FONT = 'Noto Sans, DejaVu Sans, sans-serif';
const PAPER = '#f1f1f4';
const INK = '#3a3a40';
const MUTED = '#8a8a90';
const GLYPH = '#5a5a62';

export const SHEET_W = 1440;
export const SHEET_H = 880;
export const LIST_W = 960;
export const LIST_H = 660;

// XML-escape, and drop the control characters XML can't hold.
export function esc(s) {
  return String(s ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Cut to what fits `em` ems of the sans font, ending in an ellipsis: a wide
// letter (CJK, fullwidth) counts a whole em, a capital or a digit two thirds,
// any other a little over half, and the ellipsis an em. Generous, so a name
// centred in its tile never runs past it.
const emOf = (c) => (c.codePointAt(0) >= 0x2e80 ? 1 : /[A-Z0-9@%&]/.test(c) ? 0.68 : 0.56);
export function fitText(s, em) {
  const chars = [...String(s ?? '').replace(/[\u0000-\u001F\u007F]/g, '')];
  let used = 0;
  for (const c of chars) used += emOf(c);
  if (used <= em) return chars.join('');
  const kept = [];
  used = 1;
  for (const c of chars) {
    if (used + emOf(c) > em) break;
    kept.push(c);
    used += emOf(c);
  }
  return `${(kept.length ? kept : chars.slice(0, 1)).join('').trimEnd()}…`;
}

const ICON_BY_EXT = {
  pdf: 'FilePdf',
  txt: 'FileText', md: 'FileText', rtf: 'FileText', doc: 'FileText', docx: 'FileText', odt: 'FileText',
  jpg: 'FileImage', jpeg: 'FileImage', png: 'FileImage', gif: 'FileImage', webp: 'FileImage', svg: 'FileImage', tif: 'FileImage', tiff: 'FileImage', heic: 'FileImage', psd: 'FileImage',
  mp4: 'FileVideo', mov: 'FileVideo', m4v: 'FileVideo', webm: 'FileVideo', mkv: 'FileVideo', avi: 'FileVideo',
  mp3: 'FileAudio', wav: 'FileAudio', m4a: 'FileAudio', flac: 'FileAudio', aac: 'FileAudio', ogg: 'FileAudio', aif: 'FileAudio', aiff: 'FileAudio',
  zip: 'FileZip', '7z': 'FileZip', rar: 'FileZip', tar: 'FileZip', gz: 'FileZip', tgz: 'FileZip', bz2: 'FileZip', xz: 'FileZip',
  js: 'FileCode', mjs: 'FileCode', ts: 'FileCode', jsx: 'FileCode', json: 'FileCode', html: 'FileCode', css: 'FileCode', py: 'FileCode', sh: 'FileCode', xml: 'FileCode',
};

export function iconFor(kind, ext) {
  if (kind === 'folder') return 'FolderSimple';
  return ICON_BY_EXT[String(ext || '').toLowerCase()] || 'File';
}

// A Phosphor glyph (256 box) at `size`, with its top-left at x, y.
function glyph(name, x, y, size) {
  const paths = (SHEET_ICONS[name] || SHEET_ICONS.File).map((d) => `<path d="${d}"/>`).join('');
  return `<g transform="translate(${x} ${y}) scale(${size / 256})" fill="${GLYPH}">${paths}</g>`;
}

// A rounded rectangle as a path (the clip, so the only <rect>s are the tiles).
function roundedPath(x, y, w, h, r) {
  return `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
}

// Four tiles across and three down, as the card shows them (360 x 220):
// they stop at 727, so the card's name strip, over the sheet's foot, covers
// nothing.
const PAD = 48;
const COLS = 4;
const GAP = 20;
const TILE_W = 321;
const TILE_H = 213;
const RADIUS = 8;
const NAME_EM = (TILE_W - 40) / 30;
// A tile's size on the sheet, which its thumbnail is made at (view.js).
export const SHEET_TILE = Object.freeze({ w: TILE_W, h: TILE_H });

const items = (n) => `${n} ${n === 1 ? 'item' : 'items'}`;

// A photo is its picture, edge to edge. A folder is its glyph, its name and
// how many things are in it; a file (or a photo that wouldn't thumbnail) its
// glyph and its name; both on a grey tile, centred.
export function sheetSvg(tiles, thumbs = new Map()) {
  const out = [];
  let clips = '';
  tiles.forEach((t, i) => {
    const x = PAD + (i % COLS) * (TILE_W + GAP);
    const y = PAD + Math.floor(i / COLS) * (TILE_H + GAP);
    const cx = x + TILE_W / 2;
    out.push(`<rect x="${x}" y="${y}" width="${TILE_W}" height="${TILE_H}" rx="${RADIUS}" fill="${PAPER}"/>`);
    const thumb = t.kind === 'photo' ? thumbs.get(t.path) : null;
    if (thumb) {
      clips += `<clipPath id="c${i}"><path d="${roundedPath(x, y, TILE_W, TILE_H, RADIUS)}"/></clipPath>`;
      out.push(`<image x="${x}" y="${y}" width="${TILE_W}" height="${TILE_H}" preserveAspectRatio="xMidYMid slice" clip-path="url(#c${i})" href="${esc(thumb)}"/>`);
      return;
    }
    const folder = t.kind === 'folder';
    const count = folder && Number.isInteger(t.count) && t.count >= 0 ? items(t.count) : '';
    const top = count ? y + 42 : y + 54;
    out.push(glyph(iconFor(t.kind, t.ext), cx - 26, top, 52));
    // Clipped to the tile, should a name's letters still run wider than counted.
    clips += `<clipPath id="n${i}"><path d="M${x + 12} ${y}H${x + TILE_W - 12}V${y + TILE_H}H${x + 12}Z"/></clipPath>`;
    out.push(`<text x="${cx}" y="${top + 92}" text-anchor="middle" clip-path="url(#n${i})" font-family="${FONT}" font-size="30" font-weight="600" fill="${INK}">${esc(fitText(t.name, NAME_EM))}</text>`);
    if (count) out.push(`<text x="${cx}" y="${top + 130}" text-anchor="middle" font-family="${FONT}" font-size="25" fill="${MUTED}">${count}</text>`);
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${SHEET_W}" height="${SHEET_H}" viewBox="0 0 ${SHEET_W} ${SHEET_H}"><defs>${clips}</defs><path d="M0 0H${SHEET_W}V${SHEET_H}H0Z" fill="#ffffff"/>${out.join('')}</svg>`;
}

// A size as the app writes one (FileCard.jsx humanSize).
function sizeText(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let u = 0;
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024;
    u++;
  }
  return `${n >= 10 || u === 0 ? Math.round(n) : n.toFixed(1)} ${units[u]}`;
}

// Six rows, each under a hairline's rule, ending at 540: the card's name
// strip covers the foot, and says how many files there are in all.
const ROW_H = 82;
const LIST_PAD_X = 60;
const LIST_TOP = 48;
const RULE = '#ececef';

// The names at an archive's top, a folder's with how many things are in it,
// a file's with its size.
export function listSvg(rows) {
  const out = [];
  let clips = '';
  rows.forEach((r, i) => {
    const y = LIST_TOP + i * ROW_H;
    const mid = y + ROW_H / 2;
    out.push(glyph(iconFor(r.kind, String(r.name).split('.').pop()), LIST_PAD_X, mid - 18, 36));
    const meta = r.kind === 'folder' ? (Number.isInteger(r.count) && r.count >= 0 ? items(r.count) : '') : sizeText(r.size);
    // The name stops short of its size, however wide its letters.
    const nameX = LIST_PAD_X + 58;
    const nameEnd = LIST_W - LIST_PAD_X - (meta ? 150 : 0);
    clips += `<clipPath id="r${i}"><path d="M${nameX} ${y}H${nameEnd}V${y + ROW_H}H${nameX}Z"/></clipPath>`;
    out.push(`<text x="${nameX}" y="${mid + 11}" clip-path="url(#r${i})" font-family="${FONT}" font-size="31" fill="${INK}">${esc(fitText(r.name, (nameEnd - nameX) / 31))}</text>`);
    if (meta) out.push(`<text x="${LIST_W - LIST_PAD_X}" y="${mid + 9}" text-anchor="end" font-family="${FONT}" font-size="25" fill="${MUTED}">${esc(meta)}</text>`);
    out.push(`<path d="M${LIST_PAD_X} ${y + ROW_H - 1.5}H${LIST_W - LIST_PAD_X}" stroke="${RULE}" stroke-width="3"/>`);
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${LIST_W}" height="${LIST_H}" viewBox="0 0 ${LIST_W} ${LIST_H}"><defs>${clips}</defs><path d="M0 0H${LIST_W}V${LIST_H}H0Z" fill="#ffffff"/>${out.join('')}</svg>`;
}
