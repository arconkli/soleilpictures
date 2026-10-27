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

// Cut to a number of characters (code points), ending in an ellipsis.
export function ellipsize(s, max) {
  const chars = [...String(s ?? '').replace(/[\u0000-\u001F\u007F]/g, '')];
  return chars.length <= max ? chars.join('') : `${chars.slice(0, Math.max(1, max - 1)).join('')}…`;
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

const PAD_X = 52;
const PAD_Y = 48;
const COLS = 4;
const GAP = 20;
const TILE_W = 319;
const TILE_H = 213;
const ROW_PITCH = TILE_H + 48;
const NAME_CHARS = 22;
// A tile's size on the sheet, which its thumbnail is made at (view.js).
export const SHEET_TILE = Object.freeze({ w: TILE_W, h: TILE_H });

export function sheetSvg(tiles, thumbs = new Map()) {
  const out = [];
  let clips = '';
  tiles.forEach((t, i) => {
    const x = PAD_X + (i % COLS) * (TILE_W + GAP);
    const y = PAD_Y + Math.floor(i / COLS) * ROW_PITCH;
    out.push(`<rect x="${x}" y="${y}" width="${TILE_W}" height="${TILE_H}" rx="6" fill="${PAPER}"/>`);
    const thumb = t.kind === 'photo' ? thumbs.get(t.path) : null;
    if (thumb) {
      clips += `<clipPath id="c${i}"><path d="${roundedPath(x, y, TILE_W, TILE_H, 6)}"/></clipPath>`;
      out.push(`<image x="${x}" y="${y}" width="${TILE_W}" height="${TILE_H}" preserveAspectRatio="xMidYMid slice" clip-path="url(#c${i})" href="${esc(thumb)}"/>`);
    } else {
      out.push(glyph(iconFor(t.kind, t.ext), x + (TILE_W - 68) / 2, y + (TILE_H - 68) / 2, 68));
    }
    const count = t.kind === 'folder' && Number.isFinite(t.count) ? String(t.count) : '';
    const room = NAME_CHARS - (count ? count.length + 2 : 0);
    // Wide letters (CJK, W and M) run longer than the count of them says, so
    // the name is clipped to its tile's width, short of the count.
    const nameW = TILE_W - (count ? count.length * 15 + 12 : 0);
    clips += `<clipPath id="n${i}"><path d="M${x} ${y + TILE_H}H${x + nameW}V${y + TILE_H + 48}H${x}Z"/></clipPath>`;
    out.push(`<text x="${x}" y="${y + TILE_H + 32}" clip-path="url(#n${i})" font-family="${FONT}" font-size="26" font-weight="600" fill="${INK}">${esc(ellipsize(t.name, room))}</text>`);
    if (count) out.push(`<text x="${x + TILE_W}" y="${y + TILE_H + 32}" text-anchor="end" font-family="${FONT}" font-size="24" fill="${MUTED}">${count}</text>`);
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${SHEET_W}" height="${SHEET_H}" viewBox="0 0 ${SHEET_W} ${SHEET_H}"><defs>${clips}</defs><path d="M0 0H${SHEET_W}V${SHEET_H}H0Z" fill="#ffffff"/>${out.join('')}</svg>`;
}

function sizeText(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1000) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let n = bytes / 1000;
  let u = 0;
  while (n >= 1000 && u < units.length - 1) {
    n /= 1000;
    u++;
  }
  return `${n >= 100 || Number.isInteger(n) ? Math.round(n) : n.toFixed(1)} ${units[u]}`;
}

const ROW_H = 79;
const LIST_PAD_X = 48;
const LIST_PAD_Y = 40;

export function listSvg(rows, more = 0) {
  const out = [];
  let clips = '';
  rows.forEach((r, i) => {
    const y = LIST_PAD_Y + i * ROW_H;
    const mid = y + ROW_H / 2;
    out.push(glyph(iconFor(r.kind, String(r.name).split('.').pop()), LIST_PAD_X, mid - 20, 40));
    const size = r.kind === 'folder' ? '' : sizeText(r.size);
    // The name stops short of its size, however wide its letters.
    const nameEnd = LIST_W - LIST_PAD_X - (size ? 150 : 0);
    clips += `<clipPath id="r${i}"><path d="M${LIST_PAD_X + 64} ${y}H${nameEnd}V${y + ROW_H}H${LIST_PAD_X + 64}Z"/></clipPath>`;
    out.push(`<text x="${LIST_PAD_X + 64}" y="${mid + 10}" clip-path="url(#r${i})" font-family="${FONT}" font-size="30" fill="${INK}">${esc(ellipsize(r.name, size ? 26 : 38))}</text>`);
    if (size) out.push(`<text x="${LIST_W - LIST_PAD_X}" y="${mid + 9}" text-anchor="end" font-family="${FONT}" font-size="26" fill="${MUTED}">${esc(size)}</text>`);
  });
  if (more > 0) {
    const y = LIST_PAD_Y + rows.length * ROW_H;
    out.push(`<text x="${LIST_PAD_X + 64}" y="${y + ROW_H / 2 + 10}" font-family="${FONT}" font-size="30" fill="${MUTED}">and ${Math.floor(more)} more</text>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${LIST_W}" height="${LIST_H}" viewBox="0 0 ${LIST_W} ${LIST_H}"><defs>${clips}</defs><path d="M0 0H${LIST_W}V${LIST_H}H0Z" fill="#ffffff"/>${out.join('')}</svg>`;
}
