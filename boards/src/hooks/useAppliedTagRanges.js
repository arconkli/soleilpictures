// Subscribes to the entity_links rows that paint tag-color underlines
// inside a doc page. Returns an array kept fresh via Supabase realtime
// so the editor plugin can re-render decorations as soon as the AI
// tagger writes new applied ranges.
//
// Returned shape:
//   [{ pHash, startOffset, length, tagId, tagColor, tagName, source }]
//
// Range rows have source_anchor != NULL. Page-level applies (with no
// anchor) are not included — those drive the chip strip at the top,
// not the inline underlines.

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

export function useAppliedTagRanges({ workspaceId, docCardId, pageId }) {
  const [ranges, setRanges] = useState([]);

  useEffect(() => {
    if (!supabase || !workspaceId || !docCardId || !pageId) {
      setRanges([]);
      return;
    }
    let cancelled = false;

    const load = async () => {
      // Pull range rows for this page only.
      const { data: rows, error } = await supabase.from('entity_links')
        .select('target_id, source, source_anchor')
        .eq('source_kind', 'doc')
        .eq('source_id', docCardId)
        .eq('source_page_id', pageId)
        .eq('target_kind', 'tag')
        .eq('link_kind', 'applied')
        .not('source_anchor', 'is', null);
      if (cancelled) return;
      if (error || !rows?.length) { setRanges([]); return; }

      // Hydrate tag color + name for each unique tag id.
      const tagIds = Array.from(new Set(rows.map(r => r.target_id).filter(Boolean)));
      const { data: tags } = await supabase.from('tags')
        .select('id, name, color')
        .in('id', tagIds);
      const tagsById = new Map((tags || []).map(t => [t.id, t]));
      const out = [];
      for (const r of rows) {
        const a = r.source_anchor || {};
        if (!a.pHash || typeof a.startOffset !== 'number' || typeof a.length !== 'number') continue;
        const t = tagsById.get(r.target_id);
        if (!t) continue;
        out.push({
          pHash: a.pHash,
          startOffset: a.startOffset,
          length: a.length,
          tagId: r.target_id,
          tagColor: t.color || fallbackColor(t.name || r.target_id),
          tagName: t.name || 'Tag',
          source: r.source,
        });
      }
      if (!cancelled) setRanges(out);
    };
    load();

    const sfx = Math.random().toString(36).slice(2, 9);
    const ch = supabase.channel(`tag-ranges:${docCardId}:${pageId}:${sfx}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'entity_links',
      }, (payload) => {
        const r = payload?.new || payload?.old || {};
        if (r.target_kind !== 'tag') return;
        if (r.source_kind !== 'doc') return;
        if (r.source_id !== docCardId) return;
        if (r.source_page_id !== pageId) return;
        // Reload — cheap query.
        load();
      })
      .subscribe();
    return () => {
      cancelled = true;
      try { supabase.removeChannel(ch); } catch (_) {}
    };
  }, [workspaceId, docCardId, pageId]);

  return ranges;
}

const PALETTE = [
  '#4f8df8', '#22d3ee', '#10b981', '#84cc16', '#f59e0b',
  '#ef4444', '#ec4899', '#a78bfa', '#6366f1', '#0ea5e9',
];
function fallbackColor(s) {
  const str = (s || '').toString();
  let h = 0; for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}
