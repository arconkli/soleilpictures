// Left-margin gutter that draws a dot for every applied tag range on
// the active doc page. Dots sit in the negative-left margin of
// .doc-editor-wrap (symmetric to CommentGutter on the right). Each
// dot is colored by its tag.
//
// Positioning: after every editor transaction (once a frame at most) we
// map each range's pHash back to its paragraph's current absolute
// position, then resolve that to pixel coords via
// editor.view.coordsAtPos(). So as the user types above/below a tagged
// paragraph, the dot stays pinned to that paragraph's first line.
// Nothing tagged → no layout read and no redraw; dots that didn't move
// aren't set again (a fresh array re-rendered the gutter on every key).
//
// Hover/click → opens the TagRangeHoverPopover at the dot's anchor.

import { useEffect, useRef, useState } from 'react';
import { paragraphStarts } from '../lib/paragraphHash.js';

const NONE = [];

const samePlaced = (a, b) => a.length === b.length
  && a.every((p, i) => p.key === b[i].key && p.top === b[i].top && p.leftStep === b[i].leftStep && p.range === b[i].range);

export function DocTagGutter({ editor, ranges, onOpen, onLeave }) {
  // ranges: [{ pHash, startOffset, length, tagId, tagColor, tagName, source }]
  const [positioned, setPositioned] = useState(NONE); // [{ key, top, color, ...range }]
  const shownRef = useRef(NONE);
  const rangesRef = useRef(ranges);
  useEffect(() => { rangesRef.current = ranges || []; }, [ranges]);

  useEffect(() => {
    if (!editor) return;
    const show = (next) => {
      if (samePlaced(shownRef.current, next)) return;
      shownRef.current = next;
      setPositioned(next);
    };
    let raf = 0;
    const recompute = () => {
      raf = 0;
      if (editor.isDestroyed) return;
      const rs = rangesRef.current;
      if (!rs?.length) { show(NONE); return; }
      const wrap = editor.view.dom.closest('.doc-editor-wrap');
      const wrapRect = wrap?.getBoundingClientRect();
      if (!wrapRect) { show(NONE); return; }
      // Client px → layout px: this gutter lives inside the zoomed wrap, so
      // CSS tops must be un-scaled (see CommentGutter for the full note).
      const z = (wrap.offsetWidth ? wrapRect.width / wrap.offsetWidth : 1) || 1;
      // Where each paragraph of the live doc starts, by its hash (worked
      // out once per paragraph, so a keystroke hashes one, not the doc).
      const paraByHash = paragraphStarts(editor.state.doc);
      // Group by paragraph so multiple tags on the same paragraph
      // stack visually. Order within a paragraph: by tagId for
      // stable sort.
      const byPara = new Map();
      for (const r of rs) {
        const start = paraByHash.get(r.pHash)?.from;
        if (start == null) continue;
        const absStart = start + Math.max(0, r.startOffset);
        let coords;
        try { coords = editor.view.coordsAtPos(absStart); } catch (_) { coords = null; }
        if (!coords) continue;
        const top = (coords.top - wrapRect.top) / z + 4;
        const k = `${r.pHash}::${Math.round(top)}`;
        if (!byPara.has(k)) byPara.set(k, []);
        byPara.get(k).push({ top, range: r });
      }
      const out = [];
      for (const [, items] of byPara) {
        items.sort((a, b) => String(a.range.tagId).localeCompare(String(b.range.tagId)));
        items.forEach((it, i) => {
          out.push({
            key: `${it.range.pHash}|${it.range.tagId}|${it.range.startOffset}`,
            top: it.top,
            // First dot keeps the gutter's natural left position; each
            // additional dot steps 11px further left into the margin,
            // so a paragraph with multiple tags reads as a horizontal
            // row of dots instead of a vertical pile.
            leftStep: i,
            range: it.range,
          });
        });
      }
      show(out);
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(recompute); };
    recompute();
    editor.on('transaction', schedule);
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(raf);
      editor.off('transaction', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [editor, ranges]);

  return (
    <div className="doc-tag-gutter" aria-hidden="false">
      {positioned.map(p => (
        <button
          key={p.key}
          className="doc-tag-gutter-dot"
          style={{
            top: p.top + 'px',
            // CSS rule sets left:4px by default for the first dot;
            // override to step further left for stacked dots.
            left: (4 - p.leftStep * 11) + 'px',
            background: p.range.tagColor,
          }}
          title={`${p.range.tagName || 'Tag'} · ${labelForSource(p.range.source)}`}
          onClick={(e) => onOpen?.(e, p.range)}
          onMouseEnter={(e) => onOpen?.(e, p.range, { hover: true })}
          onMouseLeave={() => onLeave?.()}
        />
      ))}
    </div>
  );
}

const SOURCE_LABEL = {
  'auto-paragraph': 'paragraph',
  'auto-sentence':  'sentence',
  'auto-word':      'word',
  'auto':           'auto',
  'auto-doc':       'page',
  'user':           'manual',
};
function labelForSource(s) { return SOURCE_LABEL[s] || s || 'tag'; }
