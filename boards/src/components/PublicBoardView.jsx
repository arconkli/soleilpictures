// Public read-only board viewer — for /share/<token> URLs (no
// account required).
//
// Calls the upload party's /share-bundle route with the token; gets
// back the board metadata + Y.Doc snapshot bytes + a map of
// {storage_path → presigned R2 URL} covering every image referenced
// on the board. Decodes the snapshot client-side into cards/arrows/
// strokes and renders them as static HTML on a fixed-position canvas.
//
// No realtime, no editing, no sidebar — just a clean preview with a
// "Sign in" CTA in the corner. Snapshot is loaded once on mount and
// stays static; the visitor reloads to refresh.

import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { b64ToBytes, readCards, readArrows, readStrokes } from '../lib/yhelpers.js';
import { ImagePlaceholder, SoleilMark } from './primitives.jsx';

const PARTYKIT_HOST = import.meta.env.VITE_PARTYKIT_HOST || 'localhost:1999';
const PARTYKIT_PROTOCOL = PARTYKIT_HOST.startsWith('localhost') ? 'http' : 'https';

// Resolve a card's image src against the bundle's image_urls map.
// New uploads have `r2:<key>` sentinels; legacy https URLs render
// directly as before.
function resolveImg(src, imageUrls) {
  if (typeof src !== 'string' || !src) return null;
  if (src.startsWith('r2:')) return imageUrls[src.slice(3)] || null;
  return src;
}

export function PublicBoardView({ token }) {
  const [state, setState] = useState({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const url = `${PARTYKIT_PROTOCOL}://${PARTYKIT_HOST}/parties/upload/share/share-bundle`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        if (!res.ok) {
          if (cancelled) return;
          setState({ status: 'invalid' });
          return;
        }
        const bundle = await res.json();
        if (cancelled) return;

        // Decode the snapshot into a Y.Doc once, then read back
        // plain card / arrow / stroke arrays.
        const ydoc = new Y.Doc();
        if (bundle.snapshot) {
          try { Y.applyUpdate(ydoc, b64ToBytes(bundle.snapshot)); }
          catch (e) { console.warn('[share] snapshot decode failed', e); }
        }
        const cards   = readCards(ydoc);
        const arrows  = readArrows(ydoc);
        const strokes = readStrokes(ydoc);
        ydoc.destroy();

        setState({
          status: 'ok',
          board: bundle.board || {},
          imageUrls: bundle.image_urls || {},
          cards, arrows, strokes,
        });
      } catch (e) {
        console.error('[share] bundle fetch failed', e);
        if (!cancelled) setState({ status: 'invalid' });
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  if (state.status === 'loading') {
    return (
      <div className="public-shell">
        <div className="public-loading">Loading…</div>
      </div>
    );
  }
  if (state.status === 'invalid') {
    return (
      <div className="public-shell">
        <div className="public-empty">
          <SoleilMark size={42} color="var(--soleil)" glow />
          <div className="public-empty-title">Link unavailable</div>
          <div className="public-empty-sub">This share link has been revoked or has expired. Ask the workspace owner for a fresh one.</div>
        </div>
      </div>
    );
  }

  const { board, imageUrls, cards, arrows, strokes } = state;
  // Compute canvas extents so we can center the content. Cards live
  // in board space; we offset by the min x/y so everything starts
  // near (0,0) in our static canvas.
  const allRects = [
    ...cards.map(c => ({ x: c.x || 0, y: c.y || 0, w: c.w || 100, h: c.h || 80 })),
    ...arrows.flatMap(a => [a?.from, a?.to].filter(Boolean).map(p => ({ x: p.x || 0, y: p.y || 0, w: 0, h: 0 }))),
  ];
  const minX = allRects.length ? Math.min(...allRects.map(r => r.x)) : 0;
  const minY = allRects.length ? Math.min(...allRects.map(r => r.y)) : 0;
  const maxX = allRects.length ? Math.max(...allRects.map(r => r.x + r.w)) : 1200;
  const maxY = allRects.length ? Math.max(...allRects.map(r => r.y + r.h)) : 800;
  const width  = Math.max(800, maxX - minX + 80);
  const height = Math.max(600, maxY - minY + 80);

  return (
    <div className="public-shell" style={{ background: board.bg_color || 'var(--bg-0)' }}>
      <div className="public-topbar">
        <a className="public-brand" href="/" title="Soleil Boards home">
          <SoleilMark size={20} color="var(--soleil)" glow />
          <span className="public-brand-name">Soleil</span>
        </a>
        <div className="public-board-name">{board.name || 'Untitled'}</div>
        <a className="public-signin" href="/">Sign in</a>
      </div>

      <div className="public-canvas-scroll">
        <div className="public-canvas"
             style={{
               width: `${width}px`,
               height: `${height}px`,
               background: board.bg_color || 'transparent',
             }}>
          {/* Strokes — render as SVG behind cards. */}
          {strokes.length > 0 && (
            <svg className="public-strokes" width={width} height={height}
                 viewBox={`${minX - 40} ${minY - 40} ${width} ${height}`}
                 style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
              {strokes.map((s, i) => s?.points?.length > 0 && (
                <polyline key={i}
                          points={s.points.map(p => `${p.x},${p.y}`).join(' ')}
                          stroke={s.color || '#aaa'}
                          strokeWidth={s.width || 2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          fill="none" />
              ))}
            </svg>
          )}

          {/* Arrows — straight lines for v1. */}
          {arrows.length > 0 && (
            <svg className="public-arrows" width={width} height={height}
                 viewBox={`${minX - 40} ${minY - 40} ${width} ${height}`}
                 style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
              {arrows.map((a, i) => a?.from && a?.to && (
                <line key={i} x1={a.from.x} y1={a.from.y} x2={a.to.x} y2={a.to.y}
                      stroke={a.color || 'var(--ink-2)'}
                      strokeWidth={a.width || 2}
                      strokeLinecap="round" />
              ))}
            </svg>
          )}

          {/* Cards. */}
          {cards.map(c => (
            <div key={c.id}
                 className="public-card"
                 style={{
                   left: (c.x || 0) - minX + 40,
                   top:  (c.y || 0) - minY + 40,
                   width:  c.w || 200,
                   height: c.h || 160,
                 }}>
              <PublicCardBody card={c} imageUrls={imageUrls} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Stripped-down card renderer — covers the common kinds, skips
// anything interactive (board cards collapse to placeholder, doc
// cards show a label, etc.).
function PublicCardBody({ card, imageUrls }) {
  switch (card.kind) {
    case 'image': {
      const url = resolveImg(card.src, imageUrls);
      return url
        ? <img className="public-card-img" src={url} alt={card.title || ''} draggable="false" />
        : <ImagePlaceholder tone={card.tone || 'neutral'} aspect={`${card.w}/${card.h}`} />;
    }
    case 'note':
      return (
        <div className="public-card-note"
             style={{ background: card.bgColor || '#fde68a', color: card.textColor || '#1a1300' }}
             dangerouslySetInnerHTML={{ __html: card.html || '' }} />
      );
    case 'link':
      return (
        <div className="public-card-link">
          <div className="public-card-link-title">{card.title || card.url || 'Link'}</div>
          <div className="public-card-link-url">{card.url || ''}</div>
        </div>
      );
    case 'palette':
      return (
        <div className="public-card-palette">
          {!card.chipsOnly && card.title && <div className="public-card-palette-title">{card.title}</div>}
          <div className="public-card-palette-row">
            {(card.swatches || []).map((s, i) => (
              <span key={i} className="public-card-palette-swatch" style={{ background: s.color || s }} />
            ))}
          </div>
        </div>
      );
    case 'shape':
      return (
        <div className="public-card-shape"
             style={{
               background: card.fill || 'transparent',
               border: card.stroke ? `${card.strokeWidth || 2}px solid ${card.stroke}` : '1px solid var(--line-2)',
               borderRadius: card.shape === 'circle' ? '50%' : 0,
             }} />
      );
    case 'board':
    case 'boardlink':
    case 'doc':
      return (
        <div className="public-card-blocked">
          <span className="public-card-blocked-tag">{(card.kind || 'item').toUpperCase()}</span>
          <span className="public-card-blocked-msg">Sign in to open</span>
        </div>
      );
    default:
      return <div className="public-card-blocked">{card.kind}</div>;
  }
}
