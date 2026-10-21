import { memo, useMemo } from 'react';
import { CardPreview } from './CardPreview.jsx';
import { Avatar } from '../primitives.jsx';
import { humanSize } from '../cards/FileCard.jsx';
import { relativeTimeShort } from '../../lib/relativeTime.js';
import { Icon } from '../Icon.jsx';
import { Download, Check } from '../../lib/icons.js';
import { DOWNLOADABLE } from '../../lib/cardAssetName.js';
import { InlineRename } from './InlineRename.jsx';
import { peaksFromBase64, peaksToPath, peaksPathWidth } from '../../lib/audioAnalysis.js';
import { formatDuration, formatKey } from '../../lib/loopMeta.js';
import { kindLabelOf, lengthLabelOf } from '../../lib/filesView.js';
import { KindGlyph } from '../sidebar/ClusterShelves.jsx';

// The row's waveform, from the SAME stored peaks the card draws. Every other
// bucket: at this width 96 bars is a smear.
//
// One <path> per layer, not one <rect> per bar — a 400-loop pack would
// otherwise be ~19,000 SVG nodes and the list would stop scrolling.
//
// Two layers, because the waveform is the transport rather than a decoration:
// the second is clipped to `--ct-progress`, which ListSurface writes onto the
// row element from `timeupdate`. A CSS `clip-path: inset()` rather than a
// transform, so the global prefers-reduced-motion rule — `transform: none
// !important` — cannot pin the fill at full width.
function RowWave({ peaks: peaksB64, onSeek }) {
  const path = useMemo(() => {
    const p = peaksFromBase64(peaksB64);
    if (!p) return null;
    const thinned = p.filter((_, i) => i % 2 === 0);
    return { d: peaksToPath(thinned, { height: 18, barWidth: 1, gap: 1, minHeight: 1 }),
             w: peaksPathWidth(thinned.length, { barWidth: 1, gap: 1 }) };
  }, [peaksB64]);
  if (!path?.d) return null;
  const seek = onSeek ? (e) => {
    // Even on the sounding row a modified click is a selection gesture, and
    // has to reach the row: otherwise ⇧-click breaks wherever the range
    // happens to cross the playing loop.
    if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width > 0) onSeek(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
  } : undefined;
  return (
    <svg className={`ct-wave${onSeek ? ' is-seekable' : ''}`}
         viewBox={`0 0 ${path.w} 18`} preserveAspectRatio="none"
         onClick={seek} aria-hidden="true">
      <path className="ct-wave-base" d={path.d} />
      <path className="ct-wave-fill" d={path.d} />
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
  onDownload = null, onAudition = null, onSeek = null, active = false, playing = false, rowRef = null,
  audioMode = false, draggable = false, onBoard = false,
  rename = null,   // inline rename: { onCommit, onCancel }
  markUnplaced = false,   // mark files that aren't on the board (lib/placement.js)
  rowIndex = undefined,   // its place among all rows, when the table mounts only some
  checks = false,   // Select is picking several: a check says which are in
  // A shelf's row on the Files page in the files sidebar's look: where it
  // stands is said in the last column, in words, not as a pill by its name.
  bare = false,
  // A row of that page's List (Finder's table): the same words, a file's
  // size and never a length, and every other row faintly shaded (zebra).
  classic = false, zebra = false,
}) {
  const words = bare || classic;
  const peer = peers && peers[0];
  const dateVal = dateKey === 'created' ? item.createdAt : item.updatedAt;
  const canDownload = !!onDownload && !item.pending && DOWNLOADABLE.has(item.kind);
  const canAudition = !!onAudition && item.kind === 'audio' && !item.pending;
  // An audio row with nothing to show in the thumbnail. CardPreview falls back
  // to a glyph in that case, and twenty-six identical headphones down a page
  // repeat what the Format column already says — so the transport takes the
  // space instead. See .ct-thumb.is-bare.
  const bareAudio = canAudition && item.preview?.mode === 'icon';
  // On that page a file with no picture of its own is drawn as the sidebar's
  // card draws it: its quiet glyph, with no box.
  const glyphOnly = words && !item.pending && !bareAudio && item.preview?.mode !== 'r2';
  // On a shelf a row's size says what matters about it: how long a clip
  // runs, how big a file is, where a link goes. In the List it is the size.
  const bytes = Number.isFinite(item.sizeBytes) && item.sizeBytes > 0 ? humanSize(item.sizeBytes) : '';
  const sizeText = classic ? bytes
    : bare ? (lengthLabelOf(item) || bytes || (item.kind === 'link' ? (item.sub || '') : ''))
    : (item.sizeBytes != null ? humanSize(item.sizeBytes) : '');
  return (
    <div
      ref={rowRef}
      className={`ct-row${member ? ' ct-member' : ''}${selected ? ' is-selected' : ''}${isNew ? ' is-new' : ''}${item.pending ? ' is-pending' : ''}${peer ? ' is-peer' : ''}${active ? ' is-active' : ''}${playing ? ' is-playing' : ''}${zebra ? ' is-zebra' : ''}`}
      data-item-id={item.id}
      style={peer ? { '--peer-color': peer.user.color } : undefined}
      role="row" aria-rowindex={rowIndex}
      draggable={draggable && !item.pending && !rename ? true : undefined}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      <div role="cell" className="ct-cell ct-c-name">
        {checks && <span className="row-check" aria-hidden="true"><Icon as={Check} size={11} weight="bold" /></span>}
        <div className={`ct-thumb${canAudition ? ' is-audio' : ''}${bareAudio ? ' is-bare' : ''}${glyphOnly ? ' is-glyph' : ''}`}>
          {glyphOnly
            ? <KindGlyph kind={item.kind} ext={item.preview?.ext || item.ext} mime={item.preview?.mime} />
            : <CardPreview item={item} size="row" />}
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
          {rename
            ? <InlineRename value={item.name} onCommit={rename.onCommit} onCancel={rename.onCancel} className="ct-row-rename" />
            : <div className="ct-name" title={item.name}>{item.name}{item.version && <span className="ct-version-chip" title="Versions are in Info">{item.version}</span>}</div>}
          {/* In loop-browser mode these same values have their own columns, so
              the folded line is hidden on a wide screen — and it is the only
              way to show them on a phone, where four mono columns truncate
              "F♯ min" to "F♯ m…". CSS decides which of the two survives at a
              given width; the markup carries both. */}
          {item.sub
            ? <div className={`ct-sub${audioMode ? ' ct-sub-folded' : ''}`}>{item.sub}</div>
            : !audioMode && (
              // Beside the board the Type and Size columns don't fit; this
              // carries them under the name there (and only there).
              <div className="ct-sub ct-sub-meta">
                {[item.typeLabel, Number.isFinite(item.sizeBytes) && item.sizeBytes > 0 ? humanSize(item.sizeBytes) : null].filter(Boolean).join(' · ')}
              </div>
            )}
        </div>
        {!words && onBoard && <span className="ct-onboard" title="A copy of this file is already on the board">On board</span>}
        {!words && markUnplaced && item.unplaced && <span className="ct-onboard is-off" title="In this cluster, not on its board yet">Not on board</span>}
        {item.kind === 'audio' && (
          // Scrubbing is live only while THIS row is the one sounding. The
          // waveform is 240px of a 620px name cell, so making it a transport
          // at rest would mean most of the row's width no longer selects —
          // and selection is what drives the detail panel and the download.
          // Gold and moving is what says "this one you can aim at".
          <RowWave peaks={item.card?.peaks}
                   onSeek={playing && onSeek ? ((f) => onSeek(item, f)) : null} />
        )}
      </div>
      {audioMode ? (
        <>
          <div role="cell" className="ct-cell ct-c-dur">{formatDuration(item.durationSec)}</div>
          {/* An em dash rather than a blank: half a pack with no tempo reads as
              a broken column, and "not set yet" is something you can go and fix
              by typing it on the card. */}
          <div role="cell" className="ct-cell ct-c-bpm">{item.bpm != null ? item.bpm : <span className="ct-nil">—</span>}</div>
          <div role="cell" className="ct-cell ct-c-key">{formatKey(item.musicalKey) || <span className="ct-nil">—</span>}</div>
          <div role="cell" className="ct-cell ct-c-fmt">{item.format || item.typeLabel}</div>
        </>
      ) : (
        <>
          <div role="cell" className="ct-cell ct-c-type">{words ? kindLabelOf(item) : item.typeLabel}</div>
          <div role="cell" className="ct-cell ct-c-size">{sizeText}</div>
        </>
      )}
      <div role="cell" className="ct-cell ct-c-date">{item.pending ? 'Uploading…' : (dateVal ? relativeTimeShort(dateVal) : '')}</div>
      <div role="cell" className="ct-cell ct-c-presence">
        {words ? (peer ? (
          <>
            <Avatar name={peer.user.name} color={peer.user.color} size={18} ring />
            <span className="ct-status">{(peer.user.name || '').split(/\s+/)[0] || 'Someone'} has it selected</span>
          </>
        ) : markUnplaced && item.unplaced ? (
          <><span className="ct-stored" aria-hidden="true" /><span className="ct-status">Not on board</span></>
        ) : onBoard ? <span className="ct-status">On board</span> : null)
          : peers && peers.slice(0, 2).map((pp, i) => (
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
