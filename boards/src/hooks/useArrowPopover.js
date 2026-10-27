// What a picked arrow's bar is (components/toolbar/CanvasBarsA.jsx
// PickedArrowBarA): its place over the arrow's midpoint in board space,
// projected through the caller's `canvasToViewport` so it tracks pan and zoom,
// kept on the screen (`popRef` is the bar, measured for it); Escape putting it
// away; and its label field, as the field's props: a draft committed on Enter
// or on leaving the field, or when the bar goes away mid-typing, and put back
// by Escape.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isComposingKey } from '../lib/composerKeys.js';

export function useArrowPopover({ arrow, arrowIndex, midPoint, canvasToViewport, onChange, onClose, popRef }) {
  const [labelDraft, setLabelDraft] = useState(arrow?.label || '');
  const [labelEditing, setLabelEditing] = useState(false);

  // Refs that mirror the latest draft + arrow.label. Used by the unmount
  // cleanup below so a mid-typed label survives if the bar tears down
  // (selection cleared, arrow tool switched) before onBlur fires.
  const labelDraftRef = useRef(labelDraft);
  useEffect(() => { labelDraftRef.current = labelDraft; }, [labelDraft]);
  const arrowLabelRef = useRef(arrow?.label || '');
  useEffect(() => { arrowLabelRef.current = arrow?.label || ''; }, [arrow?.label]);
  // `onChange` may be a fresh closure on every parent render — mirror it
  // through a ref so the unmount cleanup commits via the latest mutator,
  // not a stale snapshot from when the bar first mounted.
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  // Only commit-on-unmount when we know the user actually edited (focused
  // the input). Otherwise a bar that flashed open during a selection
  // would otherwise paint an empty-string commit over an existing label.
  const labelTouchedRef = useRef(false);
  const labelCancelRef = useRef(false);
  useEffect(() => () => {
    if (!labelTouchedRef.current) return;
    const v = (labelDraftRef.current || '').trim();
    if (v !== (arrowLabelRef.current || '')) {
      onChangeRef.current?.({ label: v || null });
    }
  }, []);

  // Sync the local draft when the arrow swaps under us (e.g. selection
  // moves to a different arrow) — but don't stomp on mid-typing edits.
  useEffect(() => {
    if (!labelEditing) setLabelDraft(arrow?.label || '');
  }, [arrow?.label, arrowIndex, labelEditing]);

  // Position: project canvas-space midPoint into viewport space and clamp
  // to keep the bar on-screen.
  const [pos, setPos] = useState(() => projectClamped(midPoint, canvasToViewport));
  useLayoutEffect(() => {
    setPos(projectClamped(midPoint, canvasToViewport, popRef.current));
  }, [midPoint?.x, midPoint?.y, canvasToViewport]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (ev) => { if (ev.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const labelProps = {
    value: labelDraft,
    maxLength: 60,
    'aria-label': 'Arrow label',
    onFocus: () => { setLabelEditing(true); labelTouchedRef.current = true; },
    onChange: (e) => setLabelDraft(e.target.value),
    onBlur: () => {
      setLabelEditing(false);
      // Escape's blur: this closure still holds the typed draft (the
      // revert hasn't rendered), so committing here applied the very
      // label Escape was throwing away (NOTES-11).
      if (labelCancelRef.current) { labelCancelRef.current = false; return; }
      const v = labelDraft.trim();
      if (v !== (arrow?.label || '')) onChange?.({ label: v || null });
    },
    onKeyDown: (e) => {
      if (isComposingKey(e)) return;
      if (e.key === 'Enter') { e.currentTarget.blur(); }
      if (e.key === 'Escape') {
        setLabelDraft(arrow?.label || '');
        labelTouchedRef.current = false;
        labelCancelRef.current = true;
        setLabelEditing(false);
        e.currentTarget.blur();
      }
    },
  };
  return { pos, labelProps };
}

function projectClamped(midPoint, canvasToViewport, popEl) {
  if (!midPoint || typeof canvasToViewport !== 'function') return { x: 16, y: 16 };
  const v = canvasToViewport(midPoint.x, midPoint.y);
  const popW = popEl?.offsetWidth || 380;
  const popH = popEl?.offsetHeight || 44;
  // Sit just above the arrow midpoint (offset by half the bar's height
  // plus a 16px gap), then clamp inside the viewport with an 8px margin.
  const desiredX = v.x - popW / 2;
  const desiredY = v.y - popH - 14;
  const maxX = (window.innerWidth || 1200) - popW - 8;
  const maxY = (window.innerHeight || 800) - popH - 8;
  return {
    x: Math.max(8, Math.min(maxX, desiredX)),
    y: Math.max(8, Math.min(maxY, desiredY)),
  };
}
