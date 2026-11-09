// What a picture says when it could not be fetched for want of a connection
// or an answer (not for want of access, which keeps the padlock). Drawn in
// place of R2Image's tile. On the canvas the words are laid out `scale` times
// larger and shrunk back, so they read at screen size at any zoom; outside it
// (Files thumbnails, previews) there is no scaling. Tiers by on-screen size:
// under 24px nothing, under 72 x 40 an icon-only Retry, else words + Retry.

import { useLayoutEffect, useState } from 'react';
import { Icon } from '../Icon.jsx';
import { ArrowClockwise } from '../../lib/icons.js';
import { useCanvasSettleTick } from '../../hooks/useCanvasSettleTick.js';
import { getCanvasScale } from '../../lib/canvasScale.js';
import './cardCouldntLoad.css';

export function CardCouldntLoad({ rootRef, onRetry, className = '', ...rest }) {
  useCanvasSettleTick();
  // The tile's layout size (transforms ignored) and whether it sits on the
  // canvas, in whole layout pixels, read on mount and on resize only, so a
  // re-render never sets state. The zoom is applied while rendering (the
  // settle tick re-renders after a zoom).
  const [layout, setLayout] = useState(null);
  useLayoutEffect(() => {
    const el = rootRef?.current;
    if (!el) return undefined;
    const read = () => {
      const lw = el.offsetWidth;
      const lh = el.offsetHeight;
      const onCanvas = !!el.closest('.card');
      setLayout((p) => (p && p.w === lw && p.h === lh && p.onCanvas === onCanvas ? p : { w: lw, h: lh, onCanvas }));
    };
    read();
    if (typeof ResizeObserver !== 'function') return undefined;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [rootRef]);
  const s = layout?.onCanvas ? (getCanvasScale() || 1) : 1;
  const w = (layout?.w || 0) * s;
  const h = (layout?.h || 0) * s;
  const stop = (e) => e.stopPropagation();
  const retry = (e) => { stop(e); onRetry?.(); };
  const tiny = Math.min(w, h) < 24;
  const icon = !tiny && (w < 72 || h < 40);
  return (
    <div ref={rootRef} {...rest} className={`r2-img r2-img-blocked ccl ${className}`.trim()} data-ccl={tiny ? 'none' : icon ? 'icon' : 'full'}
         {...(tiny ? { role: 'img', 'aria-label': 'Couldn’t load' } : {})}>
      {!tiny && (
        <div className="ccl-in" style={{ width: w, height: h, transform: `scale(${1 / s})` }}>
          {icon ? (
            <button type="button" className="ccl-btn is-icon" aria-label="Couldn’t load. Retry" title="Retry"
                    onPointerDown={stop} onClick={retry}>
              <Icon as={ArrowClockwise} size={13} weight="regular" />
            </button>
          ) : (
            <>
              <span className="ccl-txt">Couldn’t load</span>
              <button type="button" className="ccl-btn" aria-label="Retry loading this picture"
                      onPointerDown={stop} onClick={retry}>Retry</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
