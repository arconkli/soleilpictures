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

export function DocFindReplace({ editor, editors = [], open, onClose }) {
  const [q, setQ] = useState('');
  const [r, setR] = useState('');
  const [showReplace, setShowReplace] = useState(false);
  const [total, setTotal] = useState(0);
  const [current, setCurrent] = useState(0);
  const inputRef = useRef(null);
  const replaceInputRef = useRef(null);

  // Search/replace span EVERY mounted sheet of the active page (a prose doc
  // auto-paginates past one page, and find used to see only the focused sheet).
  const eds = editors.length ? editors : (editor ? [editor] : []);
  const edsKey = eds.length; // cheap dep: re-run when the sheet count changes

  // All matches across all sheet editors, in sheet then document order.
  const computeAll = () => {
    const all = [];
    eds.forEach((ed, ei) => {
      for (const [from, to] of findMatches(ed.state.doc, q)) all.push({ ei, from, to });
    });
    return all;
  };
  const clearAll = () => {
    eds.forEach((ed) => {
      try { ed.view.dispatch(ed.state.tr.setMeta(findKey, { ranges: [], current: -1 })); } catch (_) {}
    });
  };
  // Paint highlights in each editor; mark the global-current hit in its owner.
  const pushHighlights = (all, curIdx) => {
    const owner = (curIdx >= 0 && all[curIdx]) ? all[curIdx] : null;
    eds.forEach((ed, ei) => {
      const mine = all.filter(m => m.ei === ei);
      const ranges = mine.map(m => [m.from, m.to]);
      let localCur = -1;
      if (owner && owner.ei === ei) localCur = mine.findIndex(m => m.from === owner.from && m.to === owner.to);
      try { ed.view.dispatch(ed.state.tr.setMeta(findKey, { ranges, current: localCur })); } catch (_) {}
    });
  };
  const scrollTo = (m) => {
    const ed = eds[m.ei]; if (!ed) return;
    try {
      const dom = ed.view.domAtPos(m.from)?.node;
      const el = dom?.nodeType === 3 ? dom.parentElement : dom;
      el?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    } catch (_) {}
  };

  const close = () => {
    onClose();
    requestAnimationFrame(() => { try { (eds[0] || editor)?.commands?.focus(); } catch (_) {} });
  };

  // Recompute on query / open / sheet-count change; push into every editor.
  useEffect(() => {
    if (!eds.length) { setTotal(0); return; }
    if (!open) { clearAll(); setTotal(0); setCurrent(0); return; }
    const all = computeAll();
    setTotal(all.length);
    setCurrent(0);
    pushHighlights(all, all.length ? 0 : -1);
    if (all.length) scrollTo(all[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, q, edsKey]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  if (!open || !eds.length) return null;

  const goto = (idx) => {
    const all = computeAll();
    if (!all.length) { setTotal(0); return; }
    const next = ((idx % all.length) + all.length) % all.length;
    setCurrent(next);
    setTotal(all.length);
    pushHighlights(all, next);
    scrollTo(all[next]);
  };

  const replaceOne = () => {
    const all = computeAll();
    if (!all.length) return;
    const idx = Math.min(current, all.length - 1);
    const m = all[idx];
    const ed = eds[m.ei];
    // Preserve the matched text's OWN marks (read from inside the match, not the
    // boundary) so bold/link/etc. survive a replace.
    ed.chain().focus().command(({ tr, state }) => {
      const marks = tr.doc.resolve(Math.min(m.from + 1, m.to)).marks();
      if (r) tr.replaceWith(m.from, m.to, state.schema.text(r, marks)); else tr.delete(m.from, m.to);
      return true;
    }).run();
    // Defer: dispatching meta synchronously re-enters ProseMirror mid-commit
    // and the replacement gets rolled back.
    setTimeout(() => {
      const a2 = computeAll();
      const cur = a2.length ? Math.min(idx, a2.length - 1) : -1;
      setTotal(a2.length); setCurrent(Math.max(0, cur));
      pushHighlights(a2, cur);
    }, 0);
  };
  const replaceAll = () => {
    eds.forEach((ed) => {
      const ranges = findMatches(ed.state.doc, q);
      if (!ranges.length) return;
      // End→start so earlier positions don't shift; preserve each match's marks.
      ed.chain().focus().command(({ tr, state }) => {
        [...ranges].reverse().forEach(([from, to]) => {
          const marks = tr.doc.resolve(Math.min(from + 1, to)).marks();
          if (r) tr.replaceWith(from, to, state.schema.text(r, marks)); else tr.delete(from, to);
        });
        return true;
      }).run();
    });
    setTimeout(() => { clearAll(); setTotal(0); setCurrent(0); }, 0);
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
    <div className="doc-find" onKeyDown={onKey} role="search" aria-label="Find in document">
      <input ref={inputRef}
             className="doc-find-input"
             placeholder="Find"
             aria-label="Find"
             value={q}
             onChange={(e) => setQ(e.target.value)} />
      <span className="doc-find-count" aria-live="polite">
        {total === 0 ? (q ? '0/0' : '') : `${current + 1}/${total}`}
      </span>
      <button className="doc-find-btn" onClick={() => goto((current < 0 ? 0 : current) - 1)} title="Previous (⇧⏎)" aria-label="Previous match">↑</button>
      <button className="doc-find-btn" onClick={() => goto((current < 0 ? 0 : current) + 1)} title="Next (⏎)" aria-label="Next match">↓</button>
      <button className={`doc-find-btn ${showReplace ? 'is-active' : ''}`}
              onClick={() => setShowReplace(s => !s)} title="Replace" aria-label="Toggle replace" aria-pressed={showReplace}>⇄</button>
      {showReplace && (
        <>
          <span className="doc-find-sep" aria-hidden="true" />
          <input ref={replaceInputRef}
                 className="doc-find-input"
                 placeholder="Replace"
                 aria-label="Replace with"
                 value={r}
                 onChange={(e) => setR(e.target.value)} />
          <button className="doc-find-btn" onClick={replaceOne}>One</button>
          <button className="doc-find-btn" onClick={replaceAll}>All</button>
        </>
      )}
      <button className="doc-find-x" onClick={close} title="Close (Esc)" aria-label="Close find">×</button>
    </div>
  );
}
