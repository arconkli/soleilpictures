import { memo, useMemo } from 'react';
import { CardPreview } from './CardPreview.jsx';
import { Avatar } from '../primitives.jsx';
import { humanSize } from '../cards/FileCard.jsx';
import { relativeTimeShort } from '../../lib/relativeTime.js';
import { Icon } from '../Icon.jsx';
import { Download } from '../../lib/icons.js';
import { DOWNLOADABLE } from '../../lib/cardAssetName.js';
import { peaksFromBase64, peaksToPath, peaksPathWidth } from '../../lib/audioAnalysis.js';
import { formatDuration, formatKey } from '../../lib/loopMeta.js';

// A 64×18 waveform for the row, from the SAME stored peaks the card draws.
// Every other bucket, because at this width 96 bars is a smear.
//
// One <path>, not one <rect> per bar — a 400-loop pack would otherwise be
// ~19,000 SVG nodes and the list would stop scrolling.
function RowWave({ peaks: peaksB64 }) {
  const path = useMemo(() => {
    const p = peaksFromBase64(peaksB64);
    if (!p) return null;
    const thinned = p.filter((_, i) => i % 2 === 0);
    return { d: peaksToPath(thinned, { height: 18, barWidth: 1, gap: 1, minHeight: 1 }),
             w: peaksPathWidth(thinned.length, { barWidth: 1, gap: 1 }) };
  }, [peaksB64]);
  if (!path?.d) return null;
  return (
    <svg className="ct-wave" viewBox={`0 0 ${path.w} 18`} preserveAspectRatio="none" aria-hidden="true">
      <path d={path.d} />
    </svg>
  );
}

// One dense table row: preview thumbnail + name/sub, type, size, date, and a
// live presence tag (a peer's color bar + avatar when they have this card open).
//
// For audio rows the thumbnail doubles as a play button and the name cell
// carries a mini waveform, so a pack can be auditioned without leaving the
// table. The download button shares the presence cell, which is empty for all
// but the handful of cards a collaborator has open — so it costs no layout.
export const ClusterRow = memo(function ClusterRow({
  item, selected, isNew, peers, dateKey = 'updated', onClick, onDoubleClick, member = false,
  onDownload = null, onAudition = null, active = false, playing = false, rowRef = null,
  audioMode = false,
}) {
  const peer = peers && peers[0];
  const dateVal = dateKey === 'created' ? item.createdAt : item.updatedAt;
  const canDownload = !!onDownload && !item.pending && DOWNLOADABLE.has(item.kind);
  const canAudition = !!onAudition && item.kind === 'audio' && !item.pending;
  return (
    <div
      ref={rowRef}
      className={`ct-row${member ? ' ct-member' : ''}${selected ? ' is-selected' : ''}${isNew ? ' is-new' : ''}${item.pending ? ' is-pending' : ''}${peer ? ' is-peer' : ''}${active ? ' is-active' : ''}${playing ? ' is-playing' : ''}`}
      style={peer ? { '--peer-color': peer.user.color } : undefined}
      role="row"
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      <div role="cell" className="ct-cell ct-c-name">
        <div className={`ct-thumb${canAudition ? ' is-audio' : ''}`}>
          <CardPreview item={item} size="row" />
          {item.pending && <span className="ct-thumb-spin" aria-hidden="true" />}
          {canAudition && (
            <button type="button" className="ct-play"
                    aria-label={playing ? `Pause ${item.name}` : `Play ${item.name}`}
                    title={playing ? 'Pause' : 'Play'}
                    onClick={(e) => { e.stopPropagation(); onAudition(item); }}>
              {playing ? (
                <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true">
                  <rect x="4" y="3" width="3" height="10" rx="0.8" fill="currentColor" />
                  <rect x="9" y="3" width="3" height="10" rx="0.8" fill="currentColor" />
                </svg>
              ) : (
                <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M5 3.3 L12 8 L5 12.7 Z" fill="currentColor" />
                </svg>
              )}
            </button>
          )}
        </div>
        <div className="ct-name-wrap">
          <div className="ct-name" title={item.name}>{item.name}</div>
          {/* In loop-browser mode these same values have their own columns, so
              the folded line is hidden on a wide screen — and it is the only
              way to show them on a phone, where four mono columns truncate
              "F♯ min" to "F♯ m…". CSS decides which of the two survives at a
              given width; the markup carries both. */}
          {item.sub && <div className={`ct-sub${audioMode ? ' ct-sub-folded' : ''}`}>{item.sub}</div>}
        </div>
        {item.kind === 'audio' && <RowWave peaks={item.card?.peaks} />}
      </div>
      {audioMode ? (
        <>
          <div role="cell" className="ct-cell ct-c-dur">{formatDuration(item.durationSec)}</div>
          <div role="cell" className="ct-cell ct-c-bpm">{item.bpm != null ? item.bpm : ''}</div>
          <div role="cell" className="ct-cell ct-c-key">{formatKey(item.musicalKey)}</div>
          <div role="cell" className="ct-cell ct-c-fmt">{item.format || item.typeLabel}</div>
        </>
      ) : (
        <>
          <div role="cell" className="ct-cell ct-c-type">{item.typeLabel}</div>
          <div role="cell" className="ct-cell ct-c-size">{item.sizeBytes != null ? humanSize(item.sizeBytes) : ''}</div>
        </>
      )}
      <div role="cell" className="ct-cell ct-c-date">{item.pending ? 'Uploading…' : (dateVal ? relativeTimeShort(dateVal) : '')}</div>
      <div role="cell" className="ct-cell ct-c-presence">
        {peers && peers.slice(0, 2).map((pp, i) => (
          <Avatar key={pp.user.id || i} name={pp.user.name} color={pp.user.color} size={18} ring />
        ))}
        {canDownload && !peer && (
          <button type="button" className="ct-dl" title={`Download ${item.name}`}
                  aria-label={`Download ${item.name}`}
                  onClick={(e) => { e.stopPropagation(); onDownload(item); }}>
            <Icon as={Download} size={13} />
          </button>
        )}
      </div>
    </div>
  );
});
