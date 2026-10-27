// Quick look's pages for the files a browser can read: text and code with
// their line numbers, Markdown set as a document, a table under its header
// row, subtitles as their cues, and a font as a page to try it on. Up to
// TEXT_STAGE_MAX_BYTES of a text file; past that, the page says so and the
// whole file is one click away. White in both themes, as a PDF's pages are.
// Lazy, like FamilyFace (whose reads, Markdown and fonts it shares): Quick
// look loads it for the first such file it shows.

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useHeadText, markdownHtml, useFont, fontName, FONT_SAMPLE } from '../cards/FamilyFace.jsx';
import { humanSize } from '../cards/FileCard.jsx';
import { headLines, parseCues, stageTable } from '../../lib/textPages.js';
import { TEXT_STAGE_MAX_BYTES, TABLE_STAGE_MAX_ROWS, TABLE_STAGE_MAX_CELLS } from '../../lib/fileFaceLimits.js';
import { Icon } from '../Icon.jsx';
import { Info, Download } from '../../lib/icons.js';
import './fileStages.css';

const CAP = `${TEXT_STAGE_MAX_BYTES / (1024 * 1024)} MB`;

function CutNotice({ sizeBytes, onDownload }) {
  return (
    <div className="fst-top" role="status">
      <Icon as={Info} size={16} />
      <span className="fst-grow">Showing the first {CAP}{sizeBytes ? ` of ${humanSize(sizeBytes)}` : ''}.</span>
      {onDownload && (
        <button type="button" className="fst-btn" onClick={onDownload}>
          <Icon as={Download} size={14} />Download all of it
        </button>
      )}
    </div>
  );
}

// The page scrolls inside itself and takes the keyboard when it opens, so
// ↑/↓ and Page Up/Down read on (←/→ stay Quick look's, stepping between
// files, and Space still closes); when it goes, Quick look has it back.
function Sheet({ kind, top = null, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    const room = el?.closest('.ql');
    if (!el || !room) return undefined;
    if (document.activeElement === room) el.focus({ preventScroll: true });
    return () => { if (document.activeElement === el) room.focus({ preventScroll: true }); };
  }, []);
  return (
    <div className={`qpage fst-${kind}`}>
      {top}
      <div ref={ref} className="fst-body" tabIndex={-1}>{children}</div>
    </div>
  );
}

const cut = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);

// The lines as the file has them, with their numbers in the margin. A file
// that is one long line or a few (minified JSON) wraps instead, without
// numbers, or the page would be one line wider than any screen.
function TextStage({ got, top }) {
  const lines = headLines(got.text, { complete: got.complete });
  const wrap = lines.length <= 3 && lines.some((l) => l.length > 1000);
  return (
    <Sheet kind="text" top={top}>
      {wrap ? <pre className="fst-lines is-wrapped">{lines.join('\n')}</pre> : (
        <div className="fst-numbered">
          <pre className="fst-gutter" aria-hidden="true">{lines.map((_, i) => i + 1).join('\n')}</pre>
          <pre className="fst-lines">{lines.join('\n')}</pre>
        </div>
      )}
    </Sheet>
  );
}

function MarkdownStage({ got, top }) {
  const [html, setHtml] = useState(null);
  const ref = useRef(null);
  useEffect(() => {
    let live = true;
    markdownHtml(got.text).then((h) => { if (live) setHtml(h); }, () => { if (live) setHtml(''); });
    return () => { live = false; };
  }, [got.text]);
  // A link opens beside Clusters, never in its place. Set on the page, not
  // in DOMPurify: its hooks are global, and the cards share it.
  useLayoutEffect(() => {
    for (const a of ref.current?.querySelectorAll('a[href]') || []) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
  }, [html]);
  return (
    <Sheet kind="md" top={top}>
      {html != null && <div ref={ref} className="fpg-md fst-md-body" dangerouslySetInnerHTML={{ __html: html }} />}
    </Sheet>
  );
}

function TableStage({ got, ext }) {
  const { head, body, cols, more } = stageTable(got.text, {
    ext, complete: got.complete, maxRows: TABLE_STAGE_MAX_ROWS, maxCells: TABLE_STAGE_MAX_CELLS,
  });
  const cells = (r) => Array.from({ length: cols }, (_, i) => cut(r[i] ?? '', 400));
  const n = body.length.toLocaleString('en-US');
  const count = `${more ? `First ${n} rows` : `${n} ${body.length === 1 ? 'row' : 'rows'}`} · ${cols} ${cols === 1 ? 'column' : 'columns'}`;
  return (
    <Sheet kind="table" top={<div className="fst-count">{count}</div>}>
      <table>
        <thead><tr><th className="n" />{cells(head).map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
        <tbody>{body.map((r, j) => <tr key={j}><td className="n">{j + 1}</td>{cells(r).map((c, i) => <td key={i}>{c}</td>)}</tr>)}</tbody>
      </table>
    </Sheet>
  );
}

function CuesStage({ got, top }) {
  return (
    <Sheet kind="cues" top={top}>
      {parseCues(got.text).map((c, i) => (
        <div className="fpg-cue" key={i}>
          <div className="fpg-cue-n">{c.n}</div>
          <div className="fpg-cue-tc">{c.start} → {c.end}</div>
          <div className="fpg-cue-t">{c.text}</div>
        </div>
      ))}
    </Sheet>
  );
}

const TEXT_STAGES = { markdown: MarkdownStage, table: TableStage, subtitles: CuesStage, text: TextStage, code: TextStage };

const WATERFALL = [12, 16, 24, 36, 48];
const GLYPHS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789&?!@'];

// A font, to try on: its name in itself and what the file says it is, a
// line to type into at any size from 12 to 160 px, that line at five sizes,
// and its letters and numbers. Typing is the field's (Quick look leaves
// keys in a field alone, Escape apart), so Space types a space there.
function FontStage({ font, sizeBytes }) {
  const { cssFamily, info } = font;
  const face = { fontFamily: `${cssFamily}, var(--font-sans)` };
  const [text, setText] = useState(FONT_SAMPLE);
  // A phone starts smaller, so a word fits across it.
  const [px, setPx] = useState(() => (window.innerWidth <= 720 ? 40 : 66));
  const field = useRef(null);
  const id = useId();
  // The field grows with what's typed, as a line of type does.
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text, px]);
  const sample = text.trim() ? text : FONT_SAMPLE;
  const facts = [
    ['Style', [info.style, info.weight].filter(Boolean).join(', ')],
    ['Format', [info.format, sizeBytes ? humanSize(sizeBytes) : ''].filter(Boolean).join(' · ')],
    ['Licence', info.license],
  ].filter(([, v]) => v);
  return (
    <Sheet kind="font">
      <div className="fst-font-hd">
        <div className="fst-font-fam" style={face}>{fontName(info)}</div>
        <dl className="fst-font-facts">{facts.map(([k, v]) => [<dt key={`k${k}`}>{k}</dt>, <dd key={`v${k}`}>{v}</dd>])}</dl>
      </div>
      <div className="fst-font-try">
        <div className="fst-font-lab">
          <label htmlFor={id}>Type to try it</label>
          <span className="fst-font-size">
            <input type="range" min="12" max="160" value={px} aria-label="Size" onChange={(e) => setPx(Number(e.target.value))} />
            <output>{px} px</output>
          </span>
        </div>
        <textarea id={id} ref={field} className="fst-font-field" rows={1} spellCheck={false}
                  style={{ ...face, fontSize: px }} value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <div className="fst-font-fall">
        {WATERFALL.map((n) => (
          <div key={n} style={{ fontSize: n, lineHeight: `${Math.round(n * 1.25)}px` }}><i>{n}</i><span style={face}>{sample}</span></div>
        ))}
      </div>
      <div className="fst-font-glyphs" style={face}>{GLYPHS.map((c) => <span key={c}>{c}</span>)}</div>
    </Sheet>
  );
}

function FontFamily({ item, fallback }) {
  const p = item.preview || {};
  const sizeBytes = item.sizeBytes ?? item.card?.sizeBytes ?? null;
  const font = useFont(p.src, sizeBytes, item.card?.fileName || item.name || '');
  // Too big, broken, or refused: Quick look's own card.
  if (font === null) return fallback;
  if (font === undefined) return <div className="qpage fst-font" aria-busy="true" />;
  return <FontStage font={font} sizeBytes={sizeBytes} />;
}

function TextFamily({ family, item, onDownload, fallback }) {
  const p = item.preview || {};
  const sizeBytes = item.sizeBytes ?? item.card?.sizeBytes ?? null;
  const got = useHeadText(p.src, TEXT_STAGE_MAX_BYTES, sizeBytes);
  // Not text after all (a .txt full of NULs): Quick look's own card.
  if (got === null) return fallback;
  if (got === undefined) return <div className={`qpage fst-${family === 'table' ? 'table' : 'text'}`} aria-busy="true" />;
  const Stage = TEXT_STAGES[family];
  const top = got.complete ? null : <CutNotice sizeBytes={sizeBytes} onDownload={onDownload ? () => onDownload(item) : null} />;
  return <Stage got={got} ext={p.ext} top={top} />;
}

export default function FileStage(props) {
  if (props.family === 'font') return <FontFamily {...props} />;
  if (TEXT_STAGES[props.family]) return <TextFamily {...props} />;
  return props.fallback;
}
