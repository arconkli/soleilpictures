// Live inbox for a workspace. We refresh on demand after mutations; Phase 3
// will add Realtime subscriptions to mirror items posted by other clients.

import { useCallback, useEffect, useState } from 'react';
import { listInbox, deleteInboxItem, addInboxItem } from '../lib/inboxApi.js';

export function useInbox(workspaceId, userId) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    const list = await listInbox(workspaceId);
    setItems(list);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { refresh(); }, [refresh]);

  const remove = useCallback(async (id) => {
    // Optimistic.
    setItems(prev => prev.filter(it => it.id !== id));
    try { await deleteInboxItem(id); }
    catch (e) { console.error('deleteInboxItem failed', e); refresh(); }
  }, [refresh]);

  const add = useCallback(async (item) => {
    const row = await addInboxItem({ workspaceId, item, userId });
    setItems(prev => [row, ...prev]);
    return row;
  }, [workspaceId, userId]);

  return { items, loading, refresh, remove, add };
}
