// Footer below the editor — live word/character count + an HONEST save status.
//
// The save indicator is driven by yboard's real persistence lifecycle (the
// `soleil-board-save-state` event: saving → saved / error) rather than a fixed
// timer — so it no longer claims "Saved" when a write actually failed, and
// peer edits don't flip your own indicator.

import { useEffect, useState } from 'react';

export function DocStatusFooter({ editor, ydoc, boardId = null }) {
  const [counts, setCounts] = useState({ words: 0, chars: 0 });
  const [savedAt, setSavedAt] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

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

  // Save indicator driven by yboard's actual save lifecycle.
  useEffect(() => {
    const onState = (e) => {
      const d = e.detail || {};
      // Match this board (when known); if boardId is unknown, accept any.
      if (boardId && d.boardId && d.boardId !== boardId) return;
      if (d.state === 'saving') { setSaving(true); setSaveError(false); }
      else if (d.state === 'saved') { setSaving(false); setSaveError(false); setSavedAt(d.ts || Date.now()); }
      else if (d.state === 'error') { setSaving(false); setSaveError(true); }
    };
    window.addEventListener('soleil-board-save-state', onState);
    return () => window.removeEventListener('soleil-board-save-state', onState);
  }, [boardId]);

  // Force a re-render every 30s so the "saved Xs ago" label stays fresh.
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force(n => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  // Honest offline state: edits keep applying locally (Yjs), but the
  // snapshot can't persist remotely — say so instead of "Saved Xs ago".
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  const savedLabel = (() => {
    if (!online) return 'Offline — changes will sync when you reconnect';
    if (saveError) return "Couldn't save — retrying";
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
      <span className={`doc-foot-status ${saving ? 'is-saving' : ''} ${!online ? 'is-offline' : ''} ${saveError ? 'is-error' : ''}`}>{savedLabel}</span>
      <span className="doc-foot-spacer" />
      <span className="doc-foot-counts">
        {counts.words} {counts.words === 1 ? 'word' : 'words'} · {counts.chars} {counts.chars === 1 ? 'char' : 'chars'}
      </span>
    </div>
  );
}
