// Suggested-tags hook.
//
// Scans the workspace's text — board names, card titles + bodies,
// doc page text — and returns frequently-recurring terms that
// aren't already tags. The user can one-click any suggestion in
// the sidebar to create it as a real tag, after which the autotag
// engine picks it up everywhere.
//
// Heuristic, not ML. The signal is "how many distinct items
// mention this term." Words seen in only one card don't make the
// list; words that appear across 3+ items in 2+ boards do.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { tokenize } from '../lib/autotagEngine.js';

// Thresholds intentionally permissive — small workspaces have
// little cross-board overlap, so a too-strict gate (≥3 items
// across ≥2 boards) means a 50-card workspace shows zero
// suggestions, which is not useful. We surface the candidates
// and let the user dismiss the ones they don't want; dismissals
// persist per workspace.
const MIN_DOC_FREQ = 2;     // term must show up in N distinct items
const MIN_BOARD_FREQ = 1;   // multi-board overlap is a *bonus*, not a gate
const MIN_LEN = 4;          // 3-char filler ("per", "all") is rarely a useful tag
const MAX_RESULTS = 12;

// Hand-curated extension of the engine's stopword list — covers
// generic nouns/verbs that come up in the kind of text that ends
// up on a board (pricing pages, product descriptions, etc.) but
// are too generic to be useful tag candidates on their own.
const SUGGESTION_STOPWORDS = new Set([
  'space','editors','editor','viewer','viewers','people','total','user','users','per',
  'additional','available','also','include','includes','including','only',
  'limited','unlimited','free','plus','first','last','one','two','three','four','five',
  'click','here','this','that','these','those','from','with','your','their',
  'item','items','thing','things','stuff','something','anything',
]);

function pickInterestingTokens(tokens) {
  // Keep unigrams only (engine emits bigrams too — those are
  // useful for scoring but noisy as tag suggestions). Drop tokens
  // that don't start with a letter — strips stuff like "-10" and
  // "$25" that survive the engine's tokenizer because we keep
  // hyphens and digits intact for tag-like identifiers.
  return tokens.filter(t =>
    t.length >= MIN_LEN
    && !t.includes(' ')
    && /^[a-z]/.test(t)
    && !SUGGESTION_STOPWORDS.has(t)
  );
}

export function useSuggestedTags({ workspaceId, existingTagSlugs }) {
  const [rows, setRows] = useState({ boards: [], cards: [], pages: [] });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [b, ci, dp] = await Promise.all([
          supabase.from('boards').select('id, name').eq('workspace_id', workspaceId),
          supabase.from('card_index').select('board_id, card_id, title, body').eq('workspace_id', workspaceId),
          // Doc pages — the column is page_text (not "text"). Earlier
          // bug returned an error and silently dropped doc content
          // from the suggestion corpus.
          supabase.from('doc_page_index').select('doc_card_id, page_id, page_title, page_text').eq('workspace_id', workspaceId),
        ]);
        if (cancelled) return;
        setRows({
          boards: b.data || [],
          cards: ci.data || [],
          pages: dp.data || [],
        });
      } catch (err) {
        console.warn('[suggested-tags] load failed', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [workspaceId]);

  const suggestions = useMemo(() => {
    const blocked = new Set((existingTagSlugs || []).map(s => (s || '').toLowerCase()));
    // term -> { items: Set<itemKey>, boards: Set<boardId> }
    const stats = new Map();
    const bump = (term, itemKey, boardId) => {
      if (!term || term.length < MIN_LEN || blocked.has(term)) return;
      // Skip pure numbers — too noisy as tag candidates.
      if (/^\d+$/.test(term)) return;
      let s = stats.get(term);
      if (!s) { s = { items: new Set(), boards: new Set() }; stats.set(term, s); }
      s.items.add(itemKey);
      if (boardId) s.boards.add(boardId);
    };
    // Boards.
    for (const r of rows.boards) {
      const toks = pickInterestingTokens(tokenize(r.name || ''));
      const seen = new Set();
      for (const t of toks) { if (seen.has(t)) continue; seen.add(t); bump(t, `b:${r.id}`, r.id); }
    }
    // Cards (title + body). Each card is one item, regardless of
    // how many times the term appears within it — distinct-item
    // count is what matters for "this is a real topic in your
    // workspace," not raw frequency.
    for (const r of rows.cards) {
      const text = `${r.title || ''} ${r.body || ''}`;
      const toks = pickInterestingTokens(tokenize(text));
      const seen = new Set();
      for (const t of toks) { if (seen.has(t)) continue; seen.add(t); bump(t, `c:${r.board_id}:${r.card_id}`, r.board_id); }
    }
    // Doc pages.
    for (const r of rows.pages) {
      const text = `${r.page_title || ''} ${r.page_text || ''}`;
      const toks = pickInterestingTokens(tokenize(text));
      const seen = new Set();
      for (const t of toks) { if (seen.has(t)) continue; seen.add(t); bump(t, `p:${r.doc_card_id}:${r.page_id}`, null); }
    }
    const out = [];
    for (const [term, s] of stats) {
      if (s.items.size < MIN_DOC_FREQ) continue;
      if (s.boards.size < MIN_BOARD_FREQ) continue;
      out.push({ term, items: s.items.size, boards: s.boards.size });
    }
    out.sort((a, b) => (b.items - a.items) || (b.boards - a.boards) || a.term.localeCompare(b.term));
    return out.slice(0, MAX_RESULTS);
  }, [rows, existingTagSlugs]);

  return { suggestions, loading };
}
