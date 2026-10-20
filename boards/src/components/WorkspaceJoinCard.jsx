// WorkspaceJoinCard — a workspace invite link (?wsjoin=, 0450) opened by
// someone who was already signed in.
//
// Opening a link never joins anyone by itself: a bare visit only reads what
// the link is for (peek_workspace_invite_link), and this card asks. Someone who
// signs in from the link's sign-in page has already said yes and is claimed
// there (AuthGate consumePendingWsJoin). Joining reloads into the workspace,
// because the app picks its workspace as it mounts.
//
// Reuses JoinBoardCard's look (.share-prompt-*): the same corner card with the
// same one action.

import { useEffect, useState } from 'react';
import { logEvent, logEventNow } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { peekWorkspaceInviteLink, claimWorkspaceInviteLink } from '../lib/inviteApi.js';

// The ?wsjoin= param is already gone from the address (AuthGate strips it on
// arrival), so reloading the page as it stands opens the app afresh.
function openWorkspace(userId, workspaceId) {
  try {
    localStorage.setItem(`soleil.boards.session.${userId}.workspace`, JSON.stringify({ activeWorkspaceId: workspaceId }));
  } catch (_) { /* the reload opens the default workspace */ }
  window.location.reload();
}

export default function WorkspaceJoinCard({ token, userId, onClose }) {
  const [link, setLink] = useState(null);   // { status, name, inviter, role }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    peekWorkspaceInviteLink(token).then((row) => {
      if (cancelled) return;
      const status = row?.status || 'dead';
      setLink({ status, name: row?.workspace_name || '', inviter: row?.inviter_name || '', role: row?.role || 'editor' });
      try { logEvent(EV.WORKSPACE_LINK_LANDED, { status, signed_in: true }); } catch (_) {}
    }, () => {
      if (cancelled) return;
      setLink({ status: 'dead', name: '', inviter: '', role: 'editor' });
      try { logEvent(EV.WORKSPACE_LINK_LANDED, { status: 'error', signed_in: true }); } catch (_) {}
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
      const row = await claimWorkspaceInviteLink(token);
      const status = row?.status || 'unknown';
      try { logEventNow(EV.WORKSPACE_LINK_CLAIM_RESULT, { status, at: 'card' }); } catch (_) {}
      if (status === 'joined') {
        try { logEventNow(EV.ACCESS_GRANTED, { how: 'workspace_link', role: `workspace:${row.role || link.role}`, board_id: null, surface: 'wsjoin_card' }); } catch (_) {}
      }
      if (row?.workspace_id && (status === 'joined' || status === 'member')) {
        onClose?.();
        openWorkspace(userId, row.workspace_id);
        return;
      }
      setLink((l) => ({ ...l, status: 'dead' }));
    } catch (e) {
      try { logEventNow(EV.WORKSPACE_LINK_CLAIM_RESULT, { status: 'error', at: 'card', reason: String(e?.hint || e?.code || e?.message || e).slice(0, 80) }); } catch (_) {}
      setError('That didn’t work. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const name = link.name || 'this workspace';
  const quoted = link.name ? `“${link.name}”` : 'this workspace';
  const inviter = link.inviter && link.inviter !== 'Someone' ? link.inviter : '';
  const editor = link.role !== 'viewer';

  if (link.status === 'dead') {
    return (
      <div className="share-prompt" role="dialog" aria-label="Invite link">
        <button type="button" className="share-prompt-x" aria-label="Dismiss" onClick={onClose}>×</button>
        <div className="share-prompt-title">That invite link no longer works.</div>
        <div className="share-prompt-sub">It has expired or was turned off. Ask whoever sent it for a new one.</div>
        <button type="button" className="share-prompt-later" onClick={onClose}>OK</button>
      </div>
    );
  }

  if (link.status === 'member') {
    return (
      <div className="share-prompt" role="dialog" aria-label={`Open ${name}`}>
        <button type="button" className="share-prompt-x" aria-label="Dismiss" onClick={onClose}>×</button>
        <div className="share-prompt-title">You’re already in {quoted}.</div>
        <div className="share-prompt-sub">Open it to see what’s been added.</div>
        <button type="button" className="public-cta share-prompt-cta" disabled={busy} onClick={join}>Open {name}</button>
        <button type="button" className="share-prompt-later" onClick={onClose}>Not now</button>
      </div>
    );
  }

  return (
    <div className="share-prompt" role="dialog" aria-label={`Join ${name}`}>
      <button type="button" className="share-prompt-x" aria-label="Dismiss" onClick={onClose}>×</button>
      <div className="share-prompt-eyebrow">You’re invited</div>
      <div className="share-prompt-title">Join {quoted} as {editor ? 'an editor' : 'a viewer'}.</div>
      <div className="share-prompt-sub">
        {inviter ? `${inviter} invited you. ` : ''}
        {editor
          ? (inviter ? `Work on its clusters and files alongside ${inviter}.` : 'Work on its clusters and files with the people in it.')
          : 'See its clusters and files as they’re added.'}
      </div>
      {error && <div className="share-prompt-sub" role="alert">{error}</div>}
      <button type="button" className="public-cta share-prompt-cta" disabled={busy} onClick={join}>
        {busy ? 'Joining…' : `Join as ${editor ? 'editor' : 'viewer'}`}
      </button>
      <button type="button" className="share-prompt-later" onClick={onClose}>Not now</button>
    </div>
  );
}
