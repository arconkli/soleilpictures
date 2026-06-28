// Modal picker for inserting a board embed in a doc. Shows a filterable
// list of every board in the workspace; click one to insert as an embed.

import { useEffect, useMemo, useRef, useState } from 'react';

export function DocBoardEmbedPicker({ boards, onPick, onClose }) {
  const [q, setQ] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const list = useMemo(() => {
    const arr = Object.values(boards || {})
      .filter(b => b && b.id && b.name)
      .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
    if (!q.trim()) return arr.slice(0, 50);
    const f = q.toLowerCase();
    return arr.filter(b => b.name.toLowerCase().includes(f)).slice(0, 50);
  }, [boards, q]);

  return (
    <div className="doc-tplbg" onClick={onClose}>
      <div className="doc-embed-picker" ref={ref} onClick={(e) => e.stopPropagation()}>
        <div className="doc-tpl-head">
          <div>
            <div className="doc-tpl-kicker">Embed cluster</div>
            <div className="doc-tpl-title">Pick a cluster to link to</div>
          </div>
          <button className="doc-tpl-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <input autoFocus
               className="doc-embed-search"
               placeholder="Search clusters…"
               value={q}
               onChange={(e) => setQ(e.target.value)} />
        <div className="doc-embed-list">
          {list.length === 0 && <div className="doc-embed-empty">No clusters match.</div>}
          {list.map(b => (
            <button key={b.id} className="doc-embed-row"
                    onClick={() => { onPick({ boardId: b.id, label: b.name }); onClose(); }}>
              <span className="doc-embed-row-icon">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <rect x="1.5" y="1.5" width="11" height="11" rx="1.6" stroke="currentColor" strokeWidth="1.2"/>
                  <path d="M1.5 5.5 H12.5" stroke="currentColor" strokeWidth="1.2"/>
                </svg>
              </span>
              <span className="doc-embed-row-name">{b.name}</span>
              <span className="doc-embed-row-meta">{b.view === 'list' ? 'list' : 'board'}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
