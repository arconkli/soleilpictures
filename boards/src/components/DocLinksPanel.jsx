import { useState, useEffect } from 'react';
import { listLinks } from '../lib/links.js';
import { Icon } from './Icon.jsx';
import { LayoutGrid, FileText, StickyNote, Link as LinkIcon } from '../lib/icons.js';
import { COVER_TINTS } from './primitives.jsx';
import { supabase } from '../lib/supabase.js';

const KIND_ICON = {
  board: LayoutGrid,
  card: StickyNote,
  doc: FileText,
  docPos: FileText,
  url: LinkIcon,
};

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
              <LinkRow key={l.id} link={l} onClick={() => jumpTo(l)} />
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

function LinkRow({ link, onClick }) {
  const primary = link.targets?.[0];
  const more = (link.targets?.length || 0) - 1;
  const [meta, setMeta] = useState(null);

  useEffect(() => {
    if (!supabase || !primary) return;
    let cancelled = false;
    (async () => {
      try {
        if (primary.kind === 'board') {
          const { data } = await supabase.from('boards').select('name,cover').eq('id', primary.id).maybeSingle();
          if (!cancelled && data) setMeta({ title: data.name, sub: 'BOARD', cover: data.cover });
        } else if (primary.kind === 'card') {
          const { data } = await supabase.from('card_index').select('title,kind').eq('board_id', primary.boardId).eq('card_id', primary.cardId).maybeSingle();
          if (!cancelled && data) setMeta({ title: data.title || 'Untitled', sub: (data.kind || 'card').toUpperCase() });
        } else if (primary.kind === 'doc' || primary.kind === 'docPos') {
          const { data } = await supabase.from('card_index').select('title').eq('card_id', primary.docCardId).maybeSingle();
          if (!cancelled && data) setMeta({ title: data.title || 'Untitled', sub: 'DOC' });
        } else if (primary.kind === 'url') {
          let host = primary.href;
          try { host = new URL(primary.href).hostname; } catch {}
          if (!cancelled) setMeta({ title: host, sub: 'URL', host });
        }
      } catch (_) {}
    })();
    return () => { cancelled = true; };
  }, [primary?.kind, primary?.id, primary?.boardId, primary?.cardId, primary?.docCardId, primary?.href]);

  if (!primary) {
    return (
      <button className="doc-links-row" onClick={onClick}>
        <span className="doc-links-row-name">{link.name || 'Empty link'}</span>
      </button>
    );
  }

  const IconCmp = KIND_ICON[primary.kind] || LinkIcon;
  const tint = COVER_TINTS[meta?.cover] || COVER_TINTS.warm;

  return (
    <button className="doc-links-row" onClick={onClick}>
      <div className="doc-links-row-cover" style={primary.kind === 'url'
        ? { background: 'var(--bg-3)' }
        : { background: `linear-gradient(135deg, ${tint}, color-mix(in oklab, ${tint} 35%, var(--bg-2)))`, color: 'var(--ink-0)' }}>
        {primary.kind === 'url' && meta?.host
          ? <img alt="" src={`https://www.google.com/s2/favicons?domain=${meta.host}&sz=64`} width={18} height={18} />
          : <Icon as={IconCmp} size={14} />}
      </div>
      <div className="doc-links-row-meta">
        <div className="doc-links-row-title">{meta?.title || link.name || 'Loading…'}</div>
        <div className="doc-links-row-sub t-meta">
          {meta?.sub || primary.kind.toUpperCase()}{more > 0 ? ` · +${more} more` : ''}
        </div>
      </div>
    </button>
  );
}
