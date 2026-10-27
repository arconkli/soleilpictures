// Quick look's pages for the files a browser can read: text and code with
// their line numbers, Markdown set as a document, a table under its header
// row, subtitles as their cues. Up to TEXT_STAGE_MAX_BYTES of a file; past
// that, the page says so and the whole file is one click away. White in both
// themes, as a PDF's pages are. Lazy, like FamilyFace (whose reads and
// Markdown it shares): Quick look loads it for the first such file it shows.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useHeadText, markdownHtml } from '../cards/FamilyFace.jsx';
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
  if (TEXT_STAGES[props.family]) return <TextFamily {...props} />;
  return props.fallback;
}
