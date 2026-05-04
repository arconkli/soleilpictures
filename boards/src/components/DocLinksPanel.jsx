import { useState, useEffect } from 'react';
import { listLinks } from '../lib/links.js';

export function DocLinksPanel({ ydoc, pages = [], activePageId, onSelectPage, getEditor }) {
  const [links, setLinks] = useState([]);

  useEffect(() => {
    if (!ydoc) { setLinks([]); return; }
    const lm = ydoc.getMap('links');
    const refresh = () => setLinks(listLinks(ydoc));
    refresh();
    lm.observeDeep(refresh);
    return () => lm.unobserveDeep(refresh);
  }, [ydoc]);

  const pageById = (() => { const m = {}; pages.forEach(p => { m[p.id] = p; }); return m; })();
  const grouped = (() => {
    const m = new Map();
    for (const l of links) {
      if (!m.has(l.pageId)) m.set(l.pageId, []);
      m.get(l.pageId).push(l);
    }
    return m;
  })();

  const jumpTo = (l) => {
    if (l.pageId !== activePageId) onSelectPage?.(l.pageId);
    let tries = 0;
    const tick = () => {
      const ed = getEditor?.();
      if (!ed) { if (tries++ < 20) setTimeout(tick, 30); return; }
      try {
        ed.commands.focus();
        ed.commands.setTextSelection(l.anchor.from);
      } catch (_) {}
    };
    tick();
  };

  const labelFor = (l) =>
    l.name || `${l.targets[0]?.kind || 'link'}${l.targets.length > 1 ? ` · ${l.targets.length} targets` : ''}`;

  return (
    <div className="doc-links">
      <div className="doc-links-head">
        <span className="t-eyebrow doc-rail-label">LINKS</span>
      </div>
      <div className="doc-links-body">
        {[...grouped.entries()].map(([pageId, items]) => (
          <div key={pageId} className="doc-links-group">
            <div className="doc-links-page t-meta">{pageById[pageId]?.name || 'Untitled'}</div>
            {items.map(l => (
              <button key={l.id} className="doc-links-row" onClick={() => jumpTo(l)}>
                <span className="doc-links-row-name">{labelFor(l)}</span>
              </button>
            ))}
          </div>
        ))}
        {links.length === 0 && (
          <div className="doc-links-empty t-meta">No links yet. Select text and ⌘K to add one.</div>
        )}
      </div>
    </div>
  );
}
