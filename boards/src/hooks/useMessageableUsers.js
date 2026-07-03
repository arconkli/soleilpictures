// People the current user can search for and start a conversation with:
// their workspace teammates PLUS everyone they share a board with (board-share
// collaborators). Backed by the list_messageable_users RPC (migration 0178) so
// the New-chat / add-people pickers aren't limited to formal workspace_members.
//
// Each row: { user_id, email, name, color }. Refetches on workspaceId change;
// consumers can call refresh() after a share/invite to reflect changes.

import { useEffect, useRef, useState } from 'react';
import { listMessageableUsers } from '../lib/messages.js';

export function useMessageableUsers(workspaceId) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  // Cancel-stale-fetch token so a quick workspace switch doesn't deliver the
  // previous workspace's list into the new state.
  const reqRef = useRef(0);

  const fetchNow = async () => {
    if (!workspaceId) { setUsers([]); return; }
    const myReq = ++reqRef.current;
    setLoading(true);
    try {
      const data = await listMessageableUsers({ workspaceId });
      if (reqRef.current === myReq) setUsers(data);
    } catch (e) {
      console.warn('[messageable] listMessageableUsers failed', e);
      if (reqRef.current === myReq) setUsers([]);
    } finally {
      if (reqRef.current === myReq) setLoading(false);
    }
  };

  useEffect(() => {
    fetchNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  return { users, loading, refresh: fetchNow };
}
