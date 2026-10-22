// Grows a message field with what's typed in it, up to a cap (lib/autosize.js),
// then lets it scroll inside itself. Re-measured whenever the text changes,
// when the panel it sits in changes size (its height sets the cap, its width
// the wrap; a phone keyboard opening changes both), and once the fonts are in.
//
// The text is measured in a hidden copy of the field, never by setting the
// field itself to height:auto for a moment. For a textarea that's one row,
// not its text: the thread above grew for that instant, the browser pulled its
// scroll back to fit, and the thread read that as the reader scrolling up and
// let go of the bottom as the box grew.

import { useCallback, useEffect, useLayoutEffect } from 'react';
import { fieldHeight } from '../lib/autosize.js';

const px = (v) => parseFloat(v) || 0;

// What decides how the text wraps and how tall it stands.
const COPIED = [
  'boxSizing', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant', 'letterSpacing',
  'lineHeight', 'textIndent', 'textTransform', 'wordSpacing', 'whiteSpace', 'wordBreak', 'overflowWrap',
  'tabSize', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderStyle',
];

let mirror = null;
function textHeight(el, cs) {
  if (!mirror || !mirror.isConnected) {
    mirror = document.createElement('textarea');
    mirror.setAttribute('aria-hidden', 'true');
    mirror.tabIndex = -1;
    Object.assign(mirror.style, {
      position: 'absolute', top: '0', left: '-10000px', visibility: 'hidden', pointerEvents: 'none',
      height: '0', minHeight: '0', maxHeight: 'none', overflow: 'hidden', resize: 'none',
    });
    document.body.appendChild(mirror);
  }
  for (const p of COPIED) mirror.style[p] = cs[p];
  mirror.style.width = `${el.getBoundingClientRect().width}px`;
  mirror.value = el.value;
  return mirror.scrollHeight; // the text and the padding
}

export function useAutosizeTextarea(ref, value, { maxLines = 8, maxShare = 0.4, panelSelector = '.msg-panel' } = {}) {
  const fit = useCallback(() => {
    const el = ref.current;
    if (!el || !el.isConnected) return;
    const cs = getComputedStyle(el);
    const { height, scrolls } = fieldHeight({
      scrollHeight: textHeight(el, cs),
      lineHeight: px(cs.lineHeight) || px(cs.fontSize) * 1.45,
      paddingY: px(cs.paddingTop) + px(cs.paddingBottom),
      borderY: px(cs.borderTopWidth) + px(cs.borderBottomWidth),
      maxLines,
      panelHeight: el.closest(panelSelector)?.clientHeight || 0,
      maxShare,
    });
    const h = `${height}px`;
    if (el.style.height !== h) el.style.height = h;
    const overflow = scrolls ? 'auto' : 'hidden';
    if (el.style.overflowY !== overflow) el.style.overflowY = overflow;
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
