// What a card says while its file is on its way, drawn once by CanvasSurface
// beside the card's own component (so no card kind carries its own copy).
// Your own upload reads from lib/activity.js; a teammate's from presence
// (lib/peerUploads.js). Words: lib/activityWords.js and the peer table in
// peerUploads. Sizes are screen pixels at any zoom: the strip is laid out
// `scale` times wider and shrunk back by the same factor. Three tiers by
// on-screen size: full (>= 150 x 96), compact (>= 72 x 40: one line, icon
// buttons), tiny (a 2px track only); under 24px nothing.

import { memo, useSyncExternalStore } from 'react';
import { Icon } from '../Icon.jsx';
import { Clock, Warning, ArrowClockwise, Trash2, UploadSimple, X } from '../../lib/icons.js';
import { transferForCard } from '../../lib/activity.js';
import { cardTransferWords, awayWords } from '../../lib/activityWords.js';
import { useCardTransferKey } from '../../hooks/useActivity.js';
import { useCanvasSettleTick } from '../../hooks/useCanvasSettleTick.js';
import { getCanvasScale } from '../../lib/canvasScale.js';
import { initialOf } from '../../lib/graphemes.js';
import './cardTransferState.css';

const noopSubscribe = () => () => {};
const PICTURE_KINDS = new Set(['image', 'video']);

const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || 'Someone';

// Presence codes (peerUploads): 0..100 percent, -1 waiting, -2 didn't upload,
// -3 making a preview.
function mateWords(v) {
  if (v.kind === 'away') {
    const w = awayWords({ name: firstName(v.name), mine: v.mine });
    return { ...w, mate: v.mine ? null : v };
  }
  const name = firstName(v.name);
  const lead = v.mine ? 'Uploading in another tab' : `${name} is uploading`;
  if (v.code === -3) return { tone: 'busy', text: 'Making a preview…', sub: null, pct: null };
  if (v.code === -2) return { tone: 'fail', text: 'Didn’t upload', sub: null, pct: null };
  if (v.code < 0) return { tone: 'wait', text: lead, sub: 'Waiting', pct: null, mate: v.mine ? null : v };
  const pct = Math.min(100, v.code);
  return { tone: 'up', text: lead, sub: `${pct}%`, pct, mate: v.mine ? null : v };
}

const Avatar = ({ name, color }) => (
  <span className="presence-dot cts-av" style={{ background: color }} aria-hidden="true">
    {initialOf(name)}
  </span>
);

export const CardTransferState = memo(function CardTransferState({
  cardId, kind, w, h, pending, createdBy, createdAt, canEdit, me, peers,
  onRetry, onRemove, onPickReplace,
}) {
  // Your own upload: re-renders when its state, percent or time left moves.
  useCardTransferKey(cardId);
  useCanvasSettleTick();
  const item = transferForCard(cardId);
  const card = {
    id: cardId, createdBy,
    createdAt: typeof createdAt === 'number' ? new Date(createdAt).toISOString() : createdAt,
  };
  useSyncExternalStore(
    peers && !item ? peers.subscribe : noopSubscribe,
    () => (peers && !item ? peers.viewKey(card) : ''),
  );

  const s = getCanvasScale() || 1;
  const sw = w * s;
  const sh = h * s;
  if (Math.min(sw, sh) < 24) return null;
  const full = sw >= 150 && sh >= 96;
  const compact = !full && sw >= 72 && sh >= 40;
  const tiny = !full && !compact;

  let words = null;
  let gone = null;
  // The picture treatment is for my own transfer in this tab (it has a local
  // preview); every other state reads plain.
  let ownPicture = false;
  if (item) {
    words = cardTransferWords(item, Date.now());
    ownPicture = PICTURE_KINDS.has(kind);
  } else if (peers && pending) {
    const v = peers.view(card);
    if (v.kind === 'mate' || v.kind === 'away') words = mateWords(v);
    else if (v.kind === 'legacy') words = { tone: 'up', text: `${firstName(v.name)} is uploading`, sub: null, pct: null, mate: v };
    else if (v.kind === 'quiet') words = { tone: 'up', text: 'Uploading…', sub: null, pct: null };
    else gone = v;
  }
  if (!words && !gone) return null;

  const strip = { transform: `scale(${1 / s})`, width: sw };
  const stop = (e) => e.stopPropagation();

  if (gone) {
    const canReplace = gone.mine && canEdit && !!onPickReplace;
    const bigGone = sw >= 200 && sh >= 140;
    if (!bigGone && !tiny) {
      return (
        <div className="cts" data-cts="gone" role="group" aria-label="This upload didn’t finish">
          <div className="cts-strip is-compact is-gone" style={strip}>
            <div className="cts-txt" aria-hidden="true">
              <span className="cts-ic"><span className="cts-line1">Didn’t finish</span></span>
            </div>
          </div>
          {canEdit && (
            <div className="cts-ibwrap" style={{ transform: `scale(${1 / s})`, width: sw }}>
              {canReplace && (
                <button type="button" className="cts-ib is-2" aria-label="Replace this file" title="Replace"
                        onPointerDown={stop} onClick={(e) => { stop(e); onPickReplace(cardId); }}>
                  <Icon as={UploadSimple} size={13} weight="regular" />
                </button>
              )}
              <button type="button" className="cts-ib" aria-label="Remove this card" title="Remove"
                      onPointerDown={stop} onClick={(e) => { stop(e); onRemove?.(cardId); }}>
                <Icon as={Trash2} size={13} weight="regular" />
              </button>
            </div>
          )}
        </div>
      );
    }
    return (
      <div className="cts" data-cts="gone" role="group" aria-label="This upload didn’t finish">
        {tiny ? (
          <div className="cts-strip is-bare" style={strip}>
            <span className="cts-line is-fail"><i style={{ width: '100%' }} /></span>
          </div>
        ) : (
          <div className="cts-gone" style={{ transform: `scale(${1 / s})`, width: sw, height: sh }}>
            <span className="cts-gone-txt">This upload didn’t finish</span>
            {canEdit && (
              <span className="cts-gone-btns">
                {canReplace && (
                  <button type="button" className="cts-tb" aria-label="Replace this file"
                          onPointerDown={stop} onClick={(e) => { stop(e); onPickReplace(cardId); }}>Replace</button>
                )}
                <button type="button" className="cts-tb" aria-label="Remove this card"
                        onPointerDown={stop} onClick={(e) => { stop(e); onRemove?.(cardId); }}>Remove</button>
              </span>
            )}
          </div>
        )}
      </div>
    );
  }

  const fail = words.tone === 'fail';
  // A new version of the card's file: the card itself is fine and stays, so Retry runs the
  // item's own retry (the card-level one is for dropped cards) and the × only clears the row.
  // Never Remove, never the "didn’t finish" state: those delete the card.
  const isVersion = !!item?.version;
  const showRetry = !!item && item.state === 'failed' && !!item.actions?.retry;
  const scrim = !ownPicture ? null : (words.tone === 'wait' || fail) ? .6 : .38;
  const text = words.text;

  return (
    <div className={`cts${ownPicture ? ' is-pic' : ''}`} data-cts={words.tone} role="group" aria-label={words.text}>
      {scrim != null && <div className="cts-scrim" style={{ background: `rgba(8, 8, 10, ${scrim})` }} />}
      <div className={`cts-strip${fail ? ' is-fail' : ''}${words.mate ? ' is-mate' : ''}${tiny ? ' is-bare' : ''}${compact ? ' is-compact' : ''}`} style={strip}>
        {!tiny && (
          <div className="cts-txt" aria-hidden="true">
            <span className={`cts-ic${fail ? ' cts-err' : ''}`}>
              {words.mate && <Avatar name={words.mate.name} color={words.mate.color} />}
              {words.tone === 'wait' && !words.mate && <Icon as={Clock} size={13} weight="regular" />}
              {fail && <Icon as={Warning} size={13} weight="regular" />}
              <span className="cts-line1">{text}</span>
            </span>
            {full && words.sub && <span className="cts-sub">{words.sub}</span>}
          </div>
        )}
        {(words.pct != null || tiny) && (
          <span className={`cts-line${fail ? ' is-fail' : ''}${words.pct == null ? ' is-idle' : ''}`}>
            {(words.pct != null || (fail && tiny)) && <i style={{ width: `${fail ? 100 : words.pct}%` }} />}
          </span>
        )}
      </div>
      {showRetry && !tiny && (
        <div className="cts-ibwrap" style={{ transform: `scale(${1 / s})`, width: sw }}>
          {isVersion && !!item.actions?.remove && (
            <button type="button" className="cts-ib" aria-label="Dismiss" title="Dismiss"
                    onPointerDown={stop} onClick={(e) => { stop(e); item.actions.remove(); }}>
              <Icon as={X} size={13} weight="regular" />
            </button>
          )}
          <button type="button" className={`cts-ib${isVersion && item.actions?.remove ? ' is-2' : ''}`} aria-label="Retry this upload" title="Retry"
                  onPointerDown={stop}
                  onClick={(e) => { stop(e); if (isVersion) item.actions.retry(); else onRetry?.(cardId); }}>
            <Icon as={ArrowClockwise} size={13} weight="regular" />
          </button>
        </div>
      )}
    </div>
  );
});
