// Boards the caller has access to via a per-board share but is NOT a
// workspace member of. Powers the sidebar "Shared with me" section.
//
// Refetches when the caller's user.id changes (login/logout). Consumers
// can call refresh() after sharing/unsharing to update immediately.

import { useEffect, useState, useCallback } from 'react';
import { listSharedBoards } from '../lib/boardsApi.js';

export function useSharedBoards(userId) {
  const [shared, setShared] = useState([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!userId) { setShared([]); return; }
    setLoading(true);
    try {
      const rows = await listSharedBoards();
      setShared(rows);
    } catch (e) {
      console.warn('[shared-boards] fetch failed', e);
      setShared([]);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { refresh(); }, [refresh]);

  return { shared, loading, refresh };
}
