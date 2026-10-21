import { useEffect } from 'react';
import { useOptionalFeedback } from '../components/AppFeedback.jsx';
import { settleOrphanedDocResets } from '../lib/docResets.js';

// A doc that was open when its cluster reloaded under it (a restore, cards
// moved in: lib/docResets.js), which the reloaded cluster doesn't have. No doc
// of its is coming back to say so, so whoever holds the cluster does, once it
// is loaded: `ready`, `boardId` and `cards` as useYBoard gives them. A doc that
// is still there says so itself (DocSurface).
export function useOrphanedDocResets({ ready, boardId, cards }) {
  const feedback = useOptionalFeedback();
  useEffect(() => {
    if (!ready || !boardId || !feedback) return;
    settleOrphanedDocResets({ boardId, hasCard: (id) => (cards || []).some((c) => c.id === id), feedback });
  }, [ready, boardId, cards, feedback]);
}
