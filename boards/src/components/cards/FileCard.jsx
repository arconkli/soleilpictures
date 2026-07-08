// Generic file card — any uploaded file that isn't a richer card kind
// (image/pdf/video/audio). Shows a type icon, filename + size, and a
// download/open button. Small text-ish files render an inline preview. The
// original lives at `fileSrc` ("r2:<key>"). Read-only safe (works on public
// boards: download/preview just resolve a signed read URL).

import { useState, useEffect, useRef } from 'react';
import { Spinner } from '../Spinner.jsx';
import { EditableText } from '../EditableText.jsx';
import { Icon } from '../Icon.jsx';
import { resolveSrc } from '../../lib/r2.js';
import {
  FileIcon, FileText, FilePdf, FileZip, FileDoc, Image as ImagePh,
  Headphones, Clapperboard, Database, CodeIcon, Download,
} from '../../lib/icons.js';
import './fileCard.css';

const TEXT_PREVIEW_MAX_BYTES = 256 * 1024;   // don't fetch big files for a preview
const TEXT_PREVIEW_MAX_CHARS = 50 * 1024;    // bound the DOM
const CODE_EXTS = new Set(['js','jsx','ts','tsx','py','rb','go','rs','c','h','cpp','cc',
  'java','kt','swift','sh','bash','zsh','sql','css','scss','html','htm','xml','json','yml','yaml','toml']);
const TEXT_EXTS = new Set([...CODE_EXTS, 'txt','md','markdown','csv','tsv','ini','log','env','conf']);

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
  if (/^(csv|tsv|xls|xlsx|numbers|parquet)$/.test(e)) return Database;
  if (/^(doc|docx|pages|rtf|odt)$/.test(e)) return FileDoc;
  if (CODE_EXTS.has(e) || m === 'application/json') return CodeIcon;
  if (TEXT_EXTS.has(e) || m.startsWith('text/')) return FileText;
  if (/^(psd|ai|sketch|fig|xd|eps|svg|tiff?|raw|cr2|nef|heic)$/.test(e) || m.startsWith('image/')) return ImagePh;
  if (m.startsWith('audio/')) return Headphones;
  if (m.startsWith('video/')) return Clapperboard;
  return FileIcon;
}

export function FileCard({ fileSrc, fileName, mime, sizeBytes, ext, title,
                          onUpdate, autoFocus = false, editTitleAt = 0, onAfterEdit,
                          pending = false, uploadProgress = null }) {
  const [editingTitle, setEditingTitle] = useState(false);
  useEffect(() => { if (editTitleAt > 0) setEditingTitle(true); }, [editTitleAt]);
  const prevEdit = useRef(editingTitle);
  useEffect(() => {
    if (prevEdit.current && !editingTitle) onAfterEdit?.();
    prevEdit.current = editingTitle;
  }, [editingTitle]);

  const e = extOf(fileName, ext);
  const GlyphIcon = iconForFile(e, mime);
  const label = fileName || title || 'File';
  const sizeText = humanSize(sizeBytes);
  const showTitle = !!title || editingTitle;

  // Inline preview for small text-ish files (best-effort, never blocks the card).
  const [preview, setPreview] = useState(null);
  const isTextish = !pending && !!fileSrc && sizeBytes != null && sizeBytes <= TEXT_PREVIEW_MAX_BYTES
    && (TEXT_EXTS.has(e) || (mime || '').startsWith('text/')
        || mime === 'application/json' || mime === 'application/xml');
  useEffect(() => {
    if (!isTextish) { setPreview(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const url = await resolveSrc(fileSrc);
        if (!url || cancelled) return;
        const res = await fetch(url);
        if (!res.ok || cancelled) return;
        const text = (await res.text()).slice(0, TEXT_PREVIEW_MAX_CHARS);
        if (!cancelled) setPreview(text);
      } catch (_) { /* leave the icon tile */ }
    })();
    return () => { cancelled = true; };
  }, [isTextish, fileSrc]);

  const download = async (ev) => {
    ev?.stopPropagation?.();
    if (!fileSrc) return;
    let url = null;
    try {
      url = await resolveSrc(fileSrc);
      if (!url) return;
      const res = await fetch(url);
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = fileName || `file.${e || 'bin'}`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(objUrl), 10000);
    } catch (_) {
      // CORS/blob failure → open the signed URL in a new tab as a fallback.
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div className="filec ic">
      <div className={`filec-body ${preview != null ? 'has-preview' : ''}`} onDoubleClick={download}>
        {preview != null ? (
          <pre className={`filec-preview ${CODE_EXTS.has(e) ? 'is-code' : ''}`}>{preview}</pre>
        ) : (
          <div className="filec-glyph"><Icon as={GlyphIcon} size={42} /></div>
        )}
        {pending && (
          <div className="ic-upload-overlay" aria-label="Uploading file">
            <Spinner size={22} tone="on-dark" label="Uploading file" />
            {uploadProgress != null && (
              <div className="ic-upload-progress">{Math.round(uploadProgress * 100)}%</div>
            )}
          </div>
        )}
        {!pending && fileSrc && (
          <button type="button" className="ic-expand" title={`Download ${label}`}
                  onPointerDown={(ev) => ev.stopPropagation()}
                  onClick={download}>
            <Icon as={Download} size={12} />
          </button>
        )}
        <div className="filec-info">
          <span className="filec-info-icon"><Icon as={GlyphIcon} size={15} /></span>
          <span className="filec-info-name" title={label}>{label}</span>
          {sizeText && <span className="filec-info-size">{sizeText}</span>}
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
