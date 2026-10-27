// Lines, tables and cues from the text of a file's head (lib/fileHead.js).
// When only a head was read (complete: false) a cut last line or row is
// dropped, never drawn half.

export function headLines(text, { max = Infinity, complete = true } = {}) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  if (lines.length > 1 && !complete) lines.pop();
  else if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.length > max ? lines.slice(0, max) : lines;
}

export function sniffSep(text, ext) {
  if (String(ext).toLowerCase() === 'tsv') return '\t';
  const first = String(text).split(/\r?\n/, 1)[0].replace(/"[^"]*"/g, '');
  const count = (ch) => first.split(ch).length - 1;
  const best = [',', ';', '\t'].reduce((a, b) => (count(b) > count(a) ? b : a));
  return count(best) ? best : ',';
}

// RFC 4180: a quoted field holds separators, newlines and doubled quotes.
export function parseDelimited(text, { sep = ',', maxRows = Infinity, complete = true } = {}) {
  const s = String(text);
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (ch === '"') { quoted = false; i += 1; continue; }
      field += ch; i += 1; continue;
    }
    if (ch === '"' && field === '') { quoted = true; i += 1; continue; }
    if (ch === sep) { row.push(field); field = ''; i += 1; continue; }
    if (ch === '\n' || ch === '\r') {
      i += ch === '\r' && s[i + 1] === '\n' ? 2 : 1;
      row.push(field); rows.push(row); row = []; field = '';
      if (rows.length >= maxRows) return { rows, more: !complete || /\S/.test(s.slice(i)) };
      continue;
    }
    field += ch; i += 1;
  }
  if (field !== '' || row.length) {
    if (complete) { row.push(field); rows.push(row); }
  }
  return { rows, more: !complete };
}

// Quick look's table: the header row, then up to maxRows rows, fewer for a
// wide table, so its page never holds more than maxCells cells (never fewer
// than 100 rows). `more` when the file goes on past the last row shown.
export function stageTable(text, { ext = '', complete = true, maxRows = Infinity, maxCells = Infinity } = {}) {
  const { rows, more } = parseDelimited(text, { sep: sniffSep(text, ext), maxRows: maxRows + 1, complete });
  const [head = [], ...body] = rows;
  let cols = head.length;
  for (const r of body) if (r.length > cols) cols = r.length;
  const fit = Math.max(100, Math.floor(maxCells / Math.max(1, cols)));
  return body.length > fit ? { head, body: body.slice(0, fit), cols, more: true } : { head, body, cols, more };
}

const TC = /((?:\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*((?:\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3})/;
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ', '&lrm;': '', '&rlm;': '', '&quot;': '"', '&#39;': "'" };

// SRT and WebVTT alike: a block is a cue when one of its lines is a timing
// line; the line above it (when there is one) is its number or id. WEBVTT,
// NOTE, STYLE and REGION blocks have no timing line and are skipped.
export function parseCues(text, { max = Infinity } = {}) {
  const blocks = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const at = lines.findIndex((l) => TC.test(l));
    if (at < 0) continue;
    const [, start, end] = lines[at].match(TC);
    const n = at > 0 && lines[at - 1].trim() ? lines[at - 1].trim() : String(cues.length + 1);
    const body = lines.slice(at + 1).join('\n')
      .replace(/<[^>]*>/g, '').replace(/\{\\[^}]*\}/g, '')
      .replace(/&(amp|lt|gt|nbsp|lrm|rlm|quot|#39);/g, (m) => ENTITIES[m])
      .trim();
    cues.push({ n, start, end, text: body });
    if (cues.length >= max) break;
  }
  return cues;
}
