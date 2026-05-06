// Members of the active workspace. Powers the sidebar header member-dot
// stack and the "shared" badge on workspace buttons.
//
// Refetches on workspaceId change. No realtime subscription for v1 —
// member churn is rare; consumers can call refresh() after invite/leave
// flows to reflect changes immediately.

import { useEffect, useRef, useState } from 'react';
import { listWorkspaceMembers } from '../lib/boardsApi.js';

export function useWorkspaceMembers(workspaceId) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(false);
  // Cancel-stale-fetch token so a quick workspace switch doesn't deliver
  // the previous workspace's members into the new state.
  const reqRef = useRef(0);

  const fetchNow = async () => {
    if (!workspaceId) { setMembers([]); return; }
    const myReq = ++reqRef.current;
    setLoading(true);
    try {
      const data = await listWorkspaceMembers(workspaceId);
      if (reqRef.current === myReq) setMembers(data);
    } catch (e) {
      console.warn('[members] listWorkspaceMembers failed', e);
      if (reqRef.current === myReq) setMembers([]);
    } finally {
      if (reqRef.current === myReq) setLoading(false);
    }
  };

  useEffect(() => {
    fetchNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  return { members, loading, refresh: fetchNow };
}
