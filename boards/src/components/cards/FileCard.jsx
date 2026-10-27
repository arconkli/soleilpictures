// Generic file card — any uploaded file that isn't a richer card kind
// (image/pdf/video/audio). Shows a type icon, filename + size, and a
// download/open button. A text file (Markdown, a table, subtitles, code, a
// log) shows its first page, drawn from the file (FamilyFace.jsx), a
// document (Word, PowerPoint, Excel…) its first page, and a design file
// (Sketch, Figma, Procreate, Illustrator…) the picture it keeps of itself.
// The original lives at
// `fileSrc` ("r2:<key>"). Read-only safe (works on public boards:
// download/preview just resolve a signed read URL).

import { useState, useEffect, useRef } from 'react';
import { Spinner } from '../Spinner.jsx';
import { EditableText } from '../EditableText.jsx';
import { Icon } from '../Icon.jsx';
import { R2Image } from '../R2Image.jsx';
import { resolveSrc } from '../../lib/r2.js';
import { viewKindOfKey, docFamily, extOfKey, DOC_MAX_PAGES, fileFamily, isDrawnFamily } from '../../lib/fileView.js';
import { downloadCardAsset } from '../../lib/cardDownload.js';
import { useOptionalFeedback } from '../AppFeedback.jsx';
import {
  FileIcon, FileText, FilePdf, FileZip, FileDoc, FilePpt, FileXls, Presentation, Image as ImagePh,
  Headphones, Clapperboard, Database, CodeIcon, Download,
} from '../../lib/icons.js';
import './fileCard.css';

// The pages of the families a card draws from the file live in their own
// chunk (FamilyFace.jsx), loaded the first time a card needs one.
let facesMod = null;
let facesLoad = null;
const loadFaces = () => facesLoad || (facesLoad = import('./FamilyFace.jsx').then((m) => { facesMod = m; return m; }));
export function useFaces(want) {
  const [mod, setMod] = useState(facesMod);
  useEffect(() => {
    if (!want || mod) return undefined;
    let live = true;
    loadFaces().then((m) => { if (live) setMod(m); }, () => { facesLoad = null; });
    return () => { live = false; };
  }, [want, mod]);
  return mod;
}

export function humanSize(bytes) {
  if (bytes == null) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes, i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${u[i]}`;
}

export function extOf(fileName, ext) {
  if (ext) return String(ext).toLowerCase();
  const m = String(fileName || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

export function iconForFile(ext, mime) {
  const e = (ext || '').toLowerCase();
  const m = (mime || '').toLowerCase();
  if (e === 'pdf' || m === 'application/pdf') return FilePdf;
  if (/^(zip|rar|7z|gz|tgz|bz2|xz|tar|dmg|iso)$/.test(e)) return FileZip;
  // A document wears its family's glyph: Excel's, PowerPoint's and Word's
  // own, a deck's for Keynote and the rest, and the data files' for the other
  // spreadsheets.
  if (/^(xls|xlsx|xlsm|xlsb|xlt|xltx|xltm)$/.test(e)) return FileXls;
  if (/^(ppt|pptx|pptm|pps|ppsx|ppsm|pot|potx|potm)$/.test(e)) return FilePpt;
  if (/^(key|odp|otp|sxi)$/.test(e)) return Presentation;
  if (/^(numbers|ods|ots|sxc|csv|tsv|parquet)$/.test(e)) return Database;
  if (/^(doc|docx|docm|dot|dotx|dotm|pages|rtf|odt|ott|wpd|wps|sxw)$/.test(e)) return FileDoc;
  const family = fileFamily(e, m);
  if (family === 'code') return CodeIcon;
  // A design file's own app's glyph comes with its card's picture (FamilyFace.jsx familyGlyph).
  if (family === 'design') return ImagePh;
  if (family && family !== 'doc' && family !== 'font') return FileText;
  if (/^(psd|svg|tiff?|raw|cr2|nef|heic)$/.test(e) || m.startsWith('image/')) return ImagePh;
  if (m.startsWith('audio/')) return Headphones;
  if (m.startsWith('video/')) return Clapperboard;
  return FileIcon;
}

export function FileCard({ fileSrc, fileName, mime, sizeBytes, ext, title,
                          onUpdate, autoFocus = false, editTitleAt = 0, onAfterEdit,
                          pending = false, uploadProgress = null,
                          // On a board, double-click belongs to the board (it
                          // opens the file full screen); elsewhere it downloads.
                          opensOnBoard = false,
                          // A document's page: the card's size (for the size
                          // of picture it fetches), its board and id, and the
                          // number of pages the editors' pass wrote on it.
                          w, h, boardId = null, cardId = null, pageCount = null }) {
  const [editingTitle, setEditingTitle] = useState(false);
  useEffect(() => { if (editTitleAt > 0) setEditingTitle(true); }, [editTitleAt]);
  const prevEdit = useRef(editingTitle);
  useEffect(() => {
    if (prevEdit.current && !editingTitle) onAfterEdit?.();
    prevEdit.current = editingTitle;
  }, [editingTitle]);

  const e = extOf(fileName, ext);
  const GlyphIcon = iconForFile(e, mime);
  const label = title || fileName || 'File';   // a rename shows; the download keeps fileName
  const sizeText = humanSize(sizeBytes);
  const showTitle = !!title || editingTitle;

  // A document shows its first page (lib/fileView.js), as a PDF card shows
  // its: the page fills the card from its top (a sheet's cells from their top
  // left), so a card placed before pages showed, still a file card's shape,
  // shows the top of the page. A design file shows its picture covering the
  // card, at the picture's own shape once it is made. Until the page is here
  // the card is its glyph, saying so while the page is being made, and one
  // that won't get a page stays its glyph. Its strip counts its pages
  // (slides, for a deck) once it knows them, and gives its size until then.
  const viewRef = !pending && typeof fileSrc === 'string' && fileSrc.startsWith('r2:') ? fileSrc.slice(3) : '';
  const viewKind = viewRef ? viewKindOfKey(viewRef) : null;
  const docKey = viewKind === 'doc' ? viewRef : '';
  const designKey = viewKind === 'design' ? viewRef : '';
  const family = docKey ? docFamily(extOfKey(docKey)) : null;
  const pages = Number(pageCount) > 0 ? Math.floor(Number(pageCount)) : 0;
  const unit = family === 'slides' ? (pages === 1 ? 'slide' : 'slides') : (pages === 1 ? 'page' : 'pages');
  // The converter prints the first DOC_MAX_PAGES pages and no more.
  const metaText = docKey && pages ? `${pages}${pages >= DOC_MAX_PAGES ? '+' : ''} ${unit}` : sizeText;
  const docPlaceholder = (state) => (
    <div className={`filec-glyph${state === 'making' ? ' is-making' : ''}`}>
      <Icon as={designKey ? StripIcon : GlyphIcon} size={42} />
      {state === 'making' && <span className="filec-making">Making a preview…</span>}
    </div>
  );

  // A text file's first page (FamilyFace.jsx): white from the start, its
  // page once its chunk and the file's first bytes are here, and its glyph
  // when the file only says it's text. Its strip wears its family's icon,
  // and says what the page knows that its size doesn't (an email's
  // attachments) once it knows it. A design file's strip wears its app's.
  const drawnFamily = !docKey && !pending && fileSrc ? fileFamily(e, mime) : null;
  const drawn = isDrawnFamily(drawnFamily);
  const faces = useFaces(drawn || !!designKey);
  const StripIcon = ((drawn || designKey) && faces?.familyGlyph(drawnFamily, e)) || GlyphIcon;
  const [faceMeta, setFaceMeta] = useState(null);
  const stripMeta = (drawn && faceMeta) || metaText;
  // Uploading, the spinner stands alone on the card.
  const glyph = <div className="filec-glyph">{!pending && <Icon as={GlyphIcon} size={42} />}</div>;

  // Shared with every other download in the app (lib/cardDownload.js), which
  // among other things routes through deliverFile — so this button now does
  // something inside the native app, where <a download> never saved anything.
  //
  // A big file can take a long while to arrive before the save dialog shows,
  // so the button says it is working (a repeat click joins the download
  // already running — cardDownload shares the promise). A failure that
  // survives the helper's own fallback (opening the signed URL) is said in a
  // toast; it used to be swallowed, and the button just did nothing.
  // Optional feedback: the DEV harnesses mount cards outside the provider.
  const feedback = useOptionalFeedback();
  const [busy, setBusy] = useState(false);
  const download = async (ev) => {
    ev?.stopPropagation?.();
    if (!fileSrc) return;
    setBusy(true);
    try {
      await downloadCardAsset({ fileSrc, fileName, mime, sizeBytes, ext: e, title }, 'file',
                              { surface: 'file_card' });
    } catch (err) {
      feedback?.toast({ type: 'error', code: 'file_download_failed', message: 'Download failed: ' + (err?.message || err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="filec ic">
      <div className={`filec-body${drawn ? ' is-page' : ''}`} onDoubleClick={opensOnBoard ? undefined : download}>
        {docKey || designKey ? (
          <R2Image progressive src={fileSrc} alt={label} w={w} h={h} boardId={boardId} cardId={cardId}
                   className={`filec-page${designKey ? ' is-picture' : family === 'sheet' ? ' is-sheet' : ''}`} draggable="false"
                   placeholder={docPlaceholder} />
        ) : drawn ? (
          faces && <faces.default family={drawnFamily} src={fileSrc} ext={e} name={fileName} sizeBytes={sizeBytes} w={w} h={h}
                                  fallback={glyph} onMeta={setFaceMeta} />
        ) : glyph}
        {pending && (
          <div className="ic-upload-overlay" aria-label="Uploading file">
            <Spinner size={22} tone="on-dark" label="Uploading file" />
            {uploadProgress != null && (
              <div className="ic-upload-progress">{Math.round(uploadProgress * 100)}%</div>
            )}
          </div>
        )}
        {!pending && fileSrc && (
          <button type="button" className={`ic-expand${busy ? ' is-busy' : ''}`}
                  title={busy ? 'Preparing download…' : `Download ${label}`}
                  aria-busy={busy || undefined}
                  onPointerDown={(ev) => ev.stopPropagation()}
                  onClick={download}>
            {busy
              ? <Spinner size={12} tone="on-dark" label="Preparing download…" />
              : <Icon as={Download} size={12} />}
          </button>
        )}
        <div className="filec-info">
          <span className="filec-info-icon"><Icon as={StripIcon} size={15} /></span>
          <span className="filec-info-name" title={label}>{label}</span>
          {stripMeta && <span className="filec-info-size">{stripMeta}</span>}
        </div>
      </div>
      {showTitle && onUpdate && (
        <EditableText
          className="ic-title editable"
          value={title || ''}
          placeholder="Title"
          editing={editingTitle}
          setEditing={setEditingTitle}
          onChange={(v) => onUpdate({ title: v || null })}
          selectAllOnFocus={autoFocus}
        />
      )}
      {showTitle && !onUpdate && <div className="ic-title">{title}</div>}
    </div>
  );
}
