// Footer below the editor — live word/character count + "saved Xs ago" status.
//
// Word count walks the active page's text. Autosave timestamp listens to the
// per-board Y.Doc 'update' event (any local edit). Display says "Saving…"
// for the first ~280ms after each edit (matches the snapshot debounce in
// yboard.js), then "Saved Xs ago".

import { useEffect, useState } from 'react';

export function DocStatusFooter({ editor, ydoc }) {
  const [counts, setCounts] = useState({ words: 0, chars: 0 });
  const [savedAt, setSavedAt] = useState(null);
  const [saving, setSaving] = useState(false);

  // Word/char count for current page.
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

  // Save indicator. yboard.js debounces snapshots ~250ms after each edit;
  // we mirror that timing locally so the user sees "Saving… → Saved" UI.
  useEffect(() => {
    if (!ydoc) return;
    let saveTimer = null;
    const onUpdate = (_u, origin) => {
      if (origin === 'snapshot' || origin === 'restore') return;
      setSaving(true);
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        setSaving(false);
        setSavedAt(Date.now());
      }, 280);
    };
    ydoc.on('update', onUpdate);
    return () => {
      ydoc.off('update', onUpdate);
      if (saveTimer) clearTimeout(saveTimer);
    };
  }, [ydoc]);

  // Force a re-render every 30s so the "saved Xs ago" label stays fresh.
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force(n => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const savedLabel = (() => {
    if (saving) return 'Saving…';
    if (!savedAt) return 'All changes saved';
    const ago = Math.max(0, Math.floor((Date.now() - savedAt) / 1000));
    if (ago < 5) return 'Saved just now';
    if (ago < 60) return `Saved ${ago}s ago`;
    if (ago < 3600) return `Saved ${Math.floor(ago / 60)}m ago`;
    return `Saved ${Math.floor(ago / 3600)}h ago`;
  })();

  return (
    <div className="doc-foot">
      <span className={`doc-foot-status ${saving ? 'is-saving' : ''}`}>{savedLabel}</span>
      <span className="doc-foot-spacer" />
      <span className="doc-foot-counts">
        {counts.words} {counts.words === 1 ? 'word' : 'words'} · {counts.chars} {counts.chars === 1 ? 'char' : 'chars'}
      </span>
    </div>
  );
}
