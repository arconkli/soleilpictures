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

import { useEffect, useReducer, useState } from 'react';
import { resolveTagText, hasLabelTag } from '../../lib/gridSequence.js';
import { readableOn, remapHtmlColors } from '../../lib/readableColor.js';
import { readableInk } from '../../lib/paletteLayout.js';
import { resolveSrc } from '../../lib/r2.js';
import { buildImgStyle } from '../../lib/imageAdjust.js';
import { R2Image } from '../R2Image.jsx';
import { FileCard } from './FileCard.jsx';

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
  const safe = effBg ? remapHtmlColors(resolved, effBg) : resolved;
  return <div className="gc-text" style={style} dangerouslySetInnerHTML={{ __html: safe }} />;
}

export function CellVideo({ src }) {
  const url = useResolvedSrc(src);
  if (!url) return <div className="gc-loading" aria-hidden="true" />;
  return <video className="gc-video" src={url} controls preload="metadata" onPointerDown={stop} />;
}

export function CellContent({ cell, rect, seqIndex, seqFormat, boards, onOpenBoard, textStyle, effBg = null, cardId, cellId, compare = false }) {
  const type = cell?.type || 'empty';
  if (type === 'board' && cell.boardId) {
    const b = boards?.[cell.boardId];
    const missing = !b;                                  // referenced cluster was deleted
    const name = b?.name || cell.name || 'Cluster';      // cell.name = snapshot at drop
    return (
      <button type="button" className={`gc-board${missing ? ' is-missing' : ''}`} onPointerDown={stop}
        onClick={(e) => { e.stopPropagation(); if (!missing) onOpenBoard?.(cell.boardId); }}
        disabled={missing}
        title={missing ? 'This cluster was removed' : `Open ${name}`}>
        {b?.thumb_key
          ? <R2Image src={b.thumb_key} w={Math.round(rect.w)} h={Math.round(rect.h)} className="gc-board-thumb" draggable="false" />
          : <span className="gc-board-ph" aria-hidden="true" />}
        <span className="gc-board-meta">
          <span className="gc-board-badge">{missing ? 'REMOVED' : 'CLUSTER'}</span>
          <span className="gc-board-name">{missing ? `${name} (removed)` : name}</span>
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
    return (
      <R2Image
        src={cell.src}
        w={Math.round(rect.w)}
        h={Math.round(rect.h)}
        draggable="false"
        className="gc-img"
        style={style}
      />
    );
  }
  if (type === 'text') return <CellText html={cell.html} seqIndex={seqIndex} seqFormat={seqFormat} style={textStyle} effBg={effBg} />;
  if (type === 'link') {
    return (
      <a className="gc-link" href={cell.source || cell.link || '#'} target="_blank" rel="noreferrer" onClick={stop}>
        {cell.image ? <img className="gc-link-img" src={cell.image} alt="" draggable="false" /> : null}
        <span className="gc-link-meta">
          {cell.favicon ? <img className="gc-link-fav" src={cell.favicon} alt="" /> : null}
          <span className="gc-link-title">{cell.title || cell.source || cell.link}</span>
        </span>
      </a>
    );
  }
  if (type === 'video' && cell.src) return <CellVideo src={cell.src} />;
  if (type === 'file') {
    return <FileCard fileSrc={cell.fileSrc} fileName={cell.fileName} mime={cell.mime} sizeBytes={cell.sizeBytes} ext={cell.ext} title={cell.title} onUpdate={null} />;
  }
  return null; // empty cell — placeholder/chooser drawn by the wrapper
}
