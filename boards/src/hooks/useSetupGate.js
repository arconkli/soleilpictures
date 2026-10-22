// useSetupGate — runs lib/setupGate.js for TierRouter, before App mounts.
//
// Returns { status, arm, welcome, invitee, finish }:
//   status 'off'     → render the app (not a candidate, arm A, or done);
//   status 'pending' → a candidate in arm B whose progress is still loading;
//   status 'show'    → render the setup steps; finish(welcome) when they end.
// Non-candidates resolve to 'off' on the first render, with no reads.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { logEvent, setEnrolledExperiments } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { assignArm } from '../lib/experiments.js';
import { onPreviewHost, workspaceSetupAllowed } from '../lib/appHost.js';
import { isSetupCandidate, initialSetupState } from '../lib/workspaceSetup.js';
import { readSetupOverride, inviteeTarget, inviteeCopy, rememberSetup, stampSetupArm } from '../lib/setupGate.js';

const SESSION_PREFIX = 'soleil.boards.session.';

function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; }
}

// The workspace and cluster the sign-in claims pointed this account at.
function readSlot(uid) {
  const ws = readJson(`${SESSION_PREFIX}${uid}.workspace`);
  const activeWorkspaceId = ws?.activeWorkspaceId || null;
  const board = activeWorkspaceId ? readJson(`${SESSION_PREFIX}${uid}.${activeWorkspaceId}`) : null;
  const boardId = Array.isArray(board?.stack) && board.stack.length ? board.stack[board.stack.length - 1] : null;
  return { activeWorkspaceId, boardId };
}

const firstName = (s) => String(s || '').trim().split(/\s+/)[0] || '';

// Names for the invitee step. Best-effort: a name it can't read is left out.
async function describeInvitee(target, uid) {
  if (!target) return null;
  if (target.kind === 'board') {
    let name = '';
    try {
      const { data } = await supabase.from('boards').select('name').eq('id', target.boardId).maybeSingle();
      name = data?.name || '';
    } catch (_) { /* nameless is fine */ }
    return { kind: 'board', workspaceId: target.workspaceId, name, role: null, faces: [], ...inviteeCopy({ name, kind: 'board' }) };
  }
  const ws = target.workspace;
  let faces = [];
  let owner = '';
  const others = [];
  try {
    const { data: rows } = await supabase
      .from('workspace_members').select('user_id, created_at')
      .eq('workspace_id', ws.id).order('created_at', { ascending: true }).limit(6);
    const ids = (rows || []).map((r) => r.user_id).filter((id) => id && id !== uid);
    if (ws.created_by && !ids.includes(ws.created_by)) ids.unshift(ws.created_by);
    if (ids.length) {
      const { data: profiles } = await supabase
        .from('member_profiles').select('user_id, display_name, color').in('user_id', ids.slice(0, 6));
      const byId = new Map((profiles || []).map((p) => [p.user_id, p]));
      faces = ids.slice(0, 3).map((id) => {
        const p = byId.get(id);
        return { id, name: firstName(p?.display_name), color: p?.color || null };
      });
      owner = firstName(byId.get(ws.created_by)?.display_name);
      for (const id of ids) {
        if (id === ws.created_by) continue;
        const n = firstName(byId.get(id)?.display_name);
        if (n) others.push(n);
        if (others.length >= 2) break;
      }
    }
  } catch (_) { /* the step reads fine without names */ }
  const role = ws._myRole || null;
  return {
    kind: 'workspace', workspaceId: ws.id, name: ws.name || '', role, faces,
    ...inviteeCopy({ name: ws.name, owner, others, role, kind: 'workspace' }),
  };
}

export function useSetupGate({ user, tier, loading, onboarding }) {
  const uid = user?.id || null;
  const candidate = useMemo(() => !loading && !!tier && tier !== 'waitlist' && !!uid && isSetupCandidate({
    allowed: workspaceSetupAllowed(), createdAt: user?.created_at, onboarding,
  }), [loading, tier, uid, user?.created_at, onboarding]);

  const override = useMemo(() => {
    if (!candidate) return null;
    try {
      return readSetupOverride({
        search: window.location.search, storage: window.sessionStorage,
        allowed: import.meta.env.DEV || onPreviewHost(),
      });
    } catch (_) { return null; }
  }, [candidate]);
  const arm = candidate ? (override || assignArm('workspace_setup', uid)) : null;

  // Stamp both arms once per account, whichever it is: the arm on every event
  // that follows (the cache merges, so App's seed loop adds its own beside it),
  // and the server's record the test is read from, tried until it lands
  // (stampSetupArm), with the enrollment logged when it does.
  const stampedRef = useRef(null);
  useEffect(() => {
    if (!candidate || !arm || override || stampedRef.current === uid) return;
    stampedRef.current = uid;
    setEnrolledExperiments({ exp_workspace_setup: arm }, uid);
    if (!supabase) return;
    let storage = null;
    try { storage = window.localStorage; } catch (_) { /* stamp without the mark */ }
    stampSetupArm({
      uid, arm, storage,
      rpc: () => supabase.rpc('set_experiment_arm', { p_key: 'workspace_setup', p_arm: arm }),
      log: () => logEvent(EV.EXPERIMENT_ENROLLED, { key: 'workspace_setup', arm }),
    });
  }, [candidate, arm, override, uid]);

  const [state, setState] = useState({ uid: null, status: 'pending', welcome: null, invitee: null });
  useEffect(() => {
    if (!candidate || arm !== 'B' || !supabase) return undefined;
    if (state.uid === uid && state.status !== 'pending') return undefined;
    let cancelled = false;
    (async () => {
      let welcome = null;
      let memberships = [];
      try {
        const [profile, members] = await Promise.all([
          supabase.from('profiles').select('settings').eq('user_id', uid).maybeSingle(),
          supabase.from('workspace_members').select('workspace_id, role, created_at, workspaces(*)')
            .eq('user_id', uid).order('created_at', { ascending: true }),
        ]);
        const w = profile?.data?.settings?.welcome;
        welcome = w && typeof w === 'object' ? w : null;
        memberships = (members?.data || []).map((r) => ({ ...r.workspaces, _myRole: r.role, _joinedAt: r.created_at }));
      } catch (_) { /* fall through: a fresh start, nothing to resume */ }
      if (cancelled) return;
      rememberSetup(uid, { arm, welcome, override: !!override });
      if (welcome?.done) { setState({ uid, status: 'off', welcome, invitee: null }); return; }
      const target = inviteeTarget({ user, memberships, slot: readSlot(uid) });
      const invitee = await describeInvitee(target, uid);
      if (cancelled) return;
      // A resumed record keeps its answers; one written for the other path
      // (an owner who has since been invited, or the reverse) starts that path.
      const fresh = initialSetupState({ invitee: !!invitee });
      const resume = welcome && !!welcome.invitee === !!invitee && welcome.step ? welcome : fresh;
      setState({ uid, status: 'show', welcome: resume, invitee });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate, arm, uid]);

  const finish = useCallback((welcome) => {
    rememberSetup(uid, { arm, welcome, override: !!override });
    setState((s) => ({ ...s, status: 'off', welcome }));
  }, [uid, arm, override]);

  if (!candidate) return { status: 'off', arm: null, welcome: null, invitee: null, finish };
  if (arm !== 'B') {
    rememberSetup(uid, { arm, welcome: null, override: !!override });
    return { status: 'off', arm, welcome: null, invitee: null, finish };
  }
  if (state.uid !== uid) return { status: 'pending', arm, welcome: null, invitee: null, finish };
  return { status: state.status, arm, welcome: state.welcome, invitee: state.invitee, finish };
}
