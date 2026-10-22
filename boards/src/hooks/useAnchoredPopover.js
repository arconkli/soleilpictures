import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useDismissOnOutside } from './useDismissOnOutside.js';
import { placeAnchored } from '../lib/anchoredPlacement.js';
import { isComposingKey } from '../lib/composerKeys.js';
import { topModal } from '../lib/modalGuard.js';

// A toolbar's popover (a list of fonts or sizes, a grid of swatches, a menu),
// portaled to <body> and placed against the control that opened it. The bars
// each did this by hand, and each left something out. All of it, once:
//
//  - Placed by lib/anchoredPlacement: the side asked for when it fits, else
//    the roomier one, kept on screen, a long list capped and scrolling. And
//    placed again when anything scrolls or the window resizes (a bar that
//    scrolls sideways takes its button with it) or the panel's size changes.
//  - A press outside both the control and the panel closes it
//    (useDismissOnOutside).
//  - Escape closes it and goes no further. A bar keeps the caret in the note
//    or the doc while its popover is open, so the editor heard the key first:
//    a note ended its edit, a doc closed, and the popover went with them. It is
//    taken on the window in the capture phase, before anything else hears it,
//    while the layer the popover opened in is still the top one (lib/
//    modalGuard: a dialog opened over it gets the key), and never mid-syllable.
//
//   const { popRef, style } = useAnchoredPopover({ open, onClose, anchorRef, side: 'above' });
//   {open && createPortal(<div ref={popRef} style={style}>…</div>, document.body)}
//
//   side       'below' | 'above': where it goes when it fits there; 'right':
//              beside it (a menu off the tool rail)
//   align      'start' | 'end' | 'center': which part of the control it lines up with
//   fitHeight  cap its height to the room it gets, for a list that scrolls
//   matchWidth at least as wide as the control
//   escape     false: Escape is the owner's (a menu whose keys hand the focus
//              back to its button)
//
// onClose is told why: 'escape' or 'outside' (a press outside both), so a
// menu can give the focus back to its button on the one and not the other.
const HIDDEN = { position: 'fixed', top: 0, left: 0, bottom: 'auto', right: 'auto', visibility: 'hidden' };
// Measured at its own width before it's placed, whatever min-width its CSS
// gives it (a fixed box's 100% is the whole window).
const HIDDEN_OWN_WIDTH = { ...HIDDEN, minWidth: 0 };

export function useAnchoredPopover({ open, onClose, anchorRef, side = 'below', align = 'start', gap = 6, pad = 8, fitHeight = false, matchWidth = false, escape = true }) {
  const popRef = useRef(null);
  const [placed, setPlaced] = useState(null);
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  const close = useCallback((why) => onCloseRef.current?.(why), []);
  const closeOutside = useCallback(() => onCloseRef.current?.('outside'), []);

  const refs = useMemo(() => [anchorRef, popRef], [anchorRef]);
  useDismissOnOutside(refs, open, closeOutside, { escape: false });

  useLayoutEffect(() => {
    if (!open) { setPlaced(null); return undefined; }
    const place = () => {
      const a = anchorRef.current;
      const el = popRef.current;
      if (!a || !el) return;
      const r = a.getBoundingClientRect();
      const minWidth = matchWidth ? r.width : null;
      const size = {
        width: Math.max(el.offsetWidth, minWidth || 0),
        height: fitHeight ? el.scrollHeight : el.offsetHeight,
      };
      const p = placeAnchored(r, size, { width: window.innerWidth, height: window.innerHeight },
        { side, align, gap, pad, fitHeight });
      setPlaced((prev) => (prev && prev.top === p.top && prev.left === p.left && prev.side === p.side
        && prev.maxHeight === p.maxHeight && prev.minWidth === minWidth ? prev : { ...p, minWidth }));
    };
    place();
    // Once more after a frame, for what lays out late (a font's face).
    const raf = requestAnimationFrame(place);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    if (ro && popRef.current) ro.observe(popRef.current);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      ro?.disconnect();
    };
  }, [open, anchorRef, side, align, gap, pad, fitHeight, matchWidth]);

  useLayoutEffect(() => {
    if (!open || !escape) return undefined;
    const layer = topModal();
    const onKey = (e) => {
      if (e.key !== 'Escape' || isComposingKey(e) || topModal() !== layer) return;
      e.preventDefault();
      e.stopPropagation();
      close('escape');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, close, escape]);

  const style = placed
    ? {
      position: 'fixed', top: placed.top, left: placed.left, bottom: 'auto', right: 'auto',
      ...(placed.maxHeight != null ? { maxHeight: placed.maxHeight } : null),
      ...(placed.minWidth ? { minWidth: placed.minWidth } : null),
    }
    : (matchWidth ? HIDDEN_OWN_WIDTH : HIDDEN);
  return { popRef, style, side: placed?.side || side };
}
