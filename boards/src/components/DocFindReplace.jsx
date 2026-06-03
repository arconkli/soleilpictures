// Find & replace bar that hovers over the doc editor.
//
// Implementation: a single ProseMirror plugin (registered via the editor's
// registerPlugin extension API would also work; we keep this self-contained
// by using PM Decorations attached through a transient state field). We use
// the simpler approach of mark-style decorations layered on top of the doc
// without mutating it.

import { useEffect, useRef, useState } from 'react';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const findKey = new PluginKey('soleilDocFind');

// Tiptap extension wrapper — register the find/highlight ProseMirror plugin
// on the editor so the modal below can inject ranges into it.
export const FindHighlightExtension = Extension.create({
  name: 'soleilDocFind',
  addProseMirrorPlugins() { return [findHighlightPlugin()]; },
});

export function findHighlightPlugin() {
  return new Plugin({
    key: findKey,
    state: {
      init: () => ({ ranges: [], current: -1 }),
      apply(tr, prev) {
        const meta = tr.getMeta(findKey);
        if (meta) return meta;
        // Re-map ranges through the transaction so they stay accurate after
        // edits made while the bar is open.
        if (prev.ranges.length === 0) return prev;
        const mapped = prev.ranges
          .map(([from, to]) => [tr.mapping.map(from), tr.mapping.map(to)])
          .filter(([from, to]) => to > from);
        return { ...prev, ranges: mapped };
      },
    },
    props: {
      decorations(state) {
        const s = findKey.getState(state);
        if (!s || !s.ranges.length) return DecorationSet.empty;
        const decos = s.ranges.map(([from, to], i) =>
          Decoration.inline(from, to, { class: i === s.current ? 'doc-find-hit doc-find-hit-current' : 'doc-find-hit' })
        );
        return DecorationSet.create(state.doc, decos);
      },
    },
  });
}

function findMatches(doc, query) {
  if (!query) return [];
  const q = query.toLowerCase();
  const ranges = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const text = node.text || '';
    const lower = text.toLowerCase();
    let i = 0;
    while ((i = lower.indexOf(q, i)) !== -1) {
      const from = pos + i;
      ranges.push([from, from + query.length]);
      i += query.length;
    }
  });
  return ranges;
}

export function DocFindReplace({ editor, open, onClose }) {
  const [q, setQ] = useState('');
  const [r, setR] = useState('');
  const [showReplace, setShowReplace] = useState(false);
  const inputRef = useRef(null);
  const replaceInputRef = useRef(null);

  // Close and return focus to the editor (otherwise the next keystroke is lost
  // into the void after the find bar unmounts). Focus on the next frame so it
  // lands AFTER React removes the find input — focusing synchronously would be
  // undone when the still-focused input unmounts and blurs to <body>.
  const close = () => {
    onClose();
    requestAnimationFrame(() => { try { editor?.commands?.focus(); } catch (_) {} });
  };

  // Recompute matches whenever query / doc changes; push into the plugin.
  useEffect(() => {
    if (!editor) return;
    if (!open) {
      const tr = editor.state.tr.setMeta(findKey, { ranges: [], current: -1 });
      editor.view.dispatch(tr);
      return;
    }
    const ranges = findMatches(editor.state.doc, q);
    const current = ranges.length > 0 ? 0 : -1;
    const tr = editor.state.tr.setMeta(findKey, { ranges, current });
    editor.view.dispatch(tr);
    // Scroll the first match into view.
    if (current >= 0) {
      const [from] = ranges[0];
      try {
        const dom = editor.view.domAtPos(from)?.node;
        const el = dom?.nodeType === 3 ? dom.parentElement : dom;
        el?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      } catch (_) {}
    }
  }, [editor, open, q]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  if (!open || !editor) return null;
  const state = findKey.getState(editor.state) || { ranges: [], current: -1 };
  const { ranges, current } = state;
  const total = ranges.length;

  const goto = (idx) => {
    if (!total) return;
    const next = ((idx % total) + total) % total;
    const [from] = ranges[next];
    editor.view.dispatch(editor.state.tr.setMeta(findKey, { ranges, current: next }));
    try {
      const dom = editor.view.domAtPos(from)?.node;
      const el = dom?.nodeType === 3 ? dom.parentElement : dom;
      el?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    } catch (_) {}
  };

  const replaceOne = () => {
    if (!total || current < 0) return;
    const [from, to] = ranges[current];
    editor.chain().focus().insertContentAt({ from, to }, r).run();
    // Recompute matches after the replacement transaction settles. Dispatching
    // the meta synchronously here re-enters ProseMirror mid-commit and the
    // replacement gets rolled back — the deferral is load-bearing, not just a
    // cosmetic debounce.
    setTimeout(() => {
      const next = findMatches(editor.state.doc, q);
      editor.view.dispatch(editor.state.tr.setMeta(findKey, { ranges: next, current: Math.min(current, next.length - 1) }));
    }, 0);
  };
  const replaceAll = () => {
    if (!total) return;
    // Replace from end to start so positions don't shift mid-loop.
    const chain = editor.chain().focus();
    [...ranges].reverse().forEach(([from, to]) => chain.insertContentAt({ from, to }, r));
    chain.run();
    setTimeout(() => {
      editor.view.dispatch(editor.state.tr.setMeta(findKey, { ranges: [], current: -1 }));
    }, 0);
  };

  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      // Stop the Escape here — otherwise it also bubbles to the doc card
      // modal's handler and closes the WHOLE doc, not just the find bar.
      e.stopPropagation();
      e.nativeEvent?.stopImmediatePropagation?.();
      // From the Replace field, Escape collapses Replace and returns to Find
      // instead of closing the whole bar.
      if (showReplace && e.target === replaceInputRef.current) {
        setShowReplace(false);
        inputRef.current?.focus();
        return;
      }
      close();
    }
    else if (e.key === 'Enter') { e.preventDefault(); goto((current >= 0 ? current : -1) + (e.shiftKey ? -1 : 1)); }
  };

  return (
    <div className="doc-find" onKeyDown={onKey}>
      <input ref={inputRef}
             className="doc-find-input"
             placeholder="Find"
             value={q}
             onChange={(e) => setQ(e.target.value)} />
      <span className="doc-find-count">
        {total === 0 ? (q ? '0/0' : '') : `${current + 1}/${total}`}
      </span>
      <button className="doc-find-btn" onClick={() => goto((current < 0 ? 0 : current) - 1)} title="Previous (⇧⏎)">↑</button>
      <button className="doc-find-btn" onClick={() => goto((current < 0 ? 0 : current) + 1)} title="Next (⏎)">↓</button>
      <button className={`doc-find-btn ${showReplace ? 'is-active' : ''}`}
              onClick={() => setShowReplace(s => !s)} title="Replace">⇄</button>
      {showReplace && (
        <>
          <span className="doc-find-sep" />
          <input ref={replaceInputRef}
                 className="doc-find-input"
                 placeholder="Replace"
                 value={r}
                 onChange={(e) => setR(e.target.value)} />
          <button className="doc-find-btn" onClick={replaceOne}>One</button>
          <button className="doc-find-btn" onClick={replaceAll}>All</button>
        </>
      )}
      <button className="doc-find-x" onClick={close} title="Close (Esc)">×</button>
    </div>
  );
}
