// Tag chip strip rendered at the top of a doc page. Reads
// entity_links rows where (source_kind='doc', source_id=docCardId,
// source_page_id=pageId, target_kind='tag', link_kind='applied') and
// renders a clickable chip per tag — color dot + name. Clicking
// navigates to the tag detail view via the standard entity-navigate
// hook. Realtime-subscribed so AI applies appear without refresh.

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useEntityNavigate } from '../hooks/useEntityNavigate.js';
import { untagDocPage, restoreDocTagRows, TAG_LINKS_CHANGED } from '../lib/tagsApi.js';
import { isDeleteEvent } from '../lib/tagSurface.js';
import { tagFallbackColor } from '../lib/tagColor.js';
import { useFeedback } from './AppFeedback.jsx';
import { undoToast } from '../lib/undoToast.js';
import { CardContextMenu } from './CardContextMenu.jsx';
import { useLongPress } from '../hooks/useLongPress.js';
import { swallowNextClick } from '../lib/swallowClick.js';
import { t } from '@lingui/core/macro';

export function DocPageTagChips({ workspaceId, docCardId, pageId }) {
  const navigate = useEntityNavigate();
  const feedback = useFeedback();
  const [tagIds, setTagIds] = useState([]);
  const [tagsById, setTagsById] = useState(new Map());
  const [menuFor, setMenuFor] = useState(null); // { tagId, name, x, y, byKey?, returnEl? } while the menu is open
  // A hold on a chip (touch) opens the same menu; iOS never raises contextmenu.
  const wrapRef = useRef(null);
  useLongPress(wrapRef, (x, y, e) => {
    const el = e.target?.closest?.('.doc-page-tag-chip');
    if (!el) return false;
    const c = chips.find(ch => ch.id === el.dataset.tagId);
    if (!c) return false;
    swallowNextClick({ held: true });
    setMenuFor({ tagId: c.id, name: c.name, x, y });
    return true;
  }, { ms: 480, tolerance: 8, pointerType: 'touch' });

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

    // Workspace-scoped (see tagSurface.js): unfiltered, this received every
    // entity_links DELETE on the platform. A bare DELETE (only the row id)
    // can't be attributed, so it is ignored; this tab's removals arrive
    // through TAG_LINKS_CHANGED, a peer's on the next load.
    const sfx = Math.random().toString(36).slice(2, 9);
    const chan = workspaceId ? supabase.channel(`doc-page-tags:${docCardId}:${pageId}:${sfx}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'entity_links',
        filter: `source_workspace=eq.${workspaceId}`,
      }, (payload) => {
        if (isDeleteEvent(payload)) return;
        const r = payload?.new || {};
        const matches = r.source_kind === 'doc'
          && r.source_id === docCardId
          && r.source_page_id === pageId
          && r.target_kind === 'tag'
          && r.link_kind === 'applied';
        if (matches) load();
      })
      .subscribe() : null;
    document.addEventListener(TAG_LINKS_CHANGED, load);
    return () => {
      cancelled = true;
      document.removeEventListener(TAG_LINKS_CHANGED, load);
      if (chan) { try { supabase.removeChannel(chan); } catch (_) {} }
    };
  }, [workspaceId, docCardId, pageId]);

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
        color: t?.color || tagFallbackColor(t?.name || id),
      };
    }).filter(c => c.name);
  }, [tagIds, tagsById]);

  const removeTag = async (tagId) => {
    setMenuFor(null);
    // Optimistic local drop — realtime will reconcile.
    setTagIds(prev => prev.filter(id => id !== tagId));
    try {
      const removed = await untagDocPage({ workspaceId, docCardId, pageId, tagId });
      undoToast(feedback, {
        message: t`Tag removed`,
        onUndo: async () => {
          try {
            // Exactly the rows that came off: the page row and every range,
            // not one page row in their place.
            await restoreDocTagRows({ workspaceId, docCardId, pageId, tagId, rows: removed });
            setTagIds(prev => (prev.includes(tagId) ? prev : [...prev, tagId]));
          } catch (_) {}
        },
      });
    } catch (_) {
      // On failure, the realtime sub will restore the row on next load.
    }
  };

  // Always rendered, so the hold above finds its element once chips arrive.
  return (
    <div ref={wrapRef} style={{ display: 'contents' }}>
      {chips.length > 0 && (
      <div className="doc-page-tag-chips" role="list">
        {chips.map(c => (
          <button key={c.id}
                  className="doc-page-tag-chip"
                  role="listitem"
                  data-tag-id={c.id}
                  style={{ '--tag-c': c.color }}
                  title={t`Open tag "${c.name}"`}
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate({ kind: 'tag', id: c.id });
                  }}
                  onKeyDown={(e) => {
                    // ⇧F10 / the Menu key on a focused chip.
                    if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const r = e.currentTarget.getBoundingClientRect();
                    setMenuFor({ tagId: c.id, name: c.name, x: r.left, y: r.bottom + 4, byKey: true, returnEl: e.currentTarget });
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setMenuFor({ tagId: c.id, name: c.name, x: e.clientX, y: e.clientY });
                  }}>
            <span className="doc-page-tag-dot" aria-hidden="true" />
            <span className="doc-page-tag-name" dir="auto">{c.name}</span>
          </button>
        ))}
      </div>
      )}
      <CardContextMenu
        open={!!menuFor}
        x={menuFor?.x ?? 0}
        y={menuFor?.y ?? 0}
        label={menuFor?.name}
        root="menu"
        byKey={!!menuFor?.byKey}
        returnFocus={menuFor?.returnEl}
        items={menuFor ? [
          { id: 'open-tag', label: t`Open tag`, icon: 'Tag', run: () => navigate({ kind: 'tag', id: menuFor.tagId }) },
          { id: 'remove-tag', label: t`Remove tag`, icon: 'X', run: () => removeTag(menuFor.tagId) },
        ] : []}
        onClose={() => setMenuFor(null)}
      />
    </div>
  );
}
