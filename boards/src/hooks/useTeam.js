// useTeam — a real team for the Team page: get_team (plus get_team_billing
// for an owner or admin) folded into a TeamSnapshot, and act(type, payload)
// to change it. act runs the action (teamActions.js), reloads on success and
// resolves its { ok, data } | { ok:false, refusal }.
//
// A response for an earlier orgId, or after unmount, is dropped.

import { useCallback, useEffect, useRef, useState } from 'react';
import * as teamsApi from '../lib/teamsApi.js';
import * as teamBillingApi from '../lib/teamBillingApi.js';
import { teamRefusal } from '../lib/teamHints.js';
import { toTeamSnapshot } from '../lib/teamSnapshot.js';
import { runTeamAction } from '../lib/teamActions.js';

const realApi = { ...teamsApi, ...teamBillingApi };

export function useTeam(orgId) {
  const [state, setState] = useState({ team: null, loading: !!orgId, error: null });
  const orgRef = useRef(orgId);
  orgRef.current = orgId;
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  const load = useCallback(async (id) => {
    if (!id) return;
    const fresh = () => aliveRef.current && orgRef.current === id;
    try {
      const raw = await teamsApi.getTeam({ p_org_id: id });
      let billing = null;
      if (raw?.me?.role === 'owner' || raw?.me?.role === 'admin') {
        try {
          billing = await teamsApi.getTeamBilling({ p_org_id: id });
        } catch (err) {
          // Not an admin (any more): no billing, not a failure.
          if (teamRefusal(err)?.kind !== 'team_not_admin') throw err;
        }
      }
      if (!fresh()) return;
      setState({ team: toTeamSnapshot(raw, billing), loading: false, error: null });
    } catch (err) {
      if (!fresh()) return;
      setState((s) => ({ ...s, loading: false, error: err }));
    }
  }, []);

  useEffect(() => {
    setState({ team: null, loading: !!orgId, error: null });
    load(orgId);
  }, [orgId, load]);

  const reload = useCallback(() => load(orgRef.current), [load]);

  const act = useCallback(async (type, payload) => {
    const id = orgRef.current;
    const res = await runTeamAction(realApi, id, type, payload);
    if (res.ok && orgRef.current === id) await load(id);
    return res;
  }, [load]);

  return { team: state.team, loading: state.loading, error: state.error, reload, act };
}
