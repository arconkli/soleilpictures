// Debounced autotag trigger for a single target (a card right now,
// later doc pages and notes). Watches `content` for changes,
// debounces, asks the worker for suggestions, and applies the
// high-confidence ones via tagCard with source='auto'.
//
// Suggestions in the LOW..HIGH band are returned via the
// `onSuggested` callback so the UI can show a "suggested" chip
// with a one-click confirm.
//
// Hash-based dedupe: we only re-score when the (content + tag-set)
// hash changes, mirroring the autotag_log audit table — so typing
// noise doesn't repeatedly hit the worker.

import { useEffect, useRef } from 'react';
import { contentHash } from '../lib/autotagEngine.js';
import { tagCard, tagBoard } from '../lib/tagsApi.js';

const HIGH = 0.7;
const LOW = 0.4;
const DEBOUNCE_MS = 5000;

export function useAutotagOnChange({
  enabled = true,
  workspaceId,
  target,        // { kind: 'card'|'board', id, boardId? }
  content,       // string — title + body, etc.
  knownTagIds,   // Set<string> — tags already on this target
  suggestTags,   // from useAutotagWorker
  onSuggested,   // (suggestions: [{ tagId, score, reason }]) => void
}) {
  const timerRef = useRef(0);
  const lastHashRef = useRef('');
  const knownRef = useRef(knownTagIds || new Set());
  knownRef.current = knownTagIds || new Set();

  useEffect(() => {
    if (!enabled || !workspaceId || !target || !suggestTags) return;
    const text = String(content || '').trim();
    if (text.length < 2) return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      try {
        const suggestions = await suggestTags(text, { kind: target.kind, id: target.id });
        const hash = contentHash(text, suggestions.map(s => s.tagId));
        if (hash === lastHashRef.current) return;
        lastHashRef.current = hash;
        const known = knownRef.current;
        const high = [];
        const low = [];
        for (const s of suggestions) {
          if (known.has(s.tagId)) continue;
          if (s.score >= HIGH) high.push(s);
          else if (s.score >= LOW) low.push(s);
        }
        // Auto-apply high-confidence suggestions as source='auto'.
        for (const s of high) {
          try {
            if (target.kind === 'card') {
              if (!target.boardId) continue;
              await tagCard({
                workspaceId, boardId: target.boardId, cardId: target.id,
                tagId: s.tagId, source: 'auto',
              });
            } else if (target.kind === 'board') {
              await tagBoard({
                workspaceId, boardId: target.id,
                tagId: s.tagId, source: 'auto',
              });
            }
          } catch (err) {
            console.warn('[autotag] apply failed', err);
          }
        }
        if (low.length && typeof onSuggested === 'function') onSuggested(low);
      } catch (err) {
        console.warn('[autotag] suggest failed', err);
      }
    }, DEBOUNCE_MS);
    return () => { clearTimeout(timerRef.current); };
  }, [enabled, workspaceId, target?.kind, target?.id, target?.boardId, content, suggestTags, onSuggested]);
}
