// All workspaces the current user is a member of, sorted by membership age.
// Refreshes on demand (after invites or switches). The first load takes the
// read lib/bootPrefetch.js started at sign-in; refresh() always asks afresh.
// Team workspaces (reached through a team, no membership row) arrive from a
// second read; `teamsLoading` is true until the first of those has answered.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { membershipsQuery, membershipWorkspaces } from '../lib/bootQueries.js';
import { takeBootResponse } from '../lib/bootPrefetch.js';
import { teamsAllowed } from '../lib/appHost.js';
import { withTeamWorkspaces, keepTeamWorkspaces } from '../lib/teamWorkspaceList.js';

export function useAllWorkspaces(user) {
  const [workspaces, setWorkspaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [teamsLoading, setTeamsLoading] = useState(() => teamsAllowed());

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
      setTeamsLoading(false); // no team read is coming: nothing to wait for
      return;
    }
    const base = membershipWorkspaces(data);
    if (!teamsAllowed()) {
      setWorkspaces(base);
      setLoading(false);
      return;
    }
    // The team workspaces the list already held stay until the team read
    // answers: someone who reaches their current workspace only through a team
    // would otherwise drop out for a round trip, and App would fall back to the
    // personal workspace and remount the team one after it.
    setWorkspaces((prev) => keepTeamWorkspaces(base, prev));
    setLoading(false);
    // Team workspaces the person can reach through a team (not by membership).
    // Never delays or breaks the list above: any failure keeps the memberships
    // and the team workspaces already listed. An answer that adds nothing still
    // replaces them, so a team workspace that is gone really goes.
    try {
      const { listMyTeamWorkspaces } = await import('../lib/teamsApi.js');
      const rows = await listMyTeamWorkspaces();
      setWorkspaces(withTeamWorkspaces(base, rows));
    } catch (_) { /* the list set above stands */ }
    setTeamsLoading(false);
  }, [user?.id]);

  const refresh = useCallback(() => load(false), [load]);

  useEffect(() => { load(true); }, [load]);

  return { workspaces, loading, teamsLoading, refresh };
}
