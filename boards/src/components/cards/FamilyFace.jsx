// A file's first page, drawn from what the file says: Markdown set as a
// document, a table under its header row, subtitle cues, text and code as
// the file has them, a font as a specimen of itself, and an email as a
// letter. Lazy (FileCard and
// CardPreview import it on demand), so a board with no such files never
// loads it. The page is drawn at a fixed width and scaled to its box, as the
// converter's pictures of a document's page are, so a small card shows the
// same page smaller. A text file costs at most CARD_HEAD_BYTES however big
// it is; a font is read whole (lib/fontLoad.js), and so is an email up to
// MAIL_CARD_MAX_BYTES (its reader, lib/mailRead.js, loads with the first).

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { resolveSrc } from '../../lib/r2.js';
import { readHead, decodeText } from '../../lib/fileHead.js';
import { headLines, sniffSep, parseDelimited, parseCues } from '../../lib/textPages.js';
import { CARD_HEAD_BYTES, MAIL_CARD_MAX_BYTES, MAIL_HEAD_BYTES } from '../../lib/fileFaceLimits.js';
import { loadFontFile } from '../../lib/fontLoad.js';
import { Icon } from '../Icon.jsx';
import { humanSize } from './FileCard.jsx';
import {
  FileMd, FileTxt, FileCsv, Subtitles, CodeIcon, Type, EnvelopeSimple, FileImage, FilePdf, FileIcon, SketchLogo, FigmaLogo,
  PaintBrush, PenNib,
} from '../../lib/icons.js';
import './familyFace.css';

const GLYPHS = { markdown: FileMd, text: FileTxt, table: FileCsv, subtitles: Subtitles, code: CodeIcon, font: Type, mail: EnvelopeSimple };
// A design file's: its app's, a brush for the painting apps', a pen nib for
// the rest.
const DESIGN_GLYPHS = { sketch: SketchLogo, fig: FigmaLogo, procreate: PaintBrush, procreat: PaintBrush, kra: PaintBrush, ora: PaintBrush, afphoto: PaintBrush };
// The strip's icon for a family the card draws, or a design file's.
export function familyGlyph(family, ext) {
  if (family === 'design') return DESIGN_GLYPHS[String(ext || '').toLowerCase()] || PenNib;
  return GLYPHS[family] || null;
}

const PAGE_W = { table: 640, font: 640 };
const PAD = { markdown: '46px 48px', text: '36px 34px', code: '36px 34px', subtitles: '38px 44px', table: '34px 36px', font: 0, mail: '44px 46px' };

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

// A font loaded to draw in: { cssFamily, info } once loaded; null when it's
// too big, broken or refused; undefined while it loads.
export function useFont(src, sizeBytes, fileName) {
  const [got, setGot] = useState({ src: '', value: undefined });
  useEffect(() => {
    if (!src) return undefined;
    let live = true;
    loadFontFile(src, { sizeBytes, fileName }).then((r) => { if (live) setGot({ src, value: r }); });
    return () => { live = false; };
  }, [src, sizeBytes, fileName]);
  return got.src === src ? got.value : undefined;
}

// A face's full name: "Fraunces Black", or "Fraunces" for its Regular.
export const fontName = (info) => (info.style && !/^regular$/i.test(info.style) ? `${info.family} ${info.style}` : info.family);

// An email's letter, as its card shows it (lib/mailRead.js letterCard):
// read whole up to MAIL_CARD_MAX_BYTES, and past that its first
// MAIL_HEAD_BYTES, where a MIME message's headers and first lines are; an
// Outlook message's parts can sit anywhere in it, so only a whole one reads.
// A file that isn't a letter is remembered as such; a read that failed is
// not, so the next mount tries again.
const letters = new Map();
function letterOf(src, sizeBytes) {
  const known = letters.get(src);
  if (known) { letters.delete(src); letters.set(src, known); return known; }
  const max = Number(sizeBytes) > MAIL_CARD_MAX_BYTES ? MAIL_HEAD_BYTES : MAIL_CARD_MAX_BYTES;
  const p = Promise.all([import('../../lib/mailRead.js'), resolveSrc(src)])
    .then(async ([mail, url]) => {
      if (!url) return null;
      const r = await readHead(url, max, { size: sizeBytes ?? undefined });
      if (!r.complete && mail.isCfb(r.bytes)) return { letter: null };
      try {
        return { letter: mail.letterCard(await mail.readMail(r.bytes), { complete: r.complete }) };
      } catch {
        return { letter: null };
      }
    })
    .catch(() => null)
    .then((r) => { if (!r) letters.delete(src); return r ? r.letter : null; });
  letters.set(src, p);
  while (letters.size > 96) letters.delete(letters.keys().next().value);
  return p;
}

function useLetter(src, sizeBytes) {
  const [got, setGot] = useState({ src: '', value: undefined });
  useEffect(() => {
    if (!src) return undefined;
    let live = true;
    letterOf(src, sizeBytes).then((r) => { if (live) setGot({ src, value: r }); });
    return () => { live = false; };
  }, [src, sizeBytes]);
  return got.src === src ? got.value : undefined;
}

// Who a letter is from ("Iris Chen <iris@…>"), who it's to (the first three
// and how many more), and when, as the reader's clock has it.
export const mailFrom = (p) => (p ? (p.name && p.address ? `${p.name} <${p.address}>` : p.name || p.address) : '');
export function mailPeople(list, max = 3) {
  const names = (list || []).map((p) => p.name || p.address);
  return names.length > max ? `${names.slice(0, max).join(', ')} and ${names.length - max} more` : names.join(', ');
}
export function mailWhen(iso) {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime())
    ? d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '';
}
// An attachment's icon by its type.
export const attachmentGlyph = (mime) => (/^image\//i.test(mime) ? FileImage : /pdf$/i.test(mime) ? FilePdf : FileIcon);

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

// The specimen's line (the owner's pick, direction A), which Quick look's
// page to try a font on starts from too.
export const FONT_SAMPLE = 'The lake keeps everything';

// Aa in the font, its name, style and format, a sample line and its
// alphabet, every sample in the face itself (its own weight, so normal).
function SpecimenPage({ font }) {
  const { cssFamily, info } = font;
  const face = { fontFamily: `${cssFamily}, var(--font-sans)` };
  return (
    <div className="fpg-spec">
      <div className="fpg-spec-aa" style={face}>Aa</div>
      <div className="fpg-spec-side">
        <div className="fpg-spec-fam" style={face}>{fontName(info)}</div>
        <div className="fpg-spec-sty">{[info.style, info.format].filter(Boolean).join(' · ')}</div>
        <div className="fpg-spec-smp" style={face}>{FONT_SAMPLE}</div>
      </div>
      <div className="fpg-spec-abc" style={face}>ABCDEFGHIJKLM abcdefghijklm 0123456789</div>
    </div>
  );
}

// The letter: its subject, who it's from and to and when, its first lines,
// and its attachments' names.
function LetterPage({ letter }) {
  const rows = [['From', mailFrom(letter.from)], ['To', mailPeople(letter.to)], ['Date', mailWhen(letter.date)]].filter(([, v]) => v);
  return (
    <div className="fpg-mail">
      <div className="fpg-mail-subj">{letter.subject || 'No subject'}</div>
      {rows.length > 0 && (
        <div className="fpg-mail-hdr">{rows.map(([k, v]) => [<span key={`k${k}`} className="fpg-mail-k">{k}</span>, <span key={`v${k}`}>{v}</span>])}</div>
      )}
      <div className="fpg-mail-rule" />
      {letter.paragraphs.map((t, i) => <p key={i}>{cut(t, 600)}</p>)}
      {letter.attachments?.length > 0 && (
        <div className="fpg-mail-att">
          {letter.attachments.slice(0, 6).map((a, i) => (
            <span className="fpg-mail-chip" key={i}>
              <Icon as={attachmentGlyph(a.mimeType)} size={15} />{a.filename} <span>{humanSize(a.size)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
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

// The page at its design width, scaled to its box; white and empty until
// there's something on it.
function Page({ family, w, h, children }) {
  const [ref, box] = useBox(w, h);
  const vw = PAGE_W[family] || 520;
  const scale = box ? box.w / vw : 0;
  return (
    <div ref={ref} className="fpg" data-family={family} aria-hidden="true">
      {box && children && (
        <div className="fpg-sheet"
             style={{ width: vw, height: Math.ceil(box.h / scale), transform: `scale(${scale})`, padding: PAD[family], '--fpg-scale': scale }}>
          {children}
        </div>
      )}
    </div>
  );
}

function TextFace({ family, src, ext, sizeBytes, w, h, fallback }) {
  const got = useHeadText(src, CARD_HEAD_BYTES, sizeBytes);
  if (got === null) return fallback;
  return (
    <Page family={family} w={w} h={h}>
      {got && (
        family === 'markdown' ? <MarkdownPage text={got.text} />
          : family === 'table' ? <TablePage text={got.text} ext={ext} complete={got.complete} />
            : family === 'subtitles' ? <CuesPage text={got.text} />
              : <LinesPage text={got.text} complete={got.complete} />
      )}
    </Page>
  );
}

function SpecimenFace({ src, sizeBytes, name, w, h, fallback }) {
  const font = useFont(src, sizeBytes, name);
  if (font === null) return fallback;
  return <Page family="font" w={w} h={h}>{font && <SpecimenPage font={font} />}</Page>;
}

// An email's card: the letter, and how many attachments it has for the
// card's strip (onMeta), once that's known.
function LetterFace({ src, sizeBytes, w, h, fallback, onMeta }) {
  const letter = useLetter(src, sizeBytes);
  const n = letter?.attachments?.length || 0;
  useEffect(() => {
    if (!onMeta) return undefined;
    onMeta(n ? `${n} ${n === 1 ? 'attachment' : 'attachments'}` : null);
    return () => onMeta(null);
  }, [n, onMeta]);
  if (letter === null) return fallback;
  return <Page family="mail" w={w} h={h}>{letter && <LetterPage letter={letter} />}</Page>;
}

const FACES = { font: SpecimenFace, mail: LetterFace };

export default function FamilyFace({ family, src, ext = '', name = '', sizeBytes = null, w = 0, h = 0, fallback = null, onMeta = null }) {
  const Face = FACES[family] || TextFace;
  return <Face family={family} src={src} ext={ext} name={name} sizeBytes={sizeBytes} w={w} h={h} fallback={fallback} onMeta={onMeta} />;
}
