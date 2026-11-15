// The third tab under "This workspace": who is in it, at what level, and — for
// the owner and co-owners — the controls that were only reachable through the
// board-scoped ShareModal before (remove, transfer) plus the one that did not
// exist (change role, 0318). A co-owner (0391) gets everything here except
// "Make owner": handing the workspace over stays the owner's alone.
//
// Removal uses the same confirm the ShareModal uses (ShareModal.onRemoveMember):
// it is an access change, not content deletion, so the undo-toast convention
// for deletes does not apply and there is nothing to restore silently — 0318
// also drops the person's board shares in this workspace.
import { useEffect, useMemo, useState } from 'react';
import {
  listWorkspaceMembers, listWorkspaceDirectory, setWorkspaceMemberRole,
  removeWorkspaceMember, transferWorkspaceOwnership, inviteWorkspaceMember,
  listPendingInvitesForWorkspace, revokePendingInvite,
} from '../../lib/boardsApi.js';
import { useFeedback } from '../AppFeedback.jsx';
import { SettingsCategory } from './fields.jsx';
import { useSettingsSave } from './saveState.jsx';
import { WORKSPACE_ROLE_LABEL as ROLE_LABEL, ASSIGNABLE_ROLES, canManageWorkspace } from '../../lib/workspaceRoles.js';
import { useEditorLimit } from '../../hooks/useEditorLimit.js';
import { editorLimitAllowed } from '../../lib/appHost.js';
import { editorLimitFull, editorLimitRefusal, firstName, holdsPlace } from '../../lib/editorLimit.js';
import { editorLimitRefusalMessage } from '../../lib/editorLimitWords.js';
import { logEvent } from '../../lib/analytics.js';
import { EV } from '../../lib/analyticsEvents.js';
import { AccountEditorsCard } from './AccountEditorsCard.jsx';
import { isComposingKey } from '../../lib/composerKeys.js';
import { t, ph } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { shownError } from '../../lib/errorWords.js';
import { PersonFace } from '../PersonFace.jsx';
import { pickPresenceColor } from '../../lib/presenceColor.js';

// Holds an action slot a row does not have. It is the same element as the real
// control (a <button>), so it gets the same UA box and text metrics and the
// slot is exactly as wide; a <span> came out ~1.6px narrower and the role
// menus drifted apart again. Disabled, hidden and unfocusable.
function SlotPlaceholder({ children }) {
  return (
    <button type="button" className="settings-link-btn is-placeholder"
            tabIndex={-1} aria-hidden="true" disabled>{children}</button>
  );
}

// onOpenProfile: SettingsPanel's switch to the Profile tab. Your own row is the
// way there; without it the row is plain, as every other row is.
export function MembersTab({ workspaceId,workspaceName, user, role, onWorkspacesChanged, onOpenProfile }) {
  const editSelf = typeof onOpenProfile === 'function' ? () => onOpenProfile() : null;
  const feedback = useFeedback();
  const save = useSettingsSave();
  const isOwner = role === 'owner';
  const canManage = canManageWorkspace(role);
  const [members, setMembers] = useState([]);
  const [directory, setDirectory] = useState([]);
  // Invites to addresses with no account yet (pending_invites). An invite
  // from here used to leave no trace in the tab that sent it: no row, so
  // nothing to confirm, revoke or check on. ShareModal lists the same rows.
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('editor');
  // The 10-editor limit (0520, held): the numbers for this workspace's
  // account and, for its owner, who holds the places.
  const editorLimit = useEditorLimit({ workspaceId, enabled: canManage, list: 'always' });
  const limitCap = editorLimit.cap;
  const editFull = editorLimitFull(limitCap);

  const load = async () => {
    if (!workspaceId) { setMembers([]); setDirectory([]); setPending([]); return; }
    setLoading(true);
    try {
      const [m, d, p] = await Promise.all([
        listWorkspaceMembers(workspaceId),
        listWorkspaceDirectory(workspaceId),
        // Managers only (the server refuses everyone else); a failure here
        // must not hide the members list, so it degrades to no pending rows.
        canManage ? listPendingInvitesForWorkspace(workspaceId).catch(() => []) : Promise.resolve([]),
      ]);
      setMembers(m); setDirectory(d); setPending(p);
    } catch (e) {
      feedback.toast({ type: 'error', code: 'members_load_failed', message: t`Could not load members: ${ph({ reason: shownError(e) })}` });
    } finally {
      setLoading(false);
    }
  };
  // canManage too: the role can land (or change) after the first load.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [workspaceId, canManage]);

  const byId = useMemo(() => new Map(directory.map(d => [d.user_id, d])), [directory]);
  const label = (m) => byId.get(m.user_id)?.title || byId.get(m.user_id)?.email || m.user_id.slice(0, 8);

  // Whose plan it is, for a co-owner: "Alex’s plan".
  const ownerRow = members.find((x) => x.role === 'owner');
  const ownerName = !limitCap?.isAccountOwner && ownerRow ? firstName(byId.get(ownerRow.user_id)?.title) : null;
  // A viewer made an editor or co-owner takes a place, unless they hold one
  // somewhere else in the account (the owner's list says so).
  const lockedViewer = (m) => editFull && m.role === 'viewer' && !holdsPlace(editorLimit.holders, { userId: m.user_id });
  const inviteLocked = editFull && !holdsPlace(editorLimit.holders, { email: inviteEmail });
  // A door said no for want of room: log it, read the numbers again, and say
  // it in the panel's words.
  const refused = (full, door) => {
    try { logEvent(EV.EDITOR_LIMIT_REFUSED, { door, ask: !!full.ask, surface: 'members' }); } catch (_) {}
    editorLimit.refresh();
    return editorLimitRefusalMessage(full, { ownerName });
  };

  const changeRole = (m, next) => save(async () => {
    try {
      await setWorkspaceMemberRole({ workspaceId, userId: m.user_id, role: next });
    } catch (e) {
      const full = editorLimitRefusal(e);
      if (!full) throw e;
      throw Object.assign(new Error(e?.message || 'editor limit reached'), { userMessage: refused(full, 'member_role') });
    }
    await load();
    editorLimit.refresh();
  });

  const remove = async (m) => {
    const who = label(m);
    const ok = await feedback.confirm({
      title: t`Remove ${who}?`,
      message: t`They'll lose access to "${workspaceName}" and all its clusters. Clusters shared to them directly in this workspace are unshared as well.`,
      confirmLabel: t`Remove member`,
      danger: true,
    });
    if (!ok) return;
    try {
      await removeWorkspaceMember({ workspaceId, userId: m.user_id });
      feedback.toast({ type: 'success', message: t`Removed ${who}.` });
      await load();
      editorLimit.refresh();
      await onWorkspacesChanged?.();
    } catch (e) {
      feedback.toast({ type: 'error', code: 'member_remove_failed', message: t`Could not remove: ${ph({ reason: shownError(e) })}` });
    }
  };

  const transfer = async (m) => {
    const who = label(m);
    // Every limit follows the owner (created_by): a paid owner who hands over
    // a workspace stops covering it. Say so before, and offer co-owner — which
    // keeps this plan paying — as the other answer. Never name the recipient's
    // plan: members don't see each other's.
    const ok = await feedback.confirm({
      title: t`Make ${who} the owner?`,
      message: t`Its cards, files and storage will count against ${who}'s plan instead of yours, and everyone in it will work within that plan's limits. To let them run it while your plan keeps covering it, make them a co-owner instead. If you transfer, you'll become an editor of "${workspaceName}" and only they can transfer it back.`,
      confirmLabel: t`Transfer ownership`,
      altLabel: m.role === 'coowner' ? null : t`Make co-owner instead`,
      danger: true,
    });
    if (ok === 'alt') { changeRole(m, 'coowner'); return; }
    if (!ok) return;
    try {
      await transferWorkspaceOwnership({ workspaceId, newOwnerId: m.user_id });
      feedback.toast({ type: 'success', message: t`${who} now owns this workspace.` });
      await load();
      await onWorkspacesChanged?.();
    } catch (e) {
      feedback.toast({ type: 'error', code: 'workspace_transfer_failed', message: t`Could not transfer: ${ph({ reason: shownError(e) })}` });
    }
  };

  // Same confirm as ShareModal.onRevokePending: nothing was granted yet, so
  // there is nothing to undo, only a sign-up that will no longer get access.
  const revokePending = async (row) => {
    const ok = await feedback.confirm({
      title: t`Revoke invite to ${ph({ email: row.email })}?`,
      message: t`They'll no longer get access if they sign up.`,
      confirmLabel: t`Revoke`,
      danger: true,
    });
    if (!ok) return;
    try {
      await revokePendingInvite(row.id);
      setPending(arr => arr.filter(x => x.id !== row.id));
      editorLimit.refresh();
    } catch (e) {
      feedback.toast({ type: 'error', code: 'invite_revoke_failed', message: t`Could not revoke: ${ph({ reason: shownError(e) })}` });
    }
  };

  const invite = async () => {
    const email = inviteEmail.trim();
    if (!email || !canManage) return;
    const role = inviteLocked ? 'viewer' : inviteRole;
    try {
      const status = await inviteWorkspaceMember({ workspaceId, email, role });
      feedback.toast({
        type: status === 'already_member' ? 'warning' : 'success',
        message: status === 'pending' ? t`Invited ${email} — access is waiting for them when they sign up.`
              : status === 'already_member' ? t`${email} is already a member.`
              : t`Added ${email} as ${role}.`,
      });
      setInviteEmail('');
      await load();
      editorLimit.refresh();
    } catch (e) {
      const full = editorLimitRefusal(e);
      if (full) { feedback.toast({ type: 'warning', message: refused(full, 'workspace_invite'), ttl: 9000 }); return; }
      feedback.toast({ type: 'error', code: 'invite_failed', message: t`Could not invite: ${ph({ reason: shownError(e) })}` });
    }
  };

  return (
    <div className="settings-tab-body">
      {editorLimitAllowed() && canManage && limitCap?.enforced && (
        <AccountEditorsCard cap={limitCap} editors={editorLimit.editors} previewing={editorLimit.previewing} ownerName={ownerName}
                            selfId={user?.id}
                            onChanged={async () => { await load(); await editorLimit.refresh(); }} />
      )}
      <SettingsCategory title={t`People in this workspace`}
                        desc={canManage
                          ? t`Co-owners run the workspace with you — people, sharing, the name and icon — but only the owner can delete it or hand it over. Editors can add and change content. Viewers can open and read, comment on the canvas, and vote; in a document they can read comments but not add them.`
                          : t`Only the owner or a co-owner can change roles or remove members.`}>
        {loading && members.length === 0 && <div className="settings-empty"><Trans>Loading…</Trans></div>}
        <ul className="settings-member-list">
          {members.map(m => {
            const self = m.user_id === user?.id;
            const isOwnerRow = m.role === 'owner';
            const changeable = canManage && !isOwnerRow && !self && ASSIGNABLE_ROLES.includes(m.role);
            return (
              <li key={m.user_id} className={`settings-member-row${self ? ' is-self' : ''}`}>
                {/* Every person gets a face. On your own row the face and the
                    name open your profile, and a quiet Edit profile shows
                    while the pointer is on the row (personFace.css). */}
                <PersonFace userId={m.user_id} name={label(m)} color={pickPresenceColor(m.user_id)}
                            className="settings-member-face"
                            {...(editSelf && self
                              ? { onClick: editSelf, title: t`Edit profile`, ariaLabel: t`Edit profile` }
                              : { ariaHidden: true })} />
                <span className="settings-member-name" dir="auto">
                  {self && editSelf ? (
                    <button type="button" className="settings-member-name-btn" onClick={editSelf}>
                      {label(m)}<span className="settings-member-you">{t` (you)`}</span>
                    </button>
                  ) : (
                    <>{label(m)}{self && <span className="settings-member-you">{t` (you)`}</span>}</>
                  )}
                </span>
                {self && editSelf && (
                  <button type="button" className="settings-link-btn settings-member-edit" onClick={editSelf}><Trans>Edit profile</Trans></button>
                )}
                {changeable ? (
                  <select className="settings-input" aria-label={t`Role for ${ph({ label: label(m) })}`}
                          value={m.role} onChange={(e) => changeRole(m, e.target.value)}>
                    {ASSIGNABLE_ROLES.map(r => {
                      const locked = r !== 'viewer' && lockedViewer(m);
                      return <option key={r} value={r} disabled={locked}>{locked ? t`${ph({ value: ROLE_LABEL[r] })} — full` : ROLE_LABEL[r]}</option>;
                    })}
                  </select>
                ) : (
                  <span className="settings-member-role">{ROLE_LABEL[m.role] || m.role}</span>
                )}
                {/* Every row of a managed list carries the same action slots,
                    hidden where they don't apply, so the role menus line up in
                    one column. 'Make owner' showing on some rows only used to
                    shift those rows' menus 80px left of the others. */}
                {canManage && (
                  <span className="settings-member-actions">
                    {isOwner && (!isOwnerRow && !self && m.role !== 'service' && m.role !== 'viewer'
                      ? <button type="button" className="settings-link-btn" onClick={() => transfer(m)}><Trans>Make owner</Trans></button>
                      : <SlotPlaceholder><Trans>Make owner</Trans></SlotPlaceholder>)}
                    {!isOwnerRow && !self && m.role !== 'service'
                      ? <button type="button" className="settings-link-btn is-danger" onClick={() => remove(m)}><Trans>Remove</Trans></button>
                      : <SlotPlaceholder><Trans>Remove</Trans></SlotPlaceholder>}
                  </span>
                )}
              </li>
            );
          })}
          {pending.map(row => (
            <li key={row.id} className="settings-member-row settings-member-pending">
              {/* No person yet, so no face: the empty slot keeps the address
                  in line with the names above. */}
              <span className="settings-member-face is-empty" aria-hidden="true" />
              <span className="settings-member-name" title={row.email}>{row.email}</span>
              <span className="settings-member-role">
                <Trans>{ph({ value: ROLE_LABEL[row.role] || row.role })} · invite sent, gets access when they sign up</Trans>
              </span>
              {canManage && (
                <span className="settings-member-actions">
                  {isOwner && <SlotPlaceholder><Trans>Make owner</Trans></SlotPlaceholder>}
                  <button type="button" className="settings-link-btn is-danger"
                          onClick={() => revokePending(row)}><Trans>Revoke</Trans></button>
                </span>
              )}
            </li>
          ))}
        </ul>
      </SettingsCategory>
      {canManage && (
        <SettingsCategory title={t`Add someone`}
                          desc={editorLimitAllowed() ? t`They sign in to accept.` : t`They sign in to accept. Editors are free on every plan.`}>
          <div className="settings-invite-row">
            <input className="settings-input" type="email" placeholder={t`Email address`}
                   aria-label={t`Email address to invite`}
                   value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)}
                   onKeyDown={(e) => { if (isComposingKey(e)) return; if (e.key === 'Enter') { e.preventDefault(); invite(); } }} />
            <select className="settings-input" aria-label={t`Role for the new member`}
                    value={inviteLocked ? 'viewer' : inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
              <option value="editor" disabled={inviteLocked}>{inviteLocked ? t`Editor — full` : t`Editor`}</option>
              <option value="viewer">{t`Viewer`}</option>
            </select>
            <button type="button" className="settings-btn" onClick={invite} disabled={!inviteEmail.trim()}><Trans>Invite</Trans></button>
          </div>
        </SettingsCategory>
      )}
    </div>
  );
}
