// TeamJoinCard — everything AuthGate does with the Team plan's links (Team S4):
// ?teamjoin=<token> (the team's link) and ?teaminvite=<token> (an email
// invite). AuthGate sits in the entry chunk, so it reaches this module only
// through import(), and only when a link is in the address or the stash.
//
//   captureTeamLink        the address → the stash (lib/teamLinks.js), like ?wsjoin=
//   claimStashedTeamLink   a session the sign-in form just made: it read "Join
//                          {team}" above the form, so signing in was the yes
//   default (TeamLink)     the sign-in form's note (`note`), or the card for
//                          someone already signed in
//
// Opening a link never joins anyone by itself: a bare visit only reads what
// the link is for (peek_team_link), and the card asks. An email invite never
// shows a card: App's lib/teamBoot.js accepts it, since the email's "Join the
// team" was the yes. Joining reloads, because the app loads the team's
// workspaces as it mounts; App toasts the note left behind.
//
// Reuses WorkspaceJoinCard's look (.share-prompt-*) and the sign-in note's
// (.auth-wsjoin).

import { useEffect, useState } from 'react';
import { peekTeamLink, claimTeamLink } from '../lib/teamsApi.js';
import { teamJoinLine } from '../lib/teamCopy.js';
import { TEAMJOIN_PARAM, TEAMINVITE_PARAM, teamLinkFromSearch, stashTeamLink, readTeamLink, clearTeamLink, stashTeamNote } from '../lib/teamLinks.js';

const DEAD_SUB = 'It was turned off or reset. Ask the team for a new one.';

const first = (d) => (Array.isArray(d) ? d[0] : d);

function JoinCard({ token, onClose }) {
  const [link, setLink] = useState(null);   // { status, name, role, sub }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    peekTeamLink({ p_token: token }).then((d) => {
      if (cancelled) return;
      const row = first(d);
      setLink({ status: row?.status || 'dead', name: row?.team_name || '', role: row?.role || 'member', sub: DEAD_SUB });
    }, () => {
      if (cancelled) return;
      setLink({ status: 'dead', name: '', role: 'member', sub: DEAD_SUB });
    });
    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!link) return null;

  const join = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const row = first(await claimTeamLink({ p_token: token }));
      const status = row?.status || 'unknown';
      const line = teamJoinLine(status, link.name, row?.role);
      if (status === 'joined' || status === 'requested' || status === 'already') {
        if (line) stashTeamNote(line);
        onClose?.();
        window.location.reload();
        return;
      }
      if (status === 'off' || status === 'not_found' || status === 'removed') {
        setLink((l) => ({ ...l, status: 'dead', sub: line || DEAD_SUB }));
        return;
      }
      setError('That didn’t work. Try again.');
    } catch (e) {
      setError('That didn’t work. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (link.status !== 'ok') {
    return (
      <div className="share-prompt" role="dialog" aria-label="Team link">
        <button type="button" className="share-prompt-x" aria-label="Dismiss" onClick={onClose}>×</button>
        <div className="share-prompt-title">That team link no longer works.</div>
        <div className="share-prompt-sub">{link.sub}</div>
        <button type="button" className="share-prompt-later" onClick={onClose}>OK</button>
      </div>
    );
  }

  const viewer = link.role === 'viewer';
  return (
    <div className="share-prompt" role="dialog" aria-label={link.name ? `Join ${link.name}` : 'Join this team'}>
      <button type="button" className="share-prompt-x" aria-label="Dismiss" onClick={onClose}>×</button>
      <div className="share-prompt-eyebrow">You’re invited</div>
      <div className="share-prompt-title">{link.name ? `Join “${link.name}”.` : 'Join this team.'}</div>
      <div className="share-prompt-sub">
        {viewer
          ? 'You’ll see its workspaces as they’re added. Your own workspaces stay yours: the team never sees them.'
          : 'Its workspaces join your workspace menu. Your own workspaces stay yours: the team never sees them.'}
      </div>
      {error && <div className="share-prompt-sub" role="alert">{error}</div>}
      <button type="button" className="public-cta share-prompt-cta" disabled={busy} onClick={join}>
        {busy ? 'Joining…' : `Join ${link.name || 'the team'}`}
      </button>
      <button type="button" className="share-prompt-later" onClick={onClose}>Not now</button>
    </div>
  );
}

// The note above the sign-in form for a team link or an email invite.
function TeamSignInNote({ link, onDead }) {
  const [peek, setPeek] = useState(null);   // { status, name }
  const isJoin = link && link.kind === 'join';

  useEffect(() => {
    if (!isJoin) return undefined;
    let cancelled = false;
    peekTeamLink({ p_token: link.token }).then((d) => {
      if (cancelled) return;
      const row = first(d);
      setPeek({ status: row?.status || 'dead', name: row?.team_name || '' });
    }, () => {});
    return () => { cancelled = true; };
  }, [isJoin, link && link.token]);

  const dead = isJoin && peek && peek.status !== 'ok';
  useEffect(() => { if (dead) onDead?.(); }, [dead]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!link) return null;
  if (!isJoin) {
    return (
      <div className="auth-wsjoin" role="note">
        <span className="auth-wsjoin-av" aria-hidden="true">T</span>
        <span className="auth-wsjoin-t">
          <b>You’re invited to a team</b>
          <span>Sign in with the email address the invite went to.</span>
        </span>
      </div>
    );
  }
  if (!peek) return null;
  if (dead) {
    return (
      <div className="auth-hint t-meta" style={{ marginBottom: 0 }}>
        That team link no longer works. Ask the team for a new one.
      </div>
    );
  }
  return (
    <div className="auth-wsjoin" role="note">
      <span className="auth-wsjoin-av" aria-hidden="true">{(peek.name || '?').trim().charAt(0).toUpperCase()}</span>
      <span className="auth-wsjoin-t">
        <b>{peek.name ? `Join ${peek.name}` : 'Join a team'}</b>
        <span>Sign in or sign up to join the team.</span>
      </span>
    </div>
  );
}

// What AuthGate renders: the sign-in form's note (`note`), or the card for
// someone already signed in. Both read the stash.
export default function TeamLink({ note = false, onClose }) {
  const [link] = useState(readTeamLink);
  if (!link) return null;
  if (note) return <TeamSignInNote link={link} onDead={clearTeamLink} />;
  if (link.kind !== 'join') return null;   // an email invite waits for App
  return <JoinCard token={link.token} onClose={() => { clearTeamLink(); onClose?.(); }} />;
}

// The address → the stash, and the address without the link.
export function captureTeamLink() {
  const url = new URL(window.location.href);
  const link = teamLinkFromSearch(url.search);
  if (!link) return;
  stashTeamLink(link);
  url.searchParams.delete(TEAMJOIN_PARAM);
  url.searchParams.delete(TEAMINVITE_PARAM);
  window.history.replaceState({}, document.title, url.pathname + url.search);
}

// For a session the sign-in form just made. Never throws; a team link's stash
// clears on any outcome (an email invite's stays for App). The outcome is left
// as a note for App to toast.
export async function claimStashedTeamLink() {
  const link = readTeamLink();
  if (!link || link.kind !== 'join') return;
  try {
    let name = '';
    try { name = first(await peekTeamLink({ p_token: link.token }))?.team_name || ''; } catch (_) {}
    const row = first(await claimTeamLink({ p_token: link.token }));
    const line = teamJoinLine(row?.status, name, row?.role);
    if (line) stashTeamNote(line);
  } catch (e) {
    console.warn('[team-link] claim failed', e?.hint || e?.code || e?.message || e);
  } finally {
    clearTeamLink();
  }
}
