// Left-margin gutter that draws a dot for every applied tag range on
// the active doc page. Dots sit in the negative-left margin of
// .doc-editor-wrap (symmetric to CommentGutter on the right). Each
// dot is colored by its tag.
//
// Positioning: we re-hash the doc on every editor transaction to map
// each range's pHash back to its current absolute position, then
// resolve that to pixel coords via editor.view.coordsAtPos(). So as
// the user types above/below a tagged paragraph, the dot stays
// pinned to that paragraph's first line.
//
// Hover/click → opens the TagRangeHoverPopover at the dot's anchor.

import { useEffect, useRef, useState } from 'react';
import { contentHash } from '../lib/clusterMath.js';

export function DocTagGutter({ editor, ranges, onOpen }) {
  // ranges: [{ pHash, startOffset, length, tagId, tagColor, tagName, source }]
  const [positioned, setPositioned] = useState([]); // [{ key, top, color, ...range }]
  const rangesRef = useRef(ranges);
  useEffect(() => { rangesRef.current = ranges || []; }, [ranges]);

  useEffect(() => {
    if (!editor) return;
    const recompute = () => {
      const wrap = editor.view.dom.closest('.doc-editor-wrap');
      const wrapRect = wrap?.getBoundingClientRect();
      if (!wrapRect) { setPositioned([]); return; }
      const rs = rangesRef.current;
      if (!rs?.length) { setPositioned([]); return; }
      // Hash each paragraph in the live doc.
      const paraByHash = new Map();
      editor.state.doc.descendants((node, pos) => {
        if (node.type?.name !== 'paragraph') return true;
        const text = (node.textContent || '').trim();
        if (text.length < 20) return false;
        const h = contentHash(text);
        if (!paraByHash.has(h)) paraByHash.set(h, pos + 1);
        return false;
      });
      // Group by paragraph so multiple tags on the same paragraph
      // stack visually. Order within a paragraph: by tagId for
      // stable sort.
      const byPara = new Map();
      for (const r of rs) {
        const start = paraByHash.get(r.pHash);
        if (start == null) continue;
        const absStart = start + Math.max(0, r.startOffset);
        let coords;
        try { coords = editor.view.coordsAtPos(absStart); } catch (_) { coords = null; }
        if (!coords) continue;
        const top = coords.top - wrapRect.top + 4;
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
            top: it.top + i * 11,        // 11px vertical step per stacked dot
            range: it.range,
          });
        });
      }
      setPositioned(out);
      // Dev log: makes it easy to tell from devtools whether the
      // gutter is "no ranges given," "ranges given but paragraph
      // hashes don't match," or "rendering N dots."
      const rsLen = rs.length;
      const matchedHashes = new Set([...byPara.values()].flatMap(items => items.map(it => it.range.pHash))).size;
      console.info(`[doc-tag-gutter] paragraphs:${paraByHash.size} ranges:${rsLen} matched:${matchedHashes} dots:${out.length}`);
    };
    recompute();
    editor.on('transaction', recompute);
    window.addEventListener('resize', recompute);
    return () => {
      editor.off('transaction', recompute);
      window.removeEventListener('resize', recompute);
    };
  }, [editor, ranges]);

  return (
    <div className="doc-tag-gutter" aria-hidden="false">
      {positioned.map(p => (
        <button
          key={p.key}
          className="doc-tag-gutter-dot"
          style={{ top: p.top + 'px', background: p.range.tagColor }}
          title={`${p.range.tagName || 'Tag'} · ${labelForSource(p.range.source)}`}
          onClick={(e) => {
            console.info('[doc-tag-gutter] dot click', p.range.tagName);
            onOpen?.(e, p.range);
          }}
          onMouseEnter={(e) => {
            console.info('[doc-tag-gutter] dot hover-enter', p.range.tagName);
            onOpen?.(e, p.range, { hover: true });
          }}
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
