// The review player: the clip, full size, in a dark room —
//
//   header  title · facts (version, label, fps, size, length); the versions
//           as pills (a menu past four, or in a narrow header); Compare (pick
//           a second version — \ flips between them on the same frame);
//           shortcuts; close
//   stage   FilmPlayer mode="full" with its dock
//   rail    an optional column beside it for what's said about the clip
//           (frame comments come in through `rail`)
//
// A modal layer: the board's and Files' keys stand down while it's open, the
// player takes the keyboard while this is the top layer, and focus stays in
// here until it closes. Switching versions keeps the frame, in/out and loop.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
// A namespace import: production's modal guard may predate registerBackLayer.
import * as modalGuard from '../../lib/modalGuard.js';
import { liveVersions, currentOf, versionLabel } from '../../lib/cardVersions.js';
import { formatFps, formatLength } from '../../lib/cardInfo.js';
import { FilmPlayer } from './FilmPlayer.jsx';
import { FilmMenu } from './FilmMenu.jsx';
import { probeCardVideo } from '../../hooks/useMediaFacts.js';
import { cardLinkUrl } from '../../lib/cardLink.js';
import { downloadCardAsset } from '../../lib/cardDownload.js';
import { Icon } from '../Icon.jsx';
import { fileSharesAllowed } from '../../lib/appHost.js';
import { isShareableCard } from '../../lib/fileShares.js';
import { FileShareButton } from '../fileShare/FileShareButton.jsx';
import { X, Keyboard, SquareSplitHorizontal, ChevronDown } from '../../lib/icons.js';

// The fields a version's player needs, from a version entry or the card.
function sourceOf(card, v) {
  if (!v) return { src: card?.src, poster: card?.poster, media: card?.media || null };
  return { src: v.src, poster: v.poster || null, media: v.media || (v.src === card?.src ? card?.media : null) || null };
}

// When the version picked to show is the one being compared against, they
// trade places — showing v1 against v1 compares nothing.
export function swapCompare(nextShown, compareId, prevShown) {
  return nextShown === compareId ? prevShown : compareId;
}

const FOCUSABLE = 'button:not([disabled]), input, select, [tabindex]:not([tabindex="-1"])';
// A mouse click on the header doesn't take the focus — Space stays the
// player's, instead of clicking whatever was clicked last.
const noFocus = (e) => { if (e.pointerType === 'mouse') e.preventDefault(); };

export function FilmReview({
  card, title = '', onClose, initialVersionId = null, initialFrame = null, initialTime = null, autoPlay = true,
  rail = null, playerRef: externalRef = null, onFrameChange, markers = [], ghostMarkers = [], overlay = null, overlayLive = false,
  onAction, boardId = null, cardId = null, canEdit = false,
}) {
  const versions = useMemo(() => liveVersions(card), [card]);
  const current = useMemo(() => currentOf(card), [card]);
  const [versionId, setVersionId] = useState(initialVersionId || current?.id || null);
  const [compareId, setCompareId] = useState(null);
  const [menu, setMenu] = useState(null);
  const ownRef = useRef(null);
  const playerRef = externalRef || ownRef;
  const rootRef = useRef(null);
  const v = versions.find((x) => x.id === versionId) || current;
  const cmp = compareId ? versions.find((x) => x.id === compareId) : null;
  const a = sourceOf(card, v);
  const b = cmp ? sourceOf(card, cmp) : null;
  const many = versions.length > 1;

  // Close through a ref: an App render that hands us a new onClose must not
  // re-register the layer (that pushed a history entry each time — and a
  // board edit could navigate the browser out of the app).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const modalRef = useRef(null);
  useEffect(() => {
    const u = modalGuard.registerModalOpen({ onEscape: () => { closeRef.current?.(); return true; } });
    modalRef.current = u;
    return u;
  }, []);
  useEffect(() => modalGuard.registerBackLayer?.(() => closeRef.current?.()), []);

  // Focus comes in, stays in, and goes back where it was.
  useEffect(() => {
    const prev = document.activeElement;
    rootRef.current?.focus({ preventScroll: true });
    const onKey = (e) => {
      if (e.key !== 'Tab' || !modalGuard.isTopModal?.(modalRef.current)) return;
      // Only what's drawn: a narrow header hides the pills, a wide one the
      // menu that stands in for them.
      const els = [...(rootRef.current?.querySelectorAll(FOCUSABLE) || [])].filter((el) => el.getClientRects().length > 0);
      if (!els.length) { e.preventDefault(); return; }
      const first = els[0], last = els[els.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === rootRef.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (prev?.isConnected) { try { prev.focus({ preventScroll: true }); } catch (_) {} }
    };
  }, []);

  // Where you were, so a version switch lands on the same moment — read from
  // the player at the switch (it's playing, or paused on a frame), with the
  // in/out and loop it reported.
  const session = useRef({ time: initialTime, frame: initialFrame, range: null, looping: false, versionId: v?.id });
  const [mountSession, setMountSession] = useState({ time: initialTime, frame: initialFrame, range: null, looping: false, autoPlay });
  const showVersion = (id) => {
    if (id === v?.id) return;
    const s = session.current;
    const st = playerRef.current?.getState?.();
    const time = Number.isFinite(st?.time) ? st.time : s.time;
    setMountSession({ time, frame: null, range: s.range, looping: s.looping, autoPlay: !!st?.playing });
    setCompareId((c) => swapCompare(id, c, v?.id));
    setVersionId(id);
  };

  // A clip that won't play offers the file instead: the version on show,
  // which is the one that failed.
  const downloadShown = () => {
    const file = { ...card, src: a.src, poster: a.poster, fileName: v?.fileName || card?.fileName, mime: v?.mime || card?.mime };
    downloadCardAsset(file, 'video', { surface: 'player' }).catch(() => playerRef.current?.hud?.('Download failed'));
  };

  const handleAction = (action, payload) => {
    if (action === 'escape') { closeRef.current?.(); return; }
    if (action === 'copyLink' && boardId && cardId) {
      const p = playerRef.current;
      const t = payload?.time;
      let link = cardLinkUrl(window.location.href, boardId, cardId);
      if (Number.isFinite(t)) link += `&t=${t.toFixed(3)}`;
      if (many && v?.id) link += `&v=${encodeURIComponent(v.id)}`;
      const tc = p?.format?.(payload?.frame ?? p?.getFrame?.()) || '';
      navigator.clipboard?.writeText(link).then(() => p?.hud?.(`Link to ${tc} copied`), () => {});
      return;
    }
    onAction?.(action, payload);
  };

  const media = a.media;
  const facts = [
    many && v ? `${versionLabel(v)}${v.label ? ` · ${v.label}` : ''}` : null,
    media?.fps ? formatFps(media.fps) : null,
    media?.w && media?.h ? `${media.w}×${media.h}` : null,
    media?.dur ? formatLength(media.dur) : null,
  ].filter(Boolean).join(' · ');

  // The rows are built on every render (menuItems), so they follow the live
  // versions.
  const openMenu = (id, el, align = 'start') => {
    if (menu?.id === id) { setMenu(null); return; }
    setMenu({ id, anchor: el.getBoundingClientRect(), ignore: el, align });
  };
  const versionItems = () => [...versions].reverse().map((x) => ({
    id: x.id, label: `${versionLabel(x)}${x.label ? ` — ${x.label}` : ''}`, checked: x.id === v?.id,
    sub: [x.fileName || x.name, x.id === current?.id ? 'Current' : null].filter(Boolean).join(' · '),
    run: () => showVersion(x.id),
  }));
  const compareItems = () => [
    { header: `Compare ${versionLabel(v)} with` },
    ...[...versions].reverse().filter((x) => x.id !== v?.id).map((x) => ({
      id: x.id, label: `${versionLabel(x)}${x.label ? ` — ${x.label}` : ''}`, checked: x.id === compareId,
      sub: x.id === current?.id ? 'Current' : undefined, run: () => setCompareId(x.id),
    })),
    ...(compareId ? [{ divider: true }, { id: 'stop', label: 'Stop comparing', run: () => setCompareId(null) }] : []),
  ];
  const menuItems = { versions: versionItems, compare: compareItems };

  return createPortal(
    <div className="frv" ref={rootRef} role="dialog" aria-modal="true" aria-label={`Review: ${title}`} tabIndex={-1}>
      <div className="frv-head">
        <div className="frv-titles">
          <span className="frv-title" title={title}>{title}</span>
          {facts && <span className="frv-sub">{facts}</span>}
        </div>
        {many && versions.length <= 4 && (
          <div className="frv-pills" role="radiogroup" aria-label="Version">
            {versions.map((x) => (
              <button key={x.id} type="button" onPointerDown={noFocus} role="radio" aria-checked={x.id === v?.id}
                      className={`frv-pill${x.id === v?.id ? ' is-shown' : ''}${x.id === current?.id ? ' is-current' : ''}`}
                      title={`${versionLabel(x)}${x.label ? ` — ${x.label}` : ''}${x.id === current?.id ? ' (current)' : ''}`}
                      onClick={() => showVersion(x.id)}>
                {versionLabel(x)}
              </button>
            ))}
          </div>
        )}
        {/* More versions than pills hold: a menu; and a narrow header, which
            has no room for the pills, shows it in their place. */}
        {many && (
          <button type="button" onPointerDown={noFocus} aria-haspopup="menu" aria-label={`Version ${versionLabel(v)}`}
                  className={`frv-pill frv-pill--menu is-shown${versions.length <= 4 ? ' frv-pill--narrow' : ''}`}
                  onClick={(e) => openMenu('versions', e.currentTarget, 'center')}>
            {versionLabel(v)} <Icon as={ChevronDown} size={10} weight="bold" />
          </button>
        )}
        <div className="frv-actions">
          {many && (
            <button type="button" onPointerDown={noFocus} className={`frv-iconbtn frv-compare${compareId ? ' is-on' : ''}`} aria-haspopup="menu"
                    aria-label={compareId ? `Comparing with ${versionLabel(cmp)}` : 'Compare with another version'}
                    title={compareId ? `Comparing with ${versionLabel(cmp)} — \\ flips between them` : 'Compare with another version'}
                    onClick={(e) => openMenu('compare', e.currentTarget, 'end')}>
              <Icon as={SquareSplitHorizontal} size={18} weight="regular" />
              <span>{compareId ? `vs ${versionLabel(cmp)}` : 'Compare'}</span>
            </button>
          )}
          {fileSharesAllowed() && canEdit && boardId && cardId && isShareableCard(card) && (
            <FileShareButton variant="frv" surface="player" boardId={boardId} cardId={cardId} card={card} boardName={null} />
          )}
          <button type="button" onPointerDown={noFocus} className="frv-iconbtn" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)"
                  onClick={() => playerRef.current?.toggleHelp?.()}>
            <Icon as={Keyboard} size={18} weight="regular" />
          </button>
          <button type="button" onPointerDown={noFocus} className="frv-iconbtn" onClick={() => closeRef.current?.()} aria-label="Close" title="Close (Esc)">
            <Icon as={X} size={18} weight="regular" />
          </button>
        </div>
      </div>
      <div className={`frv-body${rail ? ' has-rail' : ''}`}>
        <div className="frv-main">
          <FilmPlayer key={`${v?.id}`} ref={playerRef} mode="full" keyboard modalHandle={modalRef}
                      autoPlay={mountSession.autoPlay}
                      initialFrame={mountSession.frame} initialTime={mountSession.time}
                      initialRange={mountSession.range} initialLooping={mountSession.looping}
                      src={a.src} poster={a.poster} media={a.media} title={title}
                      label={many ? versionLabel(v) : ''}
                      compareSrc={b?.src || null} compareMedia={b?.media || null} compareLabel={cmp ? versionLabel(cmp) : ''}
                      markers={markers} ghostMarkers={ghostMarkers} overlay={overlay} overlayLive={overlayLive}
                      onAction={handleAction} onFrameChange={onFrameChange} onDownload={a.src ? downloadShown : null}
                      canCopyLink={!!(boardId && cardId)}
                      onSessionChange={(s) => { session.current = { ...session.current, ...s }; }}
                      probe={() => probeCardVideo({ kind: 'video', src: a.src })} />
        </div>
        {rail && <aside className="frv-rail">{typeof rail === 'function' ? rail({ versionId: v?.id, player: playerRef }) : rail}</aside>}
      </div>
      {menu && (
        <FilmMenu anchor={menu.anchor} container={rootRef.current} items={menuItems[menu.id]?.() || []} label={menu.id} ignore={menu.ignore}
                  placement="below" align={menu.align} onClose={() => setMenu(null)} className="film-menu--head" />
      )}
    </div>,
    document.body,
  );
}
