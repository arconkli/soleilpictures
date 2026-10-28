// Suggested tags for the cards on one cluster: the open tag_suggestions rows
// (not dismissed) that the AI tagger wrote for them. The canvas shows the
// closest one on each card as a hollow chip, accepted or dismissed in one
// tap; the per-tag inbox on the tag page, where these used to wait unopened,
// keeps the rest.
//
// Refreshes when this tab tags or untags something (TAG_LINKS_CHANGED) or
// writes a suggestion (TAG_SUGGESTIONS_CHANGED, from useAiTagger), and when
// the server writes one: a picture's suggestions arrive a few minutes after
// it lands (the describe job, 0594), so the cluster hears tag_suggestions
// inserts for itself and reloads a second later.

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { TAG_LINKS_CHANGED } from '../lib/tagsApi.js';

export const TAG_SUGGESTIONS_CHANGED = 'soleil-tag-suggestions-changed';

export function announceTagSuggestionsChanged() {
  try { document.dispatchEvent(new CustomEvent(TAG_SUGGESTIONS_CHANGED)); } catch (_) {}
}

// → Map<cardId, [{ tagId, distance, origin }]>, closest first. `origin` is
// 'embed' (from the card's words) or 'vision' / 'vision-embed' (from what is
// in its picture), for the chip's tooltip.
export function useTagSuggestions({ boardId, enabled }) {
  const [byCard, setByCard] = useState(() => new Map());
  const reqRef = useRef(0);

  const load = useCallback(async () => {
    const req = ++reqRef.current;
    if (!supabase || !boardId || !enabled) { setByCard(new Map()); return; }
    const { data, error } = await supabase.from('tag_suggestions')
      .select('tag_id, source_id, distance, origin')
      .eq('board_id', boardId)
      .eq('source_kind', 'card')
      .is('dismissed_at', null)
      .order('distance', { ascending: true })
      .limit(500);
    if (req !== reqRef.current) return;
    if (error) { setByCard(new Map()); return; }
    const m = new Map();
    for (const r of data || []) {
      if (!m.has(r.source_id)) m.set(r.source_id, []);
      m.get(r.source_id).push({ tagId: r.tag_id, distance: r.distance, origin: r.origin || 'embed' });
    }
    setByCard(m);
  }, [boardId, enabled]);

  useEffect(() => {
    load();
    const reload = () => load();
    document.addEventListener(TAG_LINKS_CHANGED, reload);
    document.addEventListener(TAG_SUGGESTIONS_CHANGED, reload);
    return () => {
      document.removeEventListener(TAG_LINKS_CHANGED, reload);
      document.removeEventListener(TAG_SUGGESTIONS_CHANGED, reload);
    };
  }, [load]);

  useEffect(() => {
    if (!supabase || !boardId || !enabled) return undefined;
    let t = null;
    // Per mount: a channel name reused before its removal lands refuses new
    // callbacks (useVoteCards.js says the same).
    const sfx = Math.random().toString(36).slice(2, 9);
    const chan = supabase.channel(`tag-suggestions:${boardId}:${sfx}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tag_suggestions', filter: `board_id=eq.${boardId}` },
        () => { clearTimeout(t); t = setTimeout(() => load(), 1000); })
      .subscribe();
    return () => { clearTimeout(t); try { supabase.removeChannel(chan); } catch (_) {} };
  }, [boardId, enabled, load]);

  return { byCard, reload: load };
}

// One tap: keep it (the tag is applied by the person, the suggestion goes).
export async function acceptCardSuggestion({ tagId, cardId }) {
  const { error } = await supabase.from('tag_suggestions').delete()
    .eq('tag_id', tagId).eq('source_kind', 'card').eq('source_id', String(cardId));
  if (error) throw error;
  announceTagSuggestionsChanged();
}

// One tap: never suggest it here (dismissed, and the item remembers it).
export async function dismissCardSuggestion({ tagId, cardId }) {
  const { error } = await supabase.from('tag_suggestions')
    .update({ dismissed_at: new Date().toISOString() })
    .eq('tag_id', tagId).eq('source_kind', 'card').eq('source_id', String(cardId));
  if (error) throw error;
  announceTagSuggestionsChanged();
}
