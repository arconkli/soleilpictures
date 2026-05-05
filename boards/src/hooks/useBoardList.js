// All boards in the workspace, keyed by id. Refreshes on demand.

import { useCallback, useEffect, useState } from 'react';
import { listBoards } from '../lib/boardsApi.js';

export function useBoardList(workspaceId) {
  const [boards, setBoards] = useState({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    const arr = await listBoards(workspaceId);
    const map = {};
    for (const b of arr) map[b.id] = b;
    setBoards(map);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { refresh(); }, [refresh]);

  return { boards, loading, refresh };
}
