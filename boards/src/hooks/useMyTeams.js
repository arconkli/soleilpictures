// The teams the signed-in person belongs to (list_my_teams), for the workspace
// menu and the Team page. Held by teamsAllowed(). A failure is an empty list:
// teams must never break the app. 'soleil:teams-changed' asks for a re-read.
// teamsApi loads on first use, so the app's own bundle doesn't carry it.

import { useCallback, useEffect, useState } from 'react';
import { teamsAllowed } from '../lib/appHost.js';

const noop = () => {};
const NONE = { teams: [], loaded: true, reload: noop };

export function useMyTeams(user) {
  const allowed = teamsAllowed();
  const uid = user?.id;
  const [teams, setTeams] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    if (!allowed || !uid) return;
    try {
      const { listMyTeams } = await import('../lib/teamsApi.js');
      const rows = await listMyTeams();
      setTeams(Array.isArray(rows) ? rows : []);
    } catch (_) {
      setTeams([]);
    }
    setLoaded(true);
  }, [allowed, uid]);

  useEffect(() => {
    if (!allowed || !uid) return undefined;
    reload();
    const on = () => { reload(); };
    window.addEventListener('soleil:teams-changed', on);
    return () => window.removeEventListener('soleil:teams-changed', on);
  }, [allowed, uid, reload]);

  if (!allowed) return NONE;
  return { teams, loaded, reload };
}
