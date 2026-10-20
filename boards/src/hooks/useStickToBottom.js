import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { isStuck, pickAnchor, anchorCorrection, STICK_THRESHOLD_PX } from '../lib/stickToBottom.js';

const ANCHOR = '[data-msg-id]';

// Keeps a chat thread where its reader is.
//  - At the bottom (within the threshold) it stays at the bottom whatever
//    grows: a new message, an image or reaction landing, the typing row, the
//    composer getting taller.
//  - Scrolled up, it holds the message at the top of the view in place while
//    anything above it changes height, older history included. Safari has no
//    native scroll anchoring, and the scroller turns it off elsewhere
//    (overflow-anchor: none) so the two never fight.
// A ResizeObserver on the content and on the scroller does both, after layout
// and before paint, so neither ever shows as a jump.
//   scrollRef  — the scrolling element
//   contentRef — one element wrapping everything inside it
//   startStuck — false when the thread opens on a linked message instead
export function useStickToBottom({ scrollRef, contentRef, threshold = STICK_THRESHOLD_PX, startStuck = true }) {
  const stuckRef = useRef(startStuck);
  const [stuck, setStuckState] = useState(startStuck);
  const anchorRef = useRef(null);
  const suspendedRef = useRef(0);

  const setStuck = useCallback((v) => {
    stuckRef.current = v;
    setStuckState((prev) => (prev === v ? prev : v));
  }, []);

  // The first message showing at the top of the view. elementFromPoint keeps
  // it cheap on a long thread; a day divider at the very top falls through to
  // the next message.
  const captureAnchor = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return null;
    const box = el.getBoundingClientRect();
    let node = null;
    for (const dy of [2, 24, 48, 96]) {
      node = document.elementFromPoint(box.left + box.width / 2, box.top + dy)?.closest?.(ANCHOR) || null;
      if (node && el.contains(node)) break;
      node = null;
    }
    if (!node) {
      const items = [...el.querySelectorAll(ANCHOR)].map((n) => {
        const r = n.getBoundingClientRect();
        return { id: n.getAttribute('data-msg-id'), top: r.top, bottom: r.bottom };
      });
      anchorRef.current = pickAnchor(items, box.top);
      return anchorRef.current;
    }
    anchorRef.current = { id: node.getAttribute('data-msg-id'), offset: node.getBoundingClientRect().top - box.top };
    return anchorRef.current;
  }, [scrollRef]);

  const restoreAnchor = useCallback(() => {
    const el = scrollRef.current;
    const a = anchorRef.current;
    if (!el || !a) return;
    const node = el.querySelector(`[data-msg-id="${CSS.escape(a.id)}"]`);
    if (!node) return;
    const delta = anchorCorrection(a, node.getBoundingClientRect().top, el.getBoundingClientRect().top);
    if (Math.abs(delta) >= 1) el.scrollTop += delta;
  }, [scrollRef]);

  // Jumps are instant: a smooth scroll would race the observer for its whole run.
  const pin = useCallback(() => {
    const el = scrollRef.current;
    anchorRef.current = null;
    setStuck(true);
    if (el) el.scrollTop = el.scrollHeight;
  }, [scrollRef, setStuck]);

  // A send: follow it to the bottom whatever the reader was doing. The new
  // row grows the content, and the observer pins in that same frame.
  const requestPin = useCallback(() => {
    anchorRef.current = null;
    setStuck(true);
  }, [setStuck]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const now = isStuck({ scrollHeight: el.scrollHeight, scrollTop: el.scrollTop, clientHeight: el.clientHeight }, threshold);
    setStuck(now);
    if (now) anchorRef.current = null;
    else if (!suspendedRef.current) captureAnchor();
  }, [scrollRef, threshold, setStuck, captureAnchor]);

  // Search results and the like borrow the scroller: hands off until resumed.
  const suspend = useCallback(() => {
    suspendedRef.current += 1;
    let done = false;
    return () => {
      if (done) return;
      done = true;
      suspendedRef.current = Math.max(0, suspendedRef.current - 1);
    };
  }, []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content) return undefined;
    if (stuckRef.current) el.scrollTop = el.scrollHeight;
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => {
      if (suspendedRef.current) return;
      if (stuckRef.current) el.scrollTop = el.scrollHeight;
      else restoreAnchor();
    });
    ro.observe(content);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrollRef, contentRef, restoreAnchor]);

  return useMemo(() => ({
    stuck, stuckRef, onScroll, pin, requestPin, suspend, captureAnchor, restoreAnchor,
  }), [stuck, onScroll, pin, requestPin, suspend, captureAnchor, restoreAnchor]);
}
