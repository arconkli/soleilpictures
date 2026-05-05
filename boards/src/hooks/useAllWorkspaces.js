// All workspaces the current user is a member of, sorted by membership age.
// Refreshes on demand (after invites or switches).

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

export function useAllWorkspaces(user) {
  const [workspaces, setWorkspaces] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) return;
    // Filter to OUR own membership rows. Without this, RLS lets us see
    // every co-member's row in workspaces we share, and each shared
    // workspace appeared N times in the rail (once per member).
    const { data, error } = await supabase
      .from('workspace_members')
      .select('workspace_id, role, created_at, workspaces(*)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true });
    if (error) {
      console.error('useAllWorkspaces', error);
      setLoading(false);
      return;
    }
    const list = (data || []).map(r => ({ ...r.workspaces, _myRole: r.role, _joinedAt: r.created_at }));
    setWorkspaces(list);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { refresh(); }, [refresh]);

  return { workspaces, loading, refresh };
}
