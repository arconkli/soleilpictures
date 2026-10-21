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
import * as modalGuard from '../../lib/modalGuard.js';
import { filmLayerOpen } from '../../lib/filmLayers.js';
import { isPublicSurface } from '../../lib/cardDownload.js';
import { resolveSrc } from '../../lib/r2.js';
import * as audioBus from '../../lib/audioBus.js';
import { DOWNLOADABLE } from '../../lib/cardAssetName.js';
import { ImageZoomStage } from '../ImageLightbox.jsx';
import { PdfViewer } from '../PdfViewer.jsx';
import { CardPreview } from './CardPreview.jsx';
import { LinkMark } from './marks.jsx';
import { DetailPanel } from './DetailPanel.jsx';
import { Icon, IconWeightContext } from '../Icon.jsx';
import { useFilesLook } from './filesLook.js';
import { fileSharesAllowed } from '../../lib/appHost.js';
import { isShareableCard } from '../../lib/fileShares.js';
import { FileShareButton } from '../fileShare/FileShareButton.jsx';
import { X, Download, ChevronLeft, ChevronRight, Info, BoundingBox, ArrowSquareOut, ArrowsOutSimple } from '../../lib/icons.js';
import { FilmPlayer } from '../film/FilmPlayer.jsx';
import { probeCardVideo } from '../../hooks/useMediaFacts.js';
import { openPlayer } from '../../lib/playerBus.js';

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

function Stage({ item, playerRef = null, modalHandle = null }) {
  const card = item?.card || {};
  const name = item?.name || '';
  if (item.kind === 'image' && card.src) {
    return <ImageZoomStage src={card.src} alt={name} adjust={card.adjust} cardId={card.id} />;
  }
  if (item.kind === 'video' && card.src) {
    // The film player sized to the picture, its controls over the bottom
    // edge. Only , . J/K/L and M are its keys — Space closes, ←/→ still step
    // between files. A public page has no review player to open.
    const open = (st) => openPlayer({ boardId: item.boardId, cardId: item.id, card: item.card, time: st?.time ?? null, playing: !!st?.playing });
    const canOpen = !!item.boardId && !isPublicSurface();
    return (
      <div className="ql-media ql-film">
        <FilmPlayer ref={playerRef} mode="preview" keyboard="preview" modalHandle={modalHandle}
                    src={card.src} poster={card.poster} media={card.media || null} title={name} autoPlay
                    onOpenPlayer={canOpen ? open : null}
                    probe={() => probeCardVideo(card)} />
      </div>
    );
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
  if (item.kind === 'link') {
    // A link gets a card of its own: its picture if it has one, the site's
    // mark, the title, the address, and an Open link that always works — a
    // bare domain is opened over https.
    const raw = card.url || card.link || card.source || '';
    const href = raw ? (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`) : null;
    return (
      <div className="ql-link">
        {card.image && <div className="ql-link-og"><CardPreview item={item} size="tile" px={520} /></div>}
        <div className="ql-link-body">
          <span className="ql-link-chip"><LinkMark favicon={card.favicon || null} source={raw} size="row" /></span>
          <div className="ql-link-title">{name}</div>
          {raw && <div className="ql-link-url" title={raw}>{raw}</div>}
          {href && (
            <a className="cbt-btn ql-open" href={href} target="_blank" rel="noopener noreferrer">
              <Icon as={ArrowSquareOut} size={16} weight="light" />Open link
            </a>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="ql-card">
      <div className="ql-card-preview"><CardPreview item={item} size="tile" px={640} /></div>
    </div>
  );
}

const FOCUSABLE = 'button, a[href], video, audio, [tabindex]:not([tabindex="-1"])';

export default function QuickLook({
  items, index, onIndex, onClose,
  onShowOnBoard = null, showLabel = 'Show on board',
  onDownload = null,
  onPutOnBoard = null,   // (item) => put a file that's waiting in Files on the board
  infoOpen = false, onToggleInfo = null,
  boards = {}, canEdit = false, onDelete = null,
  // Quick look can step across clusters (the sidebar's Recent and Starred, a
  // browsed cluster), so edit rights are asked per file when the host knows
  // them; `canEdit` is the fallback for a host showing one cluster.
  canEditItem = null,
}) {
  // Direction A's look (filesLook.js), handed through the portal by context.
  const look = useFilesLook();
  const sb = look === 'sb';
  const rootRef = useRef(null);
  const item = items[index] || null;
  const n = items.length;
  const itemCanEdit = item ? (canEditItem ? !!canEditItem(item) : canEdit) : false;

  // Kept: the film player in here takes its keys only while Quick look is the
  // top layer (the review player opened from it sits above), and so does
  // Quick look's own key handler.
  const modalRef = useRef(null);
  useEffect(() => {
    const unregister = modalGuard.registerModalOpen();
    modalRef.current = unregister;
    return () => { modalRef.current = null; unregister(); };
  }, []);
  const playerRef = useRef(null);

  // Focus moves in, and goes back where it was on close.
  useEffect(() => {
    const prev = document.activeElement;
    rootRef.current?.focus({ preventScroll: true });
    return () => { try { prev?.focus?.({ preventScroll: true }); } catch (_) {} };
  }, []);

  const go = (d) => { if (n) onIndex((index + d + n) % n); };

  // Capture phase: while Quick look is the top-most surface its keys come
  // first. Capture also means it hears keys meant for a layer opened OVER it
  // (the review player, a viewer), so it stands down unless it is the top
  // registered layer — Escape used to close Quick look and leave that layer
  // standing.
  useEffect(() => {
    const onKey = (e) => {
      // Anything layered above — the player's menu, the review player, a
      // confirm — owns the keyboard, wherever the focus happens to be.
      if (modalGuard.isTopModal && !modalGuard.isTopModal(modalRef.current)) return;
      if (filmLayerOpen()) return;
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
    <IconWeightContext.Provider value={sb ? 'regular' : null}>
    <div className={`ql${infoOpen ? ' has-info' : ''}`} ref={rootRef} tabIndex={-1} data-look={sb ? look : undefined}
         role="dialog" aria-modal="true" aria-label={`Quick look: ${item.name}`}
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ql-bar">
        <div className="ql-title">
          <span className="ql-name" title={item.name}>{item.name}</span>
          <span className="ql-meta">{item.typeLabel}{n > 1 ? ` · ${index + 1} of ${n}` : ''}</span>
        </div>
        {onShowOnBoard && (
          <button type="button" className="ql-btn" onClick={() => onShowOnBoard(item)} title={showLabel}>
            <Icon as={BoundingBox} size={14} weight="light" /><span>{showLabel}</span>
          </button>
        )}
        {onPutOnBoard && item.unplaced && (
          <button type="button" className="ql-btn" onClick={() => onPutOnBoard(item)} title="Put on the board">
            <Icon as={BoundingBox} size={14} weight="light" /><span>Put on board</span>
          </button>
        )}
        {item.kind === 'video' && item.card?.src && item.boardId && !isPublicSurface() && (
          <button type="button" className="ql-btn" title="Open in the review player"
                  onClick={() => {
                    const st = playerRef.current?.getState?.();
                    playerRef.current?.pause?.();
                    openPlayer({ boardId: item.boardId, cardId: item.id, card: item.card, time: st?.time ?? null, playing: !!st?.playing });
                  }}>
            <Icon as={ArrowsOutSimple} size={14} weight="light" /><span>Player</span>
          </button>
        )}
        {itemCanEdit && item.boardId && !isPublicSurface() && fileSharesAllowed() && isShareableCard(item.card) && (
          <FileShareButton key={`share:${item.boardId}:${item.id}`} variant="ql" surface="quicklook"
                           boardId={item.boardId} cardId={item.id} card={item.card} boardName={null} />
        )}
        {canDownload && (
          <button type="button" className="ql-btn" onClick={() => onDownload(item)} title="Download">
            <Icon as={Download} size={14} weight="light" /><span>Download</span>
          </button>
        )}
        {onToggleInfo && (
          <button type="button" className={`ql-btn${infoOpen ? ' is-on' : ''}`} onClick={onToggleInfo}
                  aria-pressed={infoOpen} title="Info (⌘I)">
            <Icon as={Info} size={14} weight="light" /><span>Info</span>
          </button>
        )}
        <button type="button" className="ql-btn ql-x" onClick={onClose} aria-label="Close" title="Close (Esc)">
          <Icon as={X} size={16} weight="light" />
        </button>
      </div>
      <div className="ql-body" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        {n > 1 && (
          <button type="button" className="ql-nav ql-prev" onClick={() => go(-1)} aria-label="Previous file" title="Previous (←)">
            <Icon as={ChevronLeft} size={20} weight="light" />
          </button>
        )}
        <div className="ql-stage" key={item.id}><Stage item={item} playerRef={playerRef} modalHandle={modalRef} /></div>
        {n > 1 && (
          <button type="button" className="ql-nav ql-next" onClick={() => go(1)} aria-label="Next file" title="Next (→)">
            <Icon as={ChevronRight} size={20} weight="light" />
          </button>
        )}
        {infoOpen && (
          <DetailPanel inline target={{ type: 'card', item }} boards={boards} canEdit={itemCanEdit}
                       onClose={onToggleInfo} onReveal={onShowOnBoard ? () => onShowOnBoard(item) : null}
                       onDelete={itemCanEdit ? onDelete : null} />
        )}
      </div>
    </div>
    </IconWeightContext.Provider>,
    document.body,
  );
}
