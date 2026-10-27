// Suggested tags for the cards on one cluster: the open tag_suggestions rows
// (not dismissed) that the AI tagger wrote for them. The canvas shows the
// closest one on each card as a hollow chip, accepted or dismissed in one
// tap; the per-tag inbox on the tag page, where these used to wait unopened,
// keeps the rest.
//
// Refreshes when this tab tags or untags something (TAG_LINKS_CHANGED) or
// writes a suggestion (TAG_SUGGESTIONS_CHANGED, from useAiTagger).

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { TAG_LINKS_CHANGED } from '../lib/tagsApi.js';

export const TAG_SUGGESTIONS_CHANGED = 'soleil-tag-suggestions-changed';

export function announceTagSuggestionsChanged() {
  try { document.dispatchEvent(new CustomEvent(TAG_SUGGESTIONS_CHANGED)); } catch (_) {}
}

// → Map<cardId, [{ tagId, distance }]>, closest first.
export function useTagSuggestions({ boardId, enabled }) {
  const [byCard, setByCard] = useState(() => new Map());
  const reqRef = useRef(0);

  const load = useCallback(async () => {
    const req = ++reqRef.current;
    if (!supabase || !boardId || !enabled) { setByCard(new Map()); return; }
    const { data, error } = await supabase.from('tag_suggestions')
      .select('tag_id, source_id, distance')
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
      m.get(r.source_id).push({ tagId: r.tag_id, distance: r.distance });
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
