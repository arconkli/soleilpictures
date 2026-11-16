// Shared cell-content machinery for container cards whose cells are universal
// content slots (image / rich text / link / video / file / board reference) —
// extracted from GridCard so the Schedule card (kind:'schedule' with a
// schedView; date-keyed slots) renders the exact same records. Everything here
// is keyed only by (cardId, cellId) + plain props — no grid layout knowledge.
//
// Reactivity note (why useCardCellsVersion exists): cell records live in
// nested Y.Maps ON the card's Y.Map, which readCards hashes to 'Y|' — so the
// card object identity does NOT change on a cell edit. A container card must
// self-observe its own nested maps to re-render on cell edits (the same
// pattern as RichDocCard).

import { useEffect, useMemo, useReducer, useState } from 'react';
import { resolveTagText, hasLabelTag } from '../../lib/gridSequence.js';
import { readableOn, remapHtmlColors } from '../../lib/readableColor.js';
import { sanitizeNoteHtml } from '../../lib/sanitizeNoteHtml.js';
import { directedHtml } from '../../lib/textDirection.js';
import { readableInk } from '../../lib/paletteLayout.js';
import { resolveSrc } from '../../lib/r2.js';
import { buildImgStyle } from '../../lib/imageAdjust.js';
import { R2Image } from '../R2Image.jsx';
import { FileCard } from './FileCard.jsx';
import { safeExternalHref } from '../../lib/safeExternalHref.js';
import { keptPicture } from '../../lib/linkPictureKeep.js';
import { ensureFontForCss } from '../../lib/googleFonts.js';
import { t } from '@lingui/core/macro';

const stop = (e) => e.stopPropagation();

// Force a re-render when any of this card's nested cell Y.Maps changes (deep).
// keys defaults to just gridCells; the Schedule card also observes gridMeta
// (its expand map). Cheap no-op in local mode (no Y type → no observer).
export function useCardCellsVersion(cardYMap, keys = ['gridCells']) {
  const [, bump] = useReducer((x) => x + 1, 0);
  const keySig = keys.join('|');
  useEffect(() => {
    if (!cardYMap || !cardYMap.get) return undefined;
    const offs = [];
    for (const key of keySig.split('|')) {
      const cm = cardYMap.get(key);
      if (!cm || typeof cm.observeDeep !== 'function') continue;
      const cb = () => bump();
      cm.observeDeep(cb);
      offs.push(() => { try { cm.unobserveDeep(cb); } catch (_) {} });
    }
    return () => offs.forEach((off) => off());
  }, [cardYMap, keySig]);
}

export function useResolvedSrc(src) {
  const [url, setUrl] = useState(src && !String(src).startsWith('r2:') ? src : null);
  useEffect(() => {
    let alive = true;
    if (!src) { setUrl(null); return; }
    if (!String(src).startsWith('r2:')) { setUrl(src); return; }
    Promise.resolve(resolveSrc(src)).then((u) => { if (alive) setUrl(u); }).catch(() => {});
    return () => { alive = false; };
  }, [src]);
  return url;
}

// Translate a resolved cell text style {fontFamily,fontSize,color,align,vAlign,bg}
// into inline CSS. vAlign uses flex so text can sit dead-center (or bottom) in
// the box; align is text-align. Typed text stays plain html and inherits this,
// so a shared-style change re-flows every un-pinned cell live. A bg paints the
// whole text box (it fills the cell body) with the ink forced readable on it —
// the same treatment a painted note gets.
export function cellTextStyle(eff) {
  if (!eff) return undefined;
  const s = {};
  if (eff.fontFamily) s.fontFamily = eff.fontFamily;
  if (eff.fontSize) s.fontSize = typeof eff.fontSize === 'number' ? `${eff.fontSize}px` : eff.fontSize;
  const bg = (eff.bg && eff.bg !== 'transparent') ? eff.bg : null;
  if (bg) {
    s.background = bg;
    s.color = eff.color ? readableOn(eff.color, bg) : readableInk(bg);
  } else if (eff.color) s.color = eff.color;
  if (eff.align) s.textAlign = eff.align;
  if (eff.vAlign && eff.vAlign !== 'top') {
    s.display = 'flex';
    s.flexDirection = 'column';
    s.justifyContent = eff.vAlign === 'center' ? 'center' : eff.vAlign === 'bottom' ? 'flex-end' : 'flex-start';
  }
  return Object.keys(s).length ? s : undefined;
}

export function CellText({ html, seqIndex, seqFormat, style, effBg }) {
  const resolved = (seqIndex != null && hasLabelTag(html))
    ? resolveTagText(html, { index: seqIndex, format: seqFormat || {} })
    : (html || '');
  // On a painted cell, remap per-span inline colors to stay legible against
  // the cell surface — the same pass a painted note's read-only html gets.
  // remapHtmlColors rewrites colours; it is NOT a sanitizer, which is why the
  // variable below used to be called `safe` while carrying live markup. Cell
  // html reaches us over the CRDT exactly like note html does, so it gets the
  // same treatment — see lib/sanitizeNoteHtml.js.
  const recolored = effBg ? remapHtmlColors(resolved, effBg) : resolved;
  const clean = useMemo(() => directedHtml(sanitizeNoteHtml(recolored)), [recolored]);
  return <div className="gc-text" style={style} dangerouslySetInnerHTML={{ __html: clean }} />;
}

export function CellVideo({ src }) {
  const url = useResolvedSrc(src);
  // Same resting play mark as a video card (styles.css .vc-badge): a paused
  // first frame reads as a photo without it. Gone while the clip plays.
  const [playing, setPlaying] = useState(false);
  if (!url) return <div className="gc-loading" aria-hidden="true" />;
  return (
    <>
      <video className="gc-video" src={url} controls preload="metadata" onPointerDown={stop}
             onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
      {!playing && (
        <span className="gc-video-badge" aria-hidden="true">
          <svg width="10" height="10" viewBox="0 0 24 24"><path d="M7 4.8v14.4a1 1 0 0 0 1.53.85l11.2-7.2a1 1 0 0 0 0-1.7L8.53 3.95A1 1 0 0 0 7 4.8Z" fill="currentColor" /></svg>
        </span>
      )}
    </>
  );
}

// Mounted by R2Image when it has given up on a picture (its 'none' state), to
// hand the card back to the site's own copy of it.
function PictureGone({ onGone }) {
  useEffect(() => { onGone(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

// A link's picture (link cards and link cells). Drawn from our own copy when
// there is one and it is the picture the card shows (lib/linkPictureKeep.js),
// through the same progressive path as an image card; `fallback` — the site's
// own picture, exactly as it was drawn before copies — is what shows when there
// is no copy yet, and when the copy cannot be drawn (the browser refuses it, or
// the copy cannot be signed for this viewer: a share bundle made before it
// existed, a card copied into a workspace that cannot read it).
export function LinkPicture({ image, imageKey, imageKeyOf, w, h, cardId, boardId = null, backfillEnabled = false, className, fallback }) {
  const kept = keptPicture({ image, imageKey, imageKeyOf });
  // The copy that failed, so a fresh copy of a changed picture is tried again.
  const [broken, setBroken] = useState(null);
  if (!kept || broken === kept) return fallback;
  return (
    <R2Image
      progressive
      src={kept}
      w={w}
      h={h}
      fit="cover"
      cardId={cardId}
      boardId={boardId}
      backfillEnabled={backfillEnabled}
      draggable="false"
      className={className}
      onError={() => setBroken(kept)}
      placeholder={(state) => (state === 'none'
        ? <PictureGone onGone={() => setBroken(kept)} />
        : <div className="r2p-layer r2-img-loading" />)}
    />
  );
}

export function CellContent({ cell, rect, seqIndex, seqFormat, boards, onOpenBoard, textStyle, effBg = null, cardId, cellId, compare = false }) {
  // A cell or family style can name a Google font; load it for every viewer,
  // not only the author who picked it (audit NOTES-10, grid cells).
  const cellFont = textStyle?.fontFamily;
  useEffect(() => { if (cellFont) { try { ensureFontForCss(cellFont); } catch (_) {} } }, [cellFont]);
  const type = cell?.type || 'empty';
  if (type === 'board' && cell.boardId) {
    const b = boards?.[cell.boardId];
    const missing = !b;                                  // referenced cluster was deleted
    const name = b?.name || cell.name || t`Cluster`;      // cell.name = snapshot at drop
    return (
      <button type="button" className={`gc-board${missing ? ' is-missing' : ''}`} onPointerDown={stop}
        onClick={(e) => { e.stopPropagation(); if (!missing) onOpenBoard?.(cell.boardId); }}
        disabled={missing}
        title={missing ? t`This cluster was removed` : t`Open ${name}`}>
        {b?.thumb_key
          ? <R2Image key={b.thumb_updated_at || b.thumb_key} src={b.thumb_key} bust={b.thumb_updated_at} w={Math.round(rect.w)} h={Math.round(rect.h)} className="gc-board-thumb" draggable="false" />
          : <span className="gc-board-ph" aria-hidden="true" />}
        <span className="gc-board-meta">
          <span className="gc-board-badge">{missing ? t`REMOVED` : t`CLUSTER`}</span>
          <span className="gc-board-name">{missing ? t`${name} (removed)` : name}</span>
        </span>
      </button>
    );
  }
  if (type === 'image' && cell.src) {
    // Full image controls: object-fit (Fill/Fit) + object-position (Reposition) +
    // zoom (scale, cropping around the focal point) + non-destructive photo
    // adjustments (buildImgStyle → CSS filter/flip, byte-identical to a standalone
    // image card). `compare` nulls the adjust so a hold-to-compare shows the source.
    const objPos = cell.pos ? `${cell.pos.x}% ${cell.pos.y}%` : 'center';
    const base = buildImgStyle(compare ? null : cell.adjust, `${cardId}:${cellId}`) || {};
    // Zoom-crop only applies in Fill (cover) — in Fit (contain) the whole image
    // must fit, so ignore the stored zoom (it's preserved for switching back).
    const z = (cell.fit !== 'contain' && Number(cell.zoom) > 1) ? Number(cell.zoom) : 0;
    const transform = [base.transform, z ? `scale(${z})` : ''].filter(Boolean).join(' ');
    const style = {
      objectFit: cell.fit === 'contain' ? 'contain' : 'cover',
      objectPosition: objPos,
      ...(base.filter ? { filter: base.filter } : {}),
      ...(transform ? { transform, transformOrigin: objPos } : {}),
    };
    // The progressive path, like a standalone image card: a quick xs paint,
    // then the rung the cell's drawn size needs (tierScale counts the crop
    // zoom), climbed by the image-tier scheduler. The .r2p wrapper takes
    // gc-img and the whole style; its transform scales the same 100%×100% box
    // the old <img> was, and .gridc-cell-body still clips it. object-fit and
    // object-position go on the picture layers themselves (imgStyle).
    return (
      <R2Image
        progressive
        src={cell.src}
        w={Math.round(rect.w)}
        h={Math.round(rect.h)}
        fit={cell.fit === 'contain' ? 'contain' : 'cover'}
        tierScale={z || 1}
        imgStyle={{ objectFit: style.objectFit, objectPosition: style.objectPosition }}
        // A preview with no card (the cluster browser's mini grid) stays off
        // the scheduler: it mounts on the rung its size needs and stays there.
        cardId={cardId && cellId ? `${cardId}:${cellId}` : undefined}
        draggable="false"
        className="gc-img"
        style={style}
      />
    );
  }
  if (type === 'text') return <CellText html={cell.html} seqIndex={seqIndex} seqFormat={seqFormat} style={textStyle} effBg={effBg} />;
  if (type === 'link') {
    return (
      <a className="gc-link" href={safeExternalHref(cell.source || cell.link) || '#'} target="_blank" rel="noreferrer" onClick={stop}>
        {cell.image ? (
          <LinkPicture
            image={cell.image}
            imageKey={cell.imageKey}
            imageKeyOf={cell.imageKeyOf}
            w={Math.round(rect.w)}
            h={Math.round(rect.h)}
            // As the image cell above: a preview with no card stays off the scheduler.
            cardId={cardId && cellId ? `${cardId}:${cellId}` : undefined}
            className="gc-link-img"
            fallback={<img className="gc-link-img" src={cell.image} alt="" draggable="false" />}
          />
        ) : null}
        <span className="gc-link-meta">
          {cell.favicon ? <img className="gc-link-fav" src={cell.favicon} alt="" /> : null}
          <span className="gc-link-title">{cell.title || cell.source || cell.link}</span>
        </span>
      </a>
    );
  }
  if (type === 'video' && cell.src) return <CellVideo src={cell.src} />;
  if (type === 'file') {
    return <FileCard fileSrc={cell.fileSrc} fileName={cell.fileName} mime={cell.mime} sizeBytes={cell.sizeBytes} ext={cell.ext} title={cell.title} onUpdate={null}
                     w={Math.round(rect.w)} h={Math.round(rect.h)} pageCount={cell.pageCount} itemCount={cell.itemCount} />;
  }
  return null; // empty cell — placeholder/chooser drawn by the wrapper
}
