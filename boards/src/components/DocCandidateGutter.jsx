// Left-margin gutter that surfaces every "candidate name" (a recurring
// proper noun that isn't a tag yet) on the active doc page with a one-tap
// ✓ / ✗ control — so suggestions are actionable straight from the margin
// instead of only by noticing the faint dotted underline in the text.
//
//   ✓ → opens the type picker (CandidatePromptPopover, via onConfirm) to
//       confirm the word as a Character / Setting / Topic / Thing tag.
//   ✗ → dismisses it (workspace-wide entity_ignore_terms tombstone).
//
// Positioning mirrors DocTagGutter: ONE control per UNIQUE candidate name
// (a name recurs many times but confirm/dismiss is workspace-wide), pinned
// to its first on-screen occurrence's line via the element's client rect
// relative to .doc-editor-wrap, recomputed on every editor transaction +
// resize. The gutter lives INSIDE the scroll container, so it scrolls with
// the text and needs no scroll listener. Only renders while editing.

import { useEffect, useRef, useState } from 'react';

export function DocCandidateGutter({ editor, editable, onConfirm, onDismiss }) {
  const [items, setItems] = useState([]); // [{ key, name, count, sample, top }]
  // Names the user just confirmed/dismissed — hide them optimistically so the
  // control vanishes on click instead of lingering until the async repaint.
  const actedRef = useRef(new Set());
  // name(lowercased) -> the .tt-candidate element, so a confirm can pin the
  // exact tapped span (DocPageEditor's candidateAnchorFromEl needs the el).
  const elsRef = useRef(new Map());

  useEffect(() => {
    if (!editor || !editable) { setItems([]); return; }
    let raf = 0;
    const recompute = () => {
      const wrap = editor.view.dom.closest('.doc-editor-wrap');
      const wrapRect = wrap?.getBoundingClientRect();
      if (!wrapRect) { setItems([]); return; }
      const nodes = editor.view.dom.querySelectorAll('.tt-candidate');
      const seen = new Set();
      const els = new Map();
      const out = [];
      for (const el of nodes) {
        const name = el.getAttribute('data-name') || el.textContent || '';
        if (!name) continue;
        const lname = name.toLowerCase();
        if (seen.has(lname)) continue; // one control per unique name
        seen.add(lname);
        els.set(lname, el);
        if (actedRef.current.has(lname)) continue; // optimistically hidden
        const rect = el.getBoundingClientRect();
        if (!rect || (rect.width === 0 && rect.height === 0)) continue;
        out.push({
          key: lname,
          name,
          count: Number(el.getAttribute('data-count')) || 0,
          sample: el.getAttribute('data-sample') || '',
          top: rect.top - wrapRect.top,
        });
      }
      elsRef.current = els;
      // Self-clean: drop acted names whose decoration is gone (handled).
      for (const a of [...actedRef.current]) if (!seen.has(a)) actedRef.current.delete(a);
      // De-overlap: stack controls that would collide on/near the same line
      // so two suggestions sharing a line don't render on top of each other.
      out.sort((a, b) => a.top - b.top);
      let floor = -Infinity;
      for (const it of out) { if (it.top < floor) it.top = floor; floor = it.top + 24; }
      setItems(out);
    };
    const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(recompute); };
    schedule();
    editor.on('transaction', schedule);
    window.addEventListener('resize', schedule);
    // After a promote/dismiss the index reloads + the plugin repaints; clear
    // the optimistic set once that's settled so a FAILED action re-surfaces.
    const onChanged = () => { setTimeout(() => { actedRef.current.clear(); schedule(); }, 600); };
    document.addEventListener('soleil-candidates-changed', onChanged);
    return () => {
      cancelAnimationFrame(raf);
      editor.off('transaction', schedule);
      window.removeEventListener('resize', schedule);
      document.removeEventListener('soleil-candidates-changed', onChanged);
    };
  }, [editor, editable]);

  if (!editable) return null;

  const candFor = (it) => ({
    name: it.name, count: it.count, sample: it.sample,
    el: elsRef.current.get(it.key) || null,
  });
  // Highlight the matching word while hovering its control, so it's obvious
  // which suggestion you're about to act on.
  const hot = (key, on) => {
    const el = elsRef.current.get(key);
    if (el) el.classList.toggle('tt-candidate-hot', on);
  };

  return (
    <div className="doc-candidate-gutter" aria-hidden="false">
      {items.map((it) => (
        <div key={it.key} className="doc-cand-ctl" style={{ top: it.top + 'px' }}
             onMouseEnter={() => hot(it.key, true)}
             onMouseLeave={() => hot(it.key, false)}>
          <span className="doc-cand-name" title={it.name}>{it.name}</span>
          <button className="doc-cand-yes" title={`Make “${it.name}” a tag`}
                  onClick={(e) => onConfirm?.(candFor(it), e.currentTarget.getBoundingClientRect())}>
            ✓
          </button>
          <button className="doc-cand-no" title={`Not a tag — dismiss “${it.name}”`}
                  onClick={() => {
                    actedRef.current.add(it.key);
                    setItems((prev) => prev.filter((p) => p.key !== it.key));
                    hot(it.key, false);
                    onDismiss?.(candFor(it));
                  }}>
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
