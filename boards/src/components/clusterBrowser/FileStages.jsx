// Quick look's pages for the files a browser can read: text and code with
// their line numbers, Markdown set as a document, a table under its header
// row, subtitles as their cues, a font as a page to try it on, and an email
// as it was sent. Up to TEXT_STAGE_MAX_BYTES of a text file; past that, the
// page says so and the whole file is one click away. White in both themes,
// as a PDF's pages are. Lazy, like FamilyFace (whose reads, Markdown, fonts
// and letters it shares): Quick look loads it for the first such file it
// shows.

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import {
  useHeadText, markdownHtml, useFont, fontName, FONT_SAMPLE, mailPeople, mailWhen, attachmentGlyph,
} from '../cards/FamilyFace.jsx';
import { humanSize } from '../cards/FileCard.jsx';
import { useOptionalFeedback } from '../AppFeedback.jsx';
import { headLines, parseCues, stageTable } from '../../lib/textPages.js';
import { resolveSrc } from '../../lib/r2.js';
import { readHead } from '../../lib/fileHead.js';
import { deliverFile } from '../../lib/exportDelivery.js';
import { canPutFiles, putFiles } from '../../lib/fileActions.js';
import {
  TEXT_STAGE_MAX_BYTES, TABLE_STAGE_MAX_ROWS, TABLE_STAGE_MAX_CELLS, MAIL_MAX_BYTES,
} from '../../lib/fileFaceLimits.js';
import { Icon } from '../Icon.jsx';
import { Info, Download, EyeOff, BoundingBox } from '../../lib/icons.js';
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
function Sheet({ kind, top = null, className = '', children }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    const room = el?.closest('.ql');
    if (!el || !room) return undefined;
    if (document.activeElement === room) el.focus({ preventScroll: true });
    return () => { if (document.activeElement === el) room.focus({ preventScroll: true }); };
  }, []);
  return (
    <div className={`qpage fst-${kind}${className ? ` ${className}` : ''}`}>
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

// The whole message, up to MAIL_MAX_BYTES, as a letter with its
// attachments' bytes: { letter, mail } once read, { big: true } past the
// limit, null when it isn't a letter or can't be read, undefined while it's
// being read. Its reader (lib/mailRead.js) loads with it.
function useMail(src, sizeBytes) {
  const [got, setGot] = useState({ src: '', value: undefined });
  useEffect(() => {
    if (!src) return undefined;
    let live = true;
    const done = (value) => { if (live) setGot({ src, value }); };
    if (Number(sizeBytes) > MAIL_MAX_BYTES) done({ big: true });
    else {
      Promise.all([import('../../lib/mailRead.js'), resolveSrc(src)])
        .then(async ([mail, url]) => {
          if (!url) return null;
          const r = await readHead(url, MAIL_MAX_BYTES, { size: sizeBytes ?? undefined });
          if (!r.complete) return { big: true };
          const letter = await mail.readMail(r.bytes);
          return mail.letterCard(letter) ? { letter, mail } : null;
        })
        .catch(() => null)
        .then(done);
    }
    return () => { live = false; };
  }, [src, sizeBytes]);
  return got.src === src ? got.value : undefined;
}

// An email's HTML as it can be shown: nothing in it that runs, submits or
// loads a page of its own (DOMPurify takes scripts, forms, frames and
// embeds), its links opening beside Clusters, and the pictures it carries
// inside the message (cid:) as data, up to INLINE_BUDGET of them. It still
// names pictures on the web; the frame's policy keeps them from loading
// until Show pictures, and hasRemote says whether there are any. Edited in
// an inert document, not through DOMPurify's hooks: they're global, and the
// cards share it.
const INLINE_BUDGET = 10 * 1024 * 1024;
const REMOTE = /^\s*(https?:)?\/\//i;
const REMOTE_URL = /url\(\s*['"]?\s*(https?:)?\/\//i;
const dataUrl = (content, type) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(new Blob([content], { type }));
});
async function mailPage(letter, mail) {
  const { default: DOMPurify } = await import('dompurify');
  const clean = DOMPurify.sanitize(letter.html, {
    WHOLE_DOCUMENT: true,
    FORBID_TAGS: ['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'form', 'input', 'button', 'select', 'textarea', 'link', 'meta', 'base'],
    FORBID_ATTR: ['srcset'],
  });
  const doc = new DOMParser().parseFromString(clean, 'text/html');
  for (const a of doc.querySelectorAll('a[href]')) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
  let budget = INLINE_BUDGET;
  for (const el of doc.querySelectorAll('img[src], [background]')) {
    const attr = el.tagName === 'IMG' && el.hasAttribute('src') ? 'src' : 'background';
    const part = mail.inlinePart(letter, el.getAttribute(attr));
    if (!part) continue;
    const type = mail.pictureType(part);
    if (!type || part.content.byteLength > budget) { el.removeAttribute(attr); continue; }
    budget -= part.content.byteLength;
    el.setAttribute(attr, await dataUrl(part.content, type));
  }
  const hasRemote = [...doc.querySelectorAll('img[src]')].some((el) => REMOTE.test(el.getAttribute('src')))
    || [...doc.querySelectorAll('[background]')].some((el) => REMOTE.test(el.getAttribute('background')))
    || [...doc.querySelectorAll('[style]')].some((el) => REMOTE_URL.test(el.getAttribute('style')))
    || [...doc.querySelectorAll('style')].some((el) => REMOTE_URL.test(el.textContent));
  return { styles: [...doc.head.querySelectorAll('style')].map((el) => el.outerHTML).join(''), body: doc.body.outerHTML, hasRemote };
}

// The frame's document: a policy that lets nothing load but the pictures
// inside it (and, once asked, pictures from the web), no referrer, and a
// light page under the email's own styles.
const FRAME_STYLE = 'html{color-scheme:light}body{margin:0;padding:4px 2px;font:15px/1.55 -apple-system,system-ui,sans-serif;color:#222226;overflow-wrap:anywhere}img{max-width:100%;height:auto}';
function frameDoc(page, shown) {
  const policy = `default-src 'none'; img-src data:${shown ? ' https: http:' : ''}; style-src 'unsafe-inline'; font-src data:`;
  return '<!doctype html><html><head><meta charset="utf-8">'
    + `<meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer">`
    + `<style>${FRAME_STYLE}</style>${page.styles}</head>${page.body}</html>`;
}

// The sender's initials, for the round mark beside their name.
function initials(p) {
  const words = String(p?.name || '').match(/[\p{L}\p{N}]+/gu) || [];
  if (words.length) return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
  return String(p?.address || '?')[0].toUpperCase();
}

// The attachments: each to download, and all of them onto the board at once
// when the viewer can edit it and it's open (lib/fileActions.js): they land
// where the board is looked at, and Quick look closes so they're seen to.
function Attachments({ letter, mail, item, canPut, onClose }) {
  const feedback = useOptionalFeedback();
  const atts = letter.attachments;
  const n = atts.length;
  const files = () => atts.map((a, i) => new File([a.content], mail.attachmentName(a, i), { type: a.mimeType || '' }));
  const save = (a, i) => {
    deliverFile(new Blob([a.content], { type: a.mimeType || 'application/octet-stream' }), mail.attachmentName(a, i))
      .catch((err) => feedback?.toast({ type: 'error', code: 'mail_attachment_download_failed', message: `Download failed: ${err?.message || err}` }));
  };
  const put = canPut && item.boardId && canPutFiles(item.boardId);
  return (
    <div className="fst-mail-atts">
      <div className="fst-mail-lab">{n} {n === 1 ? 'attachment' : 'attachments'}</div>
      <div className="fst-mail-row">
        {atts.map((a, i) => {
          const name = mail.attachmentName(a, i);
          return (
            <div className="fst-mail-att" key={i}>
              <span className="fst-mail-thumb"><Icon as={attachmentGlyph(a.mimeType)} size={22} /></span>
              <span className="fst-mail-att-txt"><span className="fst-mail-nm">{name}</span><span className="fst-mail-sz">{humanSize(a.size)}</span></span>
              <button type="button" className="fst-mail-dl" aria-label={`Download ${name}`} title={`Download ${name}`} onClick={() => save(a, i)}>
                <Icon as={Download} size={15} />
              </button>
            </div>
          );
        })}
        {put && (
          <button type="button" className="fst-btn is-quiet"
                  onClick={() => { putFiles(item.boardId, files()); onClose?.(); }}>
            <Icon as={BoundingBox} size={14} />{n === 1 ? 'Put it on board' : n === 2 ? 'Put both on board' : `Put all ${n} on board`}
          </button>
        )}
      </div>
    </div>
  );
}

// An email as it was sent: its subject, who it's from and to and when, the
// letter, and its attachments. HTML shows in a frame that can't run anything
// or reach the app (sandboxed, with no scripts and no origin of its own),
// whose pictures from the web wait for Show pictures; it scrolls inside
// itself, so its page is as tall as Quick look. Plain text is the page's own,
// its quotes set apart, and the page is as tall as the letter.
function MailStage({ letter, mail, item, canPut, onClose }) {
  const [page, setPage] = useState(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!letter.html) return undefined;
    let live = true;
    mailPage(letter, mail).then((pg) => { if (live) setPage(pg); }, () => { if (live) setPage({ styles: '', body: '', hasRemote: false }); });
    return () => { live = false; };
  }, [letter, mail]);
  const { from } = letter;
  const html = !!letter.html;
  const when = mailWhen(letter.date);
  return (
    <Sheet kind="mail" className={html ? 'is-html' : ''}>
      <div className="fst-mail-in">
        <h2 className="fst-mail-subj">{letter.subject || 'No subject'}</h2>
        <div className="fst-mail-who">
          {from && <span className="fst-mail-av" aria-hidden="true">{initials(from)}</span>}
          <div className="fst-mail-from">
            {from && <>{from.name ? <b>{from.name}</b> : null}{from.name && from.address ? ' ' : null}{from.address ? <span>{from.name ? `<${from.address}>` : from.address}</span> : null}<br /></>}
            {letter.to.length > 0 && `To ${mailPeople(letter.to)}`}
            {letter.cc.length > 0 && <span>{letter.to.length ? ' · ' : ''}Cc {mailPeople(letter.cc)}</span>}
          </div>
          {when && <div className="fst-mail-date">{when}</div>}
        </div>
        {page?.hasRemote && !shown && (
          <div className="fst-top fst-mail-hold" role="status">
            <Icon as={EyeOff} size={16} />
            <span className="fst-grow">Pictures from the web are hidden in this email.</span>
            <button type="button" className="fst-btn" onClick={() => setShown(true)}>Show pictures</button>
          </div>
        )}
        {html ? (
          page && <iframe className="fst-mail-frame" title={letter.subject || 'Email'} sandbox="allow-popups allow-popups-to-escape-sandbox"
                          referrerPolicy="no-referrer" srcDoc={frameDoc(page, shown)} />
        ) : (
          <div className="fst-mail-text">
            {mail.letterBlocks(letter.text.slice(0, TEXT_STAGE_MAX_BYTES)).map((b, i) => (b.quote
              ? <blockquote className="fst-mail-quote" key={i}>{b.paras.map((t, j) => <p key={j}>{t}</p>)}</blockquote>
              : <p key={i}>{b.text}</p>))}
          </div>
        )}
        {letter.attachments.length > 0 && <Attachments letter={letter} mail={mail} item={item} canPut={canPut} onClose={onClose} />}
      </div>
    </Sheet>
  );
}

function MailFamily({ item, onDownload, canPut, onClose, fallback }) {
  const p = item.preview || {};
  const sizeBytes = item.sizeBytes ?? item.card?.sizeBytes ?? null;
  const got = useMail(p.src, sizeBytes);
  if (got === undefined) return <div className="qpage fst-mail" aria-busy="true" />;
  if (got?.big) {
    return (
      <div className="fst-big">
        {fallback}
        <p className="ql-audio-status" role="status">This email is too big to open here.</p>
        {onDownload && <button type="button" className="ql-btn" onClick={() => onDownload(item)}><Icon as={Download} size={14} />Download</button>}
      </div>
    );
  }
  // Not a letter, or it couldn't be read: Quick look's own card.
  if (!got) return fallback;
  return <MailStage letter={got.letter} mail={got.mail} item={item} canPut={canPut} onClose={onClose} />;
}

export default function FileStage(props) {
  if (props.family === 'font') return <FontFamily {...props} />;
  if (props.family === 'mail') return <MailFamily {...props} />;
  if (TEXT_STAGES[props.family]) return <TextFamily {...props} />;
  return props.fallback;
}
