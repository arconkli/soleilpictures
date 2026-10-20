// Grows a message field with what's typed in it, up to a cap (lib/autosize.js),
// then lets it scroll inside itself. Re-measured whenever the text changes,
// when the panel it sits in changes size (its height sets the cap, its width
// the wrap; a phone keyboard opening changes both), and once the fonts are in.

import { useCallback, useEffect, useLayoutEffect } from 'react';
import { fieldHeight } from '../lib/autosize.js';

const px = (v) => parseFloat(v) || 0;

export function useAutosizeTextarea(ref, value, { maxLines = 8, maxShare = 0.4, panelSelector = '.msg-panel' } = {}) {
  const fit = useCallback(() => {
    const el = ref.current;
    if (!el || !el.isConnected) return;
    const cs = getComputedStyle(el);
    // Measuring needs height:auto for a moment; keep the inner scroll (and so
    // the caret) where the browser put it.
    const top = el.scrollTop;
    el.style.height = 'auto';
    const { height, scrolls } = fieldHeight({
      scrollHeight: el.scrollHeight,
      lineHeight: px(cs.lineHeight) || px(cs.fontSize) * 1.45,
      paddingY: px(cs.paddingTop) + px(cs.paddingBottom),
      borderY: px(cs.borderTopWidth) + px(cs.borderBottomWidth),
      maxLines,
      panelHeight: el.closest(panelSelector)?.clientHeight || 0,
      maxShare,
    });
    el.style.height = `${height}px`;
    el.style.overflowY = scrolls ? 'auto' : 'hidden';
    el.scrollTop = top;
  }, [ref, maxLines, maxShare, panelSelector]);

  useLayoutEffect(fit, [fit, value]);
  useEffect(() => {
    let live = true;
    globalThis.document?.fonts?.ready?.then(() => { if (live) fit(); });
    const panel = ref.current?.closest(panelSelector);
    if (!panel || typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', fit);
      return () => { live = false; window.removeEventListener('resize', fit); };
    }
    const ro = new ResizeObserver(() => fit());
    ro.observe(panel);
    return () => { live = false; ro.disconnect(); };
  }, [fit, ref, panelSelector]);
}
