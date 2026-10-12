// The review player: a video, full size, with everything FilmPlayer's full
// mode has, the file's versions (pick one; flip A/B against another at the
// same frame with \), and a rail beside it for what's said about it — frame
// comments come in through `rail`.
//
// A modal: it registers with the modal guard, so the board's and Files' keys
// stand down while it's open, and it takes the keyboard (capture phase).
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
// A namespace import: production's modal guard may predate registerBackLayer.
import * as modalGuard from '../../lib/modalGuard.js';
import { liveVersions, currentOf, versionLabel } from '../../lib/cardVersions.js';
import { FilmPlayer } from './FilmPlayer.jsx';
import { probeCardVideo } from '../../hooks/useMediaFacts.js';
import { Icon } from '../Icon.jsx';
import { X, Info } from '../../lib/icons.js';

// The fields a version's player needs, from a version entry or the card.
function sourceOf(card, v) {
  if (!v) return { src: card?.src, poster: card?.poster, media: card?.media || null };
  return { src: v.src, poster: v.poster || null, media: v.media || (v.src === card?.src ? card?.media : null) || null };
}

export function FilmReview({
  card, title = '', onClose, initialVersionId = null, initialFrame = null,
  rail = null, onInfo = null, playerRef: externalRef = null, onFrameChange, markers = [], ghostMarkers = [], overlay = null, onAction,
}) {
  const versions = useMemo(() => liveVersions(card), [card]);
  const current = useMemo(() => currentOf(card), [card]);
  const [versionId, setVersionId] = useState(initialVersionId || current?.id || null);
  const [compareId, setCompareId] = useState(null);
  const ownRef = useRef(null);
  const playerRef = externalRef || ownRef;
  const v = versions.find((x) => x.id === versionId) || current;
  const cmp = compareId ? versions.find((x) => x.id === compareId) : null;
  const a = sourceOf(card, v);
  const b = cmp ? sourceOf(card, cmp) : null;

  useEffect(() => modalGuard.registerModalOpen({ onEscape: () => { onClose?.(); return true; } }), [onClose]);
  useEffect(() => modalGuard.registerBackLayer?.(() => onClose?.()), [onClose]);

  // Land on the asked-for frame once the player can seek.
  const landed = useRef(false);
  useEffect(() => {
    if (initialFrame == null || landed.current) return undefined;
    let tries = 0;
    const t = setInterval(() => {
      const p = playerRef.current;
      const el = p?.element?.();
      if (p && el && el.readyState >= 1 && p.getFps()) {
        p.seekFrame(initialFrame);
        landed.current = true;
        clearInterval(t);
      } else if (++tries > 100) clearInterval(t);
    }, 50);
    return () => clearInterval(t);
  }, [initialFrame, playerRef]);

  const handleAction = (action, payload) => {
    if (action === 'escape') { onClose?.(); return; }
    onAction?.(action, payload);
  };

  const versionPicker = versions.length > 1 && (
    <div className="frv-versions">
      <label className="frv-pick">
        <span className="frv-pick-k">Version</span>
        <select value={v?.id || ''} onChange={(e) => setVersionId(e.target.value)} aria-label="Version to play">
          {[...versions].reverse().map((x) => (
            <option key={x.id} value={x.id}>{versionLabel(x)}{x.label ? ` — ${x.label}` : ''}{x.id === current?.id ? ' (current)' : ''}</option>
          ))}
        </select>
      </label>
      <label className="frv-pick">
        <span className="frv-pick-k">Compare</span>
        <select value={compareId || ''} onChange={(e) => setCompareId(e.target.value || null)} aria-label="Version to compare with" title="Flip between them with \\">
          <option value="">None</option>
          {[...versions].reverse().filter((x) => x.id !== v?.id).map((x) => (
            <option key={x.id} value={x.id}>{versionLabel(x)}{x.label ? ` — ${x.label}` : ''}</option>
          ))}
        </select>
      </label>
    </div>
  );

  return createPortal(
    <div className="frv" role="dialog" aria-modal="true" aria-label={`Review: ${title}`}>
      <div className="frv-head">
        <div className="frv-titles">
          <span className="frv-title" title={title}>{title}</span>
          {v && versions.length > 1 && <span className="frv-sub">{versionLabel(v)}{v.label ? ` — ${v.label}` : ''}</span>}
        </div>
        {versionPicker}
        {onInfo && (
          <button type="button" className="frv-iconbtn" onClick={onInfo} aria-label="Info" title="Info">
            <Icon as={Info} size={16} />
          </button>
        )}
        <button type="button" className="frv-iconbtn" onClick={onClose} aria-label="Close" title="Close (Esc)">
          <Icon as={X} size={16} />
        </button>
      </div>
      <div className={`frv-body${rail ? ' has-rail' : ''}`}>
        <div className="frv-main">
          <FilmPlayer key={`${v?.id}`} ref={playerRef} mode="full" keyboard autoPlay={initialFrame == null}
                      src={a.src} poster={a.poster} media={a.media} title={title}
                      label={versions.length > 1 ? versionLabel(v) : ''}
                      compareSrc={b?.src || null} compareLabel={cmp ? versionLabel(cmp) : ''}
                      markers={markers} ghostMarkers={ghostMarkers} overlay={overlay}
                      onAction={handleAction} onFrameChange={onFrameChange}
                      probe={() => probeCardVideo({ kind: 'video', src: a.src })} />
        </div>
        {rail && <aside className="frv-rail">{typeof rail === 'function' ? rail({ versionId: v?.id, player: playerRef }) : rail}</aside>}
      </div>
    </div>,
    document.body,
  );
}
