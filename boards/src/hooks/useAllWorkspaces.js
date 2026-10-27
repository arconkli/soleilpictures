// All workspaces the current user is a member of, sorted by membership age.
// Refreshes on demand (after invites or switches). The first load takes the
// read lib/bootPrefetch.js started at sign-in; refresh() always asks afresh.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { membershipsQuery, membershipWorkspaces } from '../lib/bootQueries.js';
import { takeBootResponse } from '../lib/bootPrefetch.js';
import { teamsAllowed } from '../lib/appHost.js';

export function useAllWorkspaces(user) {
  const [workspaces, setWorkspaces] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (boot) => {
    if (!user) return;
    // Filter to OUR own membership rows (membershipsQuery). Without that,
    // RLS lets us see every co-member's row in workspaces we share, and each
    // shared workspace appeared N times in the rail (once per member).
    const taken = boot ? takeBootResponse('members', user.id) : null;
    const { data, error } = await (taken || membershipsQuery(supabase, user.id));
    if (error) {
      console.error('useAllWorkspaces', error);
      setLoading(false);
      return;
    }
    const base = membershipWorkspaces(data);
    setWorkspaces(base);
    setLoading(false);
    // Team workspaces the person can reach through a team (not by membership).
    // Never delays or breaks the list above: any failure keeps the memberships.
    if (teamsAllowed()) {
      try {
        const { listMyTeamWorkspaces } = await import('../lib/teamsApi.js');
        const rows = await listMyTeamWorkspaces();
        const seen = new Set(base.map((w) => w.id));
        const extra = [];
        for (const row of rows || []) {
          const ws = row?.workspace;
          if (!ws?.id || seen.has(ws.id)) continue;
          seen.add(ws.id);
          extra.push({ ...ws, _myRole: row.role, _joinedAt: row.created_at, _viaTeam: true });
        }
        if (extra.length) setWorkspaces([...base, ...extra]);
      } catch (_) { /* the memberships stand */ }
    }
  }, [user?.id]);

  const refresh = useCallback(() => load(false), [load]);

  useEffect(() => { load(true); }, [load]);

  return { workspaces, loading, refresh };
}
