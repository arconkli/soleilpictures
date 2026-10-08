// Quick look — a file, big, without leaving Files. Double-click a file or press
// Space; ←/→ step through the files in the order Files shows them; Space or Esc
// closes. Pictures zoom and pan (the lightbox's own stage), video and audio
// play (one thing at a time, through audioBus), PDFs page through, and
// everything else shows its preview large.
//
// Lazy-loaded from ListSurface. It is a modal dialog: it registers with the
// modal guard, so the board's and Files' own keys stand down while it's open,
// and it keeps keyboard focus inside itself until it closes.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { registerModalOpen } from '../../lib/modalGuard.js';
import { resolveSrc } from '../../lib/r2.js';
import * as audioBus from '../../lib/audioBus.js';
import { DOWNLOADABLE } from '../../lib/cardAssetName.js';
import { ImageZoomStage } from '../ImageLightbox.jsx';
import { PdfViewer } from '../PdfViewer.jsx';
import { CardPreview } from './CardPreview.jsx';
import { DetailPanel } from './DetailPanel.jsx';
import { Icon } from '../Icon.jsx';
import { X, Download, ChevronLeft, ChevronRight, Info, BoundingBox, ArrowSquareOut } from '../../lib/icons.js';

// A signed URL for a stored file (r2:…), or the URL itself.
function useResolved(src) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let off = false;
    setUrl(null);
    if (!src) return undefined;
    resolveSrc(src).then((u) => { if (!off) setUrl(u || null); }).catch(() => {});
    return () => { off = true; };
  }, [src]);
  return url;
}

// <video> / <audio> that takes its turn on the shared audio bus.
function Media({ kind, src, poster, title }) {
  const url = useResolved(src);
  const posterUrl = useResolved(poster);
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const stop = () => { try { el.pause(); } catch (_) {} };
    const onPlay = () => audioBus.claim(stop, { source: 'quicklook' });
    const onDone = () => audioBus.release(stop);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onDone);
    el.addEventListener('ended', onDone);
    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onDone);
      el.removeEventListener('ended', onDone);
      stop();
      audioBus.release(stop);
    };
  }, [url]);
  if (!url) return <div className="ql-wait" aria-label="Loading" />;
  if (kind === 'video') {
    return <video ref={ref} className="ql-video" src={url} poster={posterUrl || undefined} controls autoPlay playsInline aria-label={title} />;
  }
  return <audio ref={ref} className="ql-audio-el" src={url} controls autoPlay aria-label={title} />;
}

function Stage({ item }) {
  const card = item?.card || {};
  const name = item?.name || '';
  if (item.kind === 'image' && card.src) {
    return <ImageZoomStage src={card.src} alt={name} adjust={card.adjust} cardId={card.id} />;
  }
  if (item.kind === 'video' && card.src) {
    return <div className="ql-media"><Media kind="video" src={card.src} poster={card.poster} title={name} /></div>;
  }
  if (item.kind === 'audio' && card.src) {
    return (
      <div className="ql-media ql-audio">
        <div className="ql-audio-art"><CardPreview item={item} size="tile" px={480} /></div>
        <Media kind="audio" src={card.src} title={name} />
      </div>
    );
  }
  if (item.kind === 'pdf' && card.pdfSrc) {
    return <div className="ql-pdf"><PdfViewer embedded src={card.pdfSrc} name={name} /></div>;
  }
  return (
    <div className="ql-card">
      <div className="ql-card-preview"><CardPreview item={item} size="tile" px={640} /></div>
      {item.kind === 'link' && /^https?:\/\//i.test(card.url || card.link || '') && (
        <a className="cbt-btn ql-open" href={card.url || card.link} target="_blank" rel="noopener noreferrer">
          <Icon as={ArrowSquareOut} size={13} />Open link
        </a>
      )}
    </div>
  );
}

const FOCUSABLE = 'button, a[href], video, audio, [tabindex]:not([tabindex="-1"])';

export default function QuickLook({
  items, index, onIndex, onClose,
  onShowOnBoard = null, showLabel = 'Show on board',
  onDownload = null,
  infoOpen = false, onToggleInfo = null,
  boards = {}, canEdit = false, onDelete = null,
}) {
  const rootRef = useRef(null);
  const item = items[index] || null;
  const n = items.length;

  useEffect(() => registerModalOpen(), []);

  // Focus moves in, and goes back where it was on close.
  useEffect(() => {
    const prev = document.activeElement;
    rootRef.current?.focus({ preventScroll: true });
    return () => { try { prev?.focus?.({ preventScroll: true }); } catch (_) {} };
  }, []);

  const go = (d) => { if (n) onIndex((index + d + n) % n); };

  // Capture phase: this is the top-most surface, so its keys come first.
  useEffect(() => {
    const onKey = (e) => {
      // A dialog opened on top (a delete confirm) owns the keyboard.
      const focusDialog = document.activeElement?.closest?.('[role="dialog"], [role="alertdialog"]');
      if (focusDialog && focusDialog !== rootRef.current) return;
      const t = e.target;
      const inField = t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.isContentEditable;
      const onMediaOrButton = !!t?.closest?.('video, audio, button, a[href]');
      if (e.key === 'Escape' || ((e.key === ' ' || e.code === 'Space') && !inField && !onMediaOrButton)) {
        e.preventDefault(); e.stopPropagation(); onClose(); return;
      }
      if (inField) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault(); e.stopPropagation(); go(e.key === 'ArrowLeft' ? -1 : 1); return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'i' || e.key === 'I')) {
        e.preventDefault(); e.stopPropagation(); onToggleInfo?.(); return;
      }
      if (e.key === 'Tab') {
        // Keep focus inside the dialog.
        const els = [...(rootRef.current?.querySelectorAll(FOCUSABLE) || [])].filter((el) => !el.disabled);
        if (!els.length) { e.preventDefault(); return; }
        const first = els[0], last = els[els.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === rootRef.current)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  // Warm the pictures either side, so stepping through is instant.
  useEffect(() => {
    if (n < 2) return;
    for (const d of [-1, 1]) {
      const c = items[(index + d + n) % n]?.card;
      if (items[(index + d + n) % n]?.kind !== 'image' || !c?.src) continue;
      resolveSrc(c.src).then((u) => { if (u) { const img = new Image(); img.src = u; } }).catch(() => {});
    }
  }, [index, items, n]);

  if (!item) return null;
  const canDownload = !!onDownload && !item.pending && DOWNLOADABLE.has(item.kind);

  // On <body>: the list scrolls in its own stacking context (isolation), so a
  // fixed overlay inside it would sit under the board's toolbars.
  return createPortal(
    <div className={`ql${infoOpen ? ' has-info' : ''}`} ref={rootRef} tabIndex={-1}
         role="dialog" aria-modal="true" aria-label={`Quick look: ${item.name}`}
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ql-bar">
        <div className="ql-title">
          <span className="ql-name" title={item.name}>{item.name}</span>
          <span className="ql-meta">{item.typeLabel}{n > 1 ? ` · ${index + 1} of ${n}` : ''}</span>
        </div>
        {onShowOnBoard && (
          <button type="button" className="ql-btn" onClick={() => onShowOnBoard(item)} title={showLabel}>
            <Icon as={BoundingBox} size={14} /><span>{showLabel}</span>
          </button>
        )}
        {canDownload && (
          <button type="button" className="ql-btn" onClick={() => onDownload(item)} title="Download">
            <Icon as={Download} size={14} /><span>Download</span>
          </button>
        )}
        {onToggleInfo && (
          <button type="button" className={`ql-btn${infoOpen ? ' is-on' : ''}`} onClick={onToggleInfo}
                  aria-pressed={infoOpen} title="Info (⌘I)">
            <Icon as={Info} size={14} /><span>Info</span>
          </button>
        )}
        <button type="button" className="ql-btn ql-x" onClick={onClose} aria-label="Close" title="Close (Esc)">
          <Icon as={X} size={16} />
        </button>
      </div>
      <div className="ql-body" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        {n > 1 && (
          <button type="button" className="ql-nav ql-prev" onClick={() => go(-1)} aria-label="Previous file" title="Previous (←)">
            <Icon as={ChevronLeft} size={20} />
          </button>
        )}
        <div className="ql-stage" key={item.id}><Stage item={item} /></div>
        {n > 1 && (
          <button type="button" className="ql-nav ql-next" onClick={() => go(1)} aria-label="Next file" title="Next (→)">
            <Icon as={ChevronRight} size={20} />
          </button>
        )}
        {infoOpen && (
          <DetailPanel inline target={{ type: 'card', item }} boards={boards} canEdit={canEdit}
                       onClose={onToggleInfo} onReveal={onShowOnBoard ? () => onShowOnBoard(item) : null}
                       onDelete={onDelete} />
        )}
      </div>
    </div>,
    document.body,
  );
}
