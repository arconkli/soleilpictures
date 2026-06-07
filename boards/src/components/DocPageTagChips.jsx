// Tag chip strip rendered at the top of a doc page. Reads
// entity_links rows where (source_kind='doc', source_id=docCardId,
// source_page_id=pageId, target_kind='tag', link_kind='applied') and
// renders a clickable chip per tag — color dot + name. Clicking
// navigates to the tag detail view via the standard entity-navigate
// hook. Realtime-subscribed so AI applies appear without refresh.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useEntityNavigate } from '../hooks/useEntityNavigate.js';
import { untagDocPage } from '../lib/tagsApi.js';

const TAG_PALETTE = [
  '#4f8df8', '#22d3ee', '#10b981', '#84cc16', '#f59e0b',
  '#ef4444', '#ec4899', '#a78bfa', '#6366f1', '#0ea5e9',
];
function fallbackColor(s) {
  const str = (s || '').toString();
  let h = 0; for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return TAG_PALETTE[Math.abs(h) % TAG_PALETTE.length];
}

export function DocPageTagChips({ workspaceId, docCardId, pageId }) {
  const navigate = useEntityNavigate();
  const [tagIds, setTagIds] = useState([]);
  const [tagsById, setTagsById] = useState(new Map());
  const [menuFor, setMenuFor] = useState(null); // { tagId, name, x, y } when right-click is active

  // Fetch applied-tag ids for this page.
  useEffect(() => {
    if (!supabase || !docCardId || !pageId) return;
    let cancelled = false;
    const load = async () => {
      const { data, error } = await supabase.from('entity_links')
        .select('target_id')
        .eq('source_kind', 'doc')
        .eq('source_id', docCardId)
        .eq('source_page_id', pageId)
        .eq('target_kind', 'tag')
        .eq('link_kind', 'applied');
      if (cancelled) return;
      if (error) { setTagIds([]); return; }
      const ids = Array.from(new Set((data || []).map(r => r.target_id).filter(Boolean)));
      setTagIds(ids);
    };
    load();

    const sfx = Math.random().toString(36).slice(2, 9);
    const chan = supabase.channel(`doc-page-tags:${docCardId}:${pageId}:${sfx}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'entity_links',
      }, (payload) => {
        const r = payload?.new || payload?.old || {};
        const matches = r.source_kind === 'doc'
          && r.source_id === docCardId
          && r.source_page_id === pageId
          && r.target_kind === 'tag'
          && r.link_kind === 'applied';
        if (matches) load();
      })
      .subscribe();
    return () => {
      cancelled = true;
      try { supabase.removeChannel(chan); } catch (_) {}
    };
  }, [docCardId, pageId]);

  // Hydrate tag rows for color + name.
  useEffect(() => {
    if (!supabase || tagIds.length === 0) { setTagsById(new Map()); return; }
    let cancelled = false;
    supabase.from('tags').select('id, name, color').in('id', tagIds)
      .then(({ data }) => {
        if (cancelled) return;
        const m = new Map();
        for (const t of (data || [])) m.set(t.id, t);
        setTagsById(m);
      });
    return () => { cancelled = true; };
  }, [tagIds.join(',')]);

  const chips = useMemo(() => {
    return tagIds.map(id => {
      const t = tagsById.get(id);
      return {
        id,
        name: t?.name || '',
        color: t?.color || fallbackColor(t?.name || id),
      };
    }).filter(c => c.name);
  }, [tagIds, tagsById]);

  // Outside-click + Escape close the right-click menu.
  useEffect(() => {
    if (!menuFor) return;
    const onDown = (e) => {
      if (e.target.closest && e.target.closest('.doc-page-tag-menu')) return;
      setMenuFor(null);
    };
    const onKey = (e) => { if (e.key === 'Escape') setMenuFor(null); };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuFor]);

  const removeTag = async (tagId) => {
    setMenuFor(null);
    // Optimistic local drop — realtime will reconcile.
    setTagIds(prev => prev.filter(id => id !== tagId));
    try {
      await untagDocPage({ workspaceId, docCardId, pageId, tagId });
    } catch (_) {
      // On failure, the realtime sub will restore the row on next load.
    }
  };

  if (chips.length === 0) return null;

  return (
    <>
      <div className="doc-page-tag-chips" role="list">
        {chips.map(c => (
          <button key={c.id}
                  className="doc-page-tag-chip"
                  role="listitem"
                  title={`Open tag "${c.name}" — right-click to remove`}
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate({ kind: 'tag', id: c.id });
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setMenuFor({ tagId: c.id, name: c.name, x: e.clientX, y: e.clientY });
                  }}>
            <span className="doc-page-tag-dot" style={{ background: c.color }} />
            <span className="doc-page-tag-name">{c.name}</span>
          </button>
        ))}
      </div>
      {menuFor && (
        <div className="doc-page-tag-menu"
             style={{ position: 'fixed', top: menuFor.y, left: menuFor.x, zIndex: 1000 }}>
          <button className="doc-page-tag-menu-item"
                  onClick={() => removeTag(menuFor.tagId)}>
            Remove tag
          </button>
        </div>
      )}
    </>
  );
}
