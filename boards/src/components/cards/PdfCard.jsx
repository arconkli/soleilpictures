// PDF canvas card. Shows a rendered page-1 thumbnail (an R2 image, identical
// plumbing to ImageCard) + the filename + a "N pages" pill. Clicking the
// expand button (or double-clicking the card, handled in CanvasSurface) opens
// the fullscreen PdfViewer. The original PDF lives at `pdfSrc`; `src` is the
// page-1 webp thumbnail key. Read-only safe (no onUpdate → no editors).

import { useState, useEffect, useRef } from 'react';
import { R2Image } from '../R2Image.jsx';
import { Spinner } from '../Spinner.jsx';
import { EditableText } from '../EditableText.jsx';
import { Icon } from '../Icon.jsx';
import { FilePdf } from '../../lib/icons.js';

export function PdfCard({ src, name, pageCount, title,
                          w, h, onUpdate, autoFocus = false,
                          editTitleAt = 0, onExpand, onAfterEdit,
                          pending = false, uploadProgress = null,
                          backfillEnabled = false, boardId = null, cardId = null }) {
  const [editingTitle, setEditingTitle] = useState(false);
  useEffect(() => { if (editTitleAt > 0) setEditingTitle(true); }, [editTitleAt]);
  const prevEdit = useRef(editingTitle);
  useEffect(() => {
    if (prevEdit.current && !editingTitle) onAfterEdit?.();
    prevEdit.current = editingTitle;
  }, [editingTitle]);

  const label = name || 'PDF';
  const pages = Number.isFinite(pageCount) && pageCount > 0
    ? `${pageCount} ${pageCount === 1 ? 'page' : 'pages'}`
    : 'PDF';
  const showTitle = !!title || editingTitle;

  return (
    <div className="pdfc">
      <div className="pdfc-thumbwrap" onDoubleClick={(e) => { if (onExpand) { e.stopPropagation(); onExpand(); } }}>
        {src
          ? <R2Image src={src} alt={title || label} w={w} h={h} className="pdfc-thumb" draggable="false"
                     progressive backfillEnabled={backfillEnabled} boardId={boardId} cardId={cardId} />
          : (
            <div className="pdfc-placeholder">
              <Icon as={FilePdf} size={42} />
            </div>
          )}
        {pending && (
          <div className="ic-upload-overlay" aria-label="Uploading PDF">
            <Spinner size={22} tone="on-dark" label="Uploading PDF" />
            {uploadProgress != null && (
              <div className="ic-upload-progress">{Math.round(uploadProgress * 100)}%</div>
            )}
          </div>
        )}
        {!pending && onExpand && (
          <button type="button" className="ic-expand" title="Open PDF"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); onExpand(); }}>
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none"
                 stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 5 V2 H5 M12 5 V2 H9 M2 9 V12 H5 M12 9 V12 H9" />
            </svg>
          </button>
        )}
        <div className="pdfc-info">
          <span className="pdfc-info-icon"><Icon as={FilePdf} size={15} /></span>
          <span className="pdfc-info-name" title={label}>{label}</span>
          <span className="pdfc-info-pages">{pages}</span>
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
