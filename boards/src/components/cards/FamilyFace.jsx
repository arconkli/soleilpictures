// A file's first page, drawn from what the file says: Markdown set as a
// document, a table under its header row, subtitle cues, text and code as
// the file has them. Lazy (FileCard and CardPreview import it on demand), so
// a board with no such files never loads it. The page is drawn at a fixed
// width and scaled to its box, as the converter's pictures of a document's
// page are, so a small card shows the same page smaller. It reads at most
// CARD_HEAD_BYTES of the file, however big the file is.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { resolveSrc } from '../../lib/r2.js';
import { readHead, decodeText } from '../../lib/fileHead.js';
import { headLines, sniffSep, parseDelimited, parseCues } from '../../lib/textPages.js';
import { CARD_HEAD_BYTES } from '../../lib/fileFaceLimits.js';
import { FileMd, FileTxt, FileCsv, Subtitles, CodeIcon } from '../../lib/icons.js';
import './familyFace.css';

const GLYPHS = { markdown: FileMd, text: FileTxt, table: FileCsv, subtitles: Subtitles, code: CodeIcon };
// The strip's icon for a family the card draws.
export function familyGlyph(family, ext) { return GLYPHS[family] || null; }

const PAGE_W = { table: 640 };
const PAD = { markdown: '46px 48px', text: '36px 34px', code: '36px 34px', subtitles: '38px 44px', table: '34px 36px' };

// One read per file and ceiling, however many cards and tiles show it. A
// file that isn't text is remembered as such; a read that failed is not,
// so the next mount tries again. Quick look reads up to megabytes, so only
// its last few are kept, and a file a card read whole (or found isn't text)
// costs Quick look nothing.
const heads = new Map();
const pages = new Map();
function headOf(src, max, sizeBytes) {
  const key = `${max}:${src}`;
  const big = max > CARD_HEAD_BYTES;
  const reads = big ? pages : heads;
  const known = reads.get(key);
  if (known) { reads.delete(key); reads.set(key, known); return known; }
  const read = () => resolveSrc(src)
    .then((url) => (url ? readHead(url, max, { size: sizeBytes ?? undefined }) : null))
    .then((r) => (r ? { text: decodeText(r.bytes, { complete: r.complete }), complete: r.complete } : null));
  const card = big ? heads.get(`${CARD_HEAD_BYTES}:${src}`) : null;
  const p = (card || Promise.resolve(null))
    .then((r) => (r && (r.complete || r.text == null) ? r : read()))
    .catch(() => null)
    .then((r) => { if (!r) reads.delete(key); return r; });
  reads.set(key, p);
  while (reads.size > (big ? 4 : 96)) reads.delete(reads.keys().next().value);
  return p;
}

// { text, complete } once read; null when the file isn't text or can't be
// read; undefined while it's being read.
export function useHeadText(src, max, sizeBytes) {
  const key = `${max}:${src}`;
  const [got, setGot] = useState({ key: '', value: undefined });
  useEffect(() => {
    if (!src) return undefined;
    let live = true;
    headOf(src, max, sizeBytes).then((r) => {
      if (live) setGot({ key, value: r && r.text != null ? r : null });
    });
    return () => { live = false; };
  }, [key, src, max, sizeBytes]);
  return got.key === key ? got.value : undefined;
}

// Markdown to HTML with no raw HTML in it, and nothing that loads or styles:
// no pictures, media, frames, forms or style attributes.
let toHtml = null;
export async function markdownHtml(text) {
  if (!toHtml) {
    const [{ default: MarkdownIt }, { default: DOMPurify }] = await Promise.all([import('markdown-it'), import('dompurify')]);
    const md = new MarkdownIt({ html: false, linkify: false });
    toHtml = (t) => DOMPurify.sanitize(md.render(t), {
      FORBID_TAGS: ['img', 'video', 'audio', 'source', 'picture', 'iframe', 'form', 'style', 'svg', 'math', 'input', 'button'],
      FORBID_ATTR: ['style'],
    });
  }
  return toHtml(text);
}

function MarkdownPage({ text }) {
  const [html, setHtml] = useState(null);
  useEffect(() => {
    let live = true;
    markdownHtml(text).then((h) => { if (live) setHtml(h); }, () => { if (live) setHtml(''); });
    return () => { live = false; };
  }, [text]);
  return html == null ? null : <div className="fpg-md" dangerouslySetInnerHTML={{ __html: html }} />;
}

const cut = (s, n) => (s.length > n ? s.slice(0, n) : s);

function TablePage({ text, ext, complete }) {
  const { rows } = parseDelimited(text, { sep: sniffSep(text, ext), maxRows: 40, complete });
  const [head = [], ...body] = rows;
  const cols = Math.min(12, Math.max(head.length, ...body.map((r) => r.length)));
  const cells = (r) => Array.from({ length: cols }, (_, i) => cut(r[i] ?? '', 60));
  return (
    <table className="fpg-grid">
      <thead><tr>{cells(head).map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
      <tbody>{body.map((r, j) => <tr key={j}>{cells(r).map((c, i) => <td key={i}>{c}</td>)}</tr>)}</tbody>
    </table>
  );
}

function CuesPage({ text }) {
  return parseCues(text, { max: 12 }).map((c, i) => (
    <div className="fpg-cue" key={i}>
      <div className="fpg-cue-n">{c.n}</div>
      <div className="fpg-cue-tc">{c.start} → {c.end}</div>
      <div className="fpg-cue-t">{cut(c.text, 400)}</div>
    </div>
  ));
}

// The lines as the file has them, clipped at the page's edge, as a printed
// page of code is; a file that is one long line (minified JSON) wraps
// instead, or the page would be one clipped line.
function LinesPage({ text, complete }) {
  const lines = headLines(text, { max: 80, complete });
  const wrap = lines.length <= 3 && lines.some((l) => l.length > 160);
  const shown = wrap ? cut(lines.join('\n'), 4000) : lines.map((l) => cut(l, 300)).join('\n');
  return <pre className={`fpg-pre${wrap ? ' is-wrapped' : ''}`}>{shown}</pre>;
}

// The box the page is scaled into: the card's size when it's given, then
// whatever the page's own box measures (a tile, a card with a title under it).
function useBox(w, h) {
  const ref = useRef(null);
  const [box, setBox] = useState(w > 0 && h > 0 ? { w, h } : null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setBox((b) => (b && b.w === width && b.h === height ? b : { w: width, h: height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, box];
}

export default function FamilyFace({ family, src, ext = '', sizeBytes = null, w = 0, h = 0, fallback = null }) {
  const got = useHeadText(src, CARD_HEAD_BYTES, sizeBytes);
  const [ref, box] = useBox(w, h);
  if (got === null) return fallback;
  const vw = PAGE_W[family] || 520;
  const scale = box ? box.w / vw : 0;
  return (
    <div ref={ref} className="fpg" data-family={family} aria-hidden="true">
      {box && got && (
        <div className="fpg-sheet"
             style={{ width: vw, height: Math.ceil(box.h / scale), transform: `scale(${scale})`, padding: PAD[family] }}>
          {family === 'markdown' && <MarkdownPage text={got.text} />}
          {family === 'table' && <TablePage text={got.text} ext={ext} complete={got.complete} />}
          {family === 'subtitles' && <CuesPage text={got.text} />}
          {(family === 'text' || family === 'code') && <LinesPage text={got.text} complete={got.complete} />}
        </div>
      )}
    </div>
  );
}
