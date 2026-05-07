// Magazine-editorial title block at the top of every doc page.
// Renders inside the .doc-flow column above the editor itself:
//
//   Q1 Strategy             ← editable serif title (h1-sized)
//   ─────                   ← thin soleil rule, 80px wide
//   Andrew · 2d ago · 4 min · 3 pages · 123 words
//
// Saving status replaces "last edit" with a soleil pulse while a
// write is in flight. Read-time is words / 220 minutes (rounded up).

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { relativeTimeShort } from '../lib/relativeTime.js';

export function DocTitleBlock({
  // Title (the doc card's name). Editable; commits on blur.
  title,
  onTitleChange,
  placeholder = 'Untitled',
  // Live editor + ydoc for word count + saving indicator.
  editor,
  ydoc,
  // Static byline pieces — author resolved by the host App so we
  // don't have to plumb auth/users into here.
  author,
  pageCount = 0,
  lastEditAt,
}) {
  const [counts, setCounts] = useState({ words: 0, chars: 0 });
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(lastEditAt || null);
  const [, force] = useState(0);
  const titleRef = useRef(null);

  // Word/char count for the active page.
  useEffect(() => {
    if (!editor) { setCounts({ words: 0, chars: 0 }); return; }
    const tick = () => {
      const text = editor.state.doc.textContent || '';
      const words = text.trim() ? text.trim().split(/\s+/).length : 0;
      setCounts({ words, chars: text.length });
    };
    tick();
    editor.on('update', tick);
    return () => { editor.off('update', tick); };
  }, [editor]);

  // Saving indicator — mirrors yboard.js's debounce timing.
  useEffect(() => {
    if (!ydoc) return;
    let t = null;
    const onUpdate = (_u, origin) => {
      if (origin === 'snapshot' || origin === 'restore') return;
      setSaving(true);
      if (t) clearTimeout(t);
      t = setTimeout(() => { setSaving(false); setSavedAt(Date.now()); }, 280);
    };
    ydoc.on('update', onUpdate);
    return () => { ydoc.off('update', onUpdate); if (t) clearTimeout(t); };
  }, [ydoc]);

  // Tick every 30s so "2d ago" stays fresh.
  useEffect(() => {
    const i = setInterval(() => force(n => (n + 1) | 0), 30000);
    return () => clearInterval(i);
  }, []);

  // Auto-grow the textarea so multi-line titles don't clip.
  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [title]);

  const readMin = useMemo(() => Math.max(1, Math.ceil(counts.words / 220)), [counts.words]);
  const lastEditLabel = (() => {
    if (!savedAt) return null;
    return relativeTimeShort(savedAt);
  })();

  const onTitleKeyDown = (e) => {
    // Enter commits + moves focus to the editor instead of inserting a newline.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.currentTarget.blur();
      try { editor?.commands?.focus?.('start'); } catch (_) {}
    }
  };

  return (
    <header className="doc-title-block">
      <textarea
        ref={titleRef}
        className="doc-title-input"
        rows={1}
        value={title || ''}
        placeholder={placeholder}
        onChange={(e) => onTitleChange?.(e.target.value)}
        onKeyDown={onTitleKeyDown}
      />
      <div className="doc-title-rule" />
      <div className="doc-byline">
        {author && <span className="doc-byline-item">{author}</span>}
        {author && <span className="doc-byline-sep">·</span>}
        {saving
          ? <span className="doc-byline-saving">Saving…</span>
          : (lastEditLabel && <span className="doc-byline-item">{lastEditLabel}</span>)}
        <span className="doc-byline-sep">·</span>
        <span className="doc-byline-item">{readMin} min read</span>
        {pageCount > 0 && <>
          <span className="doc-byline-sep">·</span>
          <span className="doc-byline-item">{pageCount} {pageCount === 1 ? 'page' : 'pages'}</span>
        </>}
        <span className="doc-byline-sep">·</span>
        <span className="doc-byline-item">{counts.words} {counts.words === 1 ? 'word' : 'words'}</span>
      </div>
    </header>
  );
}
