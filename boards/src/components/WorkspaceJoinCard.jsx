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
import { markJoined } from '../lib/workspaceLink.js';
import { isComposingKey } from '../lib/composerKeys.js';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';

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
    const onKey = (e) => { if (isComposingKey(e)) return; if (e.key === 'Escape') onClose?.(); };
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
        markJoined(userId, row.workspace_id);
      }
      if (row?.workspace_id && (status === 'joined' || status === 'member')) {
        onClose?.();
        openWorkspace(userId, row.workspace_id);
        return;
      }
      setLink((l) => ({ ...l, status: 'dead' }));
    } catch (e) {
      try { logEventNow(EV.WORKSPACE_LINK_CLAIM_RESULT, { status: 'error', at: 'card', reason: String(e?.hint || e?.code || e?.message || e).slice(0, 80) }); } catch (_) {}
      setError(t`That didn’t work. Try again.`);
    } finally {
      setBusy(false);
    }
  };

  const name = link.name || t`this workspace`;
  const quoted = link.name ? `“${link.name}”` : t`this workspace`;
  const inviter = link.inviter && link.inviter !== 'Someone' ? link.inviter : '';
  const editor = link.role !== 'viewer';

  if (link.status === 'dead') {
    return (
      <div className="share-prompt" role="dialog" aria-label={t`Invite link`}>
        <button type="button" className="share-prompt-x" aria-label={t`Dismiss`} onClick={onClose}>×</button>
        <div className="share-prompt-title"><Trans>That invite link no longer works.</Trans></div>
        <div className="share-prompt-sub"><Trans>It has expired or was turned off. Ask whoever sent it for a new one.</Trans></div>
        <button type="button" className="share-prompt-later" onClick={onClose}><Trans>OK</Trans></button>
      </div>
    );
  }

  if (link.status === 'member') {
    return (
      <div className="share-prompt" role="dialog" aria-label={t`Open ${name}`}>
        <button type="button" className="share-prompt-x" aria-label={t`Dismiss`} onClick={onClose}>×</button>
        <div className="share-prompt-title"><Trans>You’re already in {quoted}.</Trans></div>
        <div className="share-prompt-sub"><Trans>Open it to see what’s been added.</Trans></div>
        <button type="button" className="public-cta share-prompt-cta" disabled={busy} onClick={join}><Trans>Open {name}</Trans></button>
        <button type="button" className="share-prompt-later" onClick={onClose}><Trans>Not now</Trans></button>
      </div>
    );
  }

  return (
    <div className="share-prompt" role="dialog" aria-label={t`Join ${name}`}>
      <button type="button" className="share-prompt-x" aria-label={t`Dismiss`} onClick={onClose}>×</button>
      <div className="share-prompt-eyebrow"><Trans>You’re invited</Trans></div>
      <div className="share-prompt-title">{editor ? <Trans>Join {quoted} as an editor.</Trans> : <Trans>Join {quoted} as a viewer.</Trans>}</div>
      <div className="share-prompt-sub">
        {editor
          ? (inviter ? t`${inviter} invited you. Work on its clusters and files alongside ${inviter}.` : t`Work on its clusters and files with the people in it.`)
          : (inviter ? t`${inviter} invited you. See its clusters and files as they’re added.` : t`See its clusters and files as they’re added.`)}
      </div>
      {error && <div className="share-prompt-sub" role="alert">{error}</div>}
      <button type="button" className="public-cta share-prompt-cta" disabled={busy} onClick={join}>
        {busy ? t`Joining…` : editor ? t`Join as editor` : t`Join as viewer`}
      </button>
      <button type="button" className="share-prompt-later" onClick={onClose}><Trans>Not now</Trans></button>
    </div>
  );
}
