// Selection-anchored formatting bubble. Replaces the always-on top
// toolbar — appears just above the current text selection in the
// editor and disappears when the selection collapses.
//
// We don't use @tiptap/extension-bubble-menu (not in deps); a small
// hand-rolled positioner is enough and avoids a new dependency.
//
// Buttons:
//   Style dropdown (Body / H1 / H2 / H3 / Quote)
//   B / I / U / S
//   <> (inline code)
//   ⊕ link (delegates to the host's onOpenLink callback)

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const STYLE_OPTIONS = [
  { value: 'p',  label: 'Body' },
  { value: 'h1', label: 'Heading 1' },
  { value: 'h2', label: 'Heading 2' },
  { value: 'h3', label: 'Heading 3' },
  { value: 'q',  label: 'Quote' },
];

export function DocBubbleMenu({ editor, onOpenLink }) {
  const [pos, setPos] = useState(null); // { left, top } | null
  const [, force] = useState(0);
  const popRef = useRef(null);
  const lastVisibleAt = useRef(0);

  // Subscribe to selection / transaction changes so active-state on
  // buttons stays accurate. Recompute position on each tick.
  useEffect(() => {
    if (!editor) { setPos(null); return; }
    const recompute = () => {
      const { state, view } = editor;
      const { from, to, empty } = state.selection;
      // Hide when the selection is empty OR the editor isn't focused.
      if (empty || !view.hasFocus()) {
        // Tiny grace period so a click on the bubble itself doesn't
        // immediately collapse the selection and dismiss before the
        // click handler fires.
        if (Date.now() - lastVisibleAt.current > 120) setPos(null);
        force(n => (n + 1) | 0);
        return;
      }
      const start = view.coordsAtPos(from);
      const end   = view.coordsAtPos(to);
      // Center horizontally between the two coords; anchor 8px above
      // the higher of the two.
      const left = (start.left + end.left) / 2;
      const top  = Math.min(start.top, end.top);
      setPos({ left, top });
      lastVisibleAt.current = Date.now();
      force(n => (n + 1) | 0);
    };
    recompute();
    editor.on('selectionUpdate', recompute);
    editor.on('transaction', recompute);
    editor.on('focus', recompute);
    editor.on('blur', recompute);
    window.addEventListener('scroll', recompute, true);
    window.addEventListener('resize', recompute);
    return () => {
      editor.off('selectionUpdate', recompute);
      editor.off('transaction', recompute);
      editor.off('focus', recompute);
      editor.off('blur', recompute);
      window.removeEventListener('scroll', recompute, true);
      window.removeEventListener('resize', recompute);
    };
  }, [editor]);

  // Adjust the final left/top once we know the popover's measured
  // width so it centers on the selection (we render it offscreen on
  // first frame to measure).
  useLayoutEffect(() => {
    if (!pos || !popRef.current) return;
    const w = popRef.current.offsetWidth;
    const h = popRef.current.offsetHeight;
    const PAD = 8;
    let left = pos.left - w / 2;
    let top  = pos.top - h - 10;
    if (left < PAD) left = PAD;
    if (left + w > window.innerWidth - PAD) left = window.innerWidth - w - PAD;
    if (top < PAD) top = pos.top + 24;       // flip below if no room above
    popRef.current.style.left = `${left}px`;
    popRef.current.style.top  = `${top}px`;
  }, [pos]);

  if (!editor || !pos) return null;

  const isActive = (name, attrs) => editor.isActive(name, attrs);
  const run = (cb) => () => { try { cb(editor.chain().focus()).run(); } catch (_) {} };

  const currentStyle = (() => {
    if (isActive('heading', { level: 1 })) return 'h1';
    if (isActive('heading', { level: 2 })) return 'h2';
    if (isActive('heading', { level: 3 })) return 'h3';
    if (isActive('blockquote')) return 'q';
    return 'p';
  })();

  const setStyle = (val) => {
    const c = editor.chain().focus();
    if (val === 'p') c.setParagraph();
    else if (val === 'q') c.setBlockquote();
    else if (val === 'h1') c.toggleHeading({ level: 1 });
    else if (val === 'h2') c.toggleHeading({ level: 2 });
    else if (val === 'h3') c.toggleHeading({ level: 3 });
    c.run();
  };

  return createPortal(
    <div
      ref={popRef}
      className="doc-bubble"
      // Initial position is set offscreen; useLayoutEffect re-positions
      // immediately once we have measurements. Avoids a 1-frame flash.
      style={{ position: 'fixed', left: -9999, top: -9999 }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <select
        className="doc-bubble-select"
        value={currentStyle}
        onChange={(e) => setStyle(e.target.value)}
        title="Text style"
      >
        {STYLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <span className="doc-bubble-sep" aria-hidden="true" />
      <button className={`doc-bubble-btn doc-bubble-bold ${isActive('bold') ? 'is-active' : ''}`}
              title="Bold (⌘B)"
              onClick={run(c => c.toggleBold())}>B</button>
      <button className={`doc-bubble-btn doc-bubble-italic ${isActive('italic') ? 'is-active' : ''}`}
              title="Italic (⌘I)"
              onClick={run(c => c.toggleItalic())}>I</button>
      <button className={`doc-bubble-btn doc-bubble-under ${isActive('underline') ? 'is-active' : ''}`}
              title="Underline (⌘U)"
              onClick={run(c => c.toggleUnderline())}>U</button>
      <button className={`doc-bubble-btn doc-bubble-strike ${isActive('strike') ? 'is-active' : ''}`}
              title="Strikethrough"
              onClick={run(c => c.toggleStrike())}>S</button>
      <button className={`doc-bubble-btn ${isActive('code') ? 'is-active' : ''}`}
              title="Inline code (⌘E)"
              onClick={run(c => c.toggleCode())}>{'<>'}</button>
      <span className="doc-bubble-sep" aria-hidden="true" />
      <button className="doc-bubble-btn"
              title="Link (⌘K)"
              onClick={() => onOpenLink?.(editor)}>⊕</button>
    </div>,
    document.body
  );
}
