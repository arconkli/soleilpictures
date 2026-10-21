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
import {
  editorLimitFull, editorLimitRefusal, editorLimitRefusalMessage, firstName, holdsPlace,
} from '../../lib/editorLimit.js';
import { logEvent } from '../../lib/analytics.js';
import { EV } from '../../lib/analyticsEvents.js';
import { AccountEditorsCard } from './AccountEditorsCard.jsx';

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

export function MembersTab({ workspaceId,workspaceName, user, role, onWorkspacesChanged }) {
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
      feedback.toast({ type: 'error', message: 'Could not load members: ' + (e.message || e) });
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
      title: `Remove ${who}?`,
      message: `They'll lose access to "${workspaceName}" and all its clusters. Clusters shared to them directly in this workspace are unshared as well.`,
      confirmLabel: 'Remove member',
      danger: true,
    });
    if (!ok) return;
    try {
      await removeWorkspaceMember({ workspaceId, userId: m.user_id });
      feedback.toast({ type: 'success', message: `Removed ${who}.` });
      await load();
      editorLimit.refresh();
      await onWorkspacesChanged?.();
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Could not remove: ' + (e.message || e) });
    }
  };

  const transfer = async (m) => {
    const who = label(m);
    // Every limit follows the owner (created_by): a paid owner who hands over
    // a workspace stops covering it. Say so before, and offer co-owner — which
    // keeps this plan paying — as the other answer. Never name the recipient's
    // plan: members don't see each other's.
    const ok = await feedback.confirm({
      title: `Make ${who} the owner?`,
      message: `Its cards, files and storage will count against ${who}'s plan instead of yours, and everyone in it will work within that plan's limits. To let them run it while your plan keeps covering it, make them a co-owner instead. If you transfer, you'll become an editor of "${workspaceName}" and only they can transfer it back.`,
      confirmLabel: 'Transfer ownership',
      altLabel: m.role === 'coowner' ? null : 'Make co-owner instead',
      danger: true,
    });
    if (ok === 'alt') { changeRole(m, 'coowner'); return; }
    if (!ok) return;
    try {
      await transferWorkspaceOwnership({ workspaceId, newOwnerId: m.user_id });
      feedback.toast({ type: 'success', message: `${who} now owns this workspace.` });
      await load();
      await onWorkspacesChanged?.();
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Could not transfer: ' + (e.message || e) });
    }
  };

  // Same confirm as ShareModal.onRevokePending: nothing was granted yet, so
  // there is nothing to undo, only a sign-up that will no longer get access.
  const revokePending = async (row) => {
    const ok = await feedback.confirm({
      title: `Revoke invite to ${row.email}?`,
      message: `They'll no longer get access if they sign up.`,
      confirmLabel: 'Revoke',
      danger: true,
    });
    if (!ok) return;
    try {
      await revokePendingInvite(row.id);
      setPending(arr => arr.filter(x => x.id !== row.id));
      editorLimit.refresh();
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Could not revoke: ' + (e.message || e) });
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
        message: status === 'pending' ? `Invited ${email} — access is waiting for them when they sign up.`
              : status === 'already_member' ? `${email} is already a member.`
              : `Added ${email} as ${role}.`,
      });
      setInviteEmail('');
      await load();
      editorLimit.refresh();
    } catch (e) {
      const full = editorLimitRefusal(e);
      if (full) { feedback.toast({ type: 'warning', message: refused(full, 'workspace_invite'), ttl: 9000 }); return; }
      feedback.toast({ type: 'error', message: 'Could not invite: ' + (e.message || e) });
    }
  };

  return (
    <div className="settings-tab-body">
      {editorLimitAllowed() && canManage && limitCap?.enforced && (
        <AccountEditorsCard cap={limitCap} editors={editorLimit.editors} ownerName={ownerName}
                            selfId={user?.id}
                            onChanged={async () => { await load(); await editorLimit.refresh(); }} />
      )}
      <SettingsCategory title="People in this workspace"
                        desc={canManage
                          ? 'Co-owners run the workspace with you — people, sharing, the name and icon — but only the owner can delete it or hand it over. Editors can add and change content. Viewers can open and read, comment on the canvas, and vote; in a document they can read comments but not add them.'
                          : 'Only the owner or a co-owner can change roles or remove members.'}>
        {loading && members.length === 0 && <div className="settings-empty">Loading…</div>}
        <ul className="settings-member-list">
          {members.map(m => {
            const self = m.user_id === user?.id;
            const isOwnerRow = m.role === 'owner';
            const changeable = canManage && !isOwnerRow && !self && ASSIGNABLE_ROLES.includes(m.role);
            return (
              <li key={m.user_id} className="settings-member-row">
                <span className="settings-member-name">{label(m)}{self ? ' (you)' : ''}</span>
                {changeable ? (
                  <select className="settings-input" aria-label={`Role for ${label(m)}`}
                          value={m.role} onChange={(e) => changeRole(m, e.target.value)}>
                    {ASSIGNABLE_ROLES.map(r => {
                      const locked = r !== 'viewer' && lockedViewer(m);
                      return <option key={r} value={r} disabled={locked}>{locked ? `${ROLE_LABEL[r]} — full` : ROLE_LABEL[r]}</option>;
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
                      ? <button type="button" className="settings-link-btn" onClick={() => transfer(m)}>Make owner</button>
                      : <SlotPlaceholder>Make owner</SlotPlaceholder>)}
                    {!isOwnerRow && !self && m.role !== 'service'
                      ? <button type="button" className="settings-link-btn is-danger" onClick={() => remove(m)}>Remove</button>
                      : <SlotPlaceholder>Remove</SlotPlaceholder>}
                  </span>
                )}
              </li>
            );
          })}
          {pending.map(row => (
            <li key={row.id} className="settings-member-row settings-member-pending">
              <span className="settings-member-name" title={row.email}>{row.email}</span>
              <span className="settings-member-role">
                {ROLE_LABEL[row.role] || row.role} · invite sent, gets access when they sign up
              </span>
              {canManage && (
                <span className="settings-member-actions">
                  {isOwner && <SlotPlaceholder>Make owner</SlotPlaceholder>}
                  <button type="button" className="settings-link-btn is-danger"
                          onClick={() => revokePending(row)}>Revoke</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      </SettingsCategory>
      {canManage && (
        <SettingsCategory title="Add someone"
                          desc={editorLimitAllowed() ? 'They sign in to accept.' : 'They sign in to accept. Editors are free on every plan.'}>
          <div className="settings-invite-row">
            <input className="settings-input" type="email" placeholder="Email address"
                   aria-label="Email address to invite"
                   value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)}
                   onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); invite(); } }} />
            <select className="settings-input" aria-label="Role for the new member"
                    value={inviteLocked ? 'viewer' : inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
              <option value="editor" disabled={inviteLocked}>{inviteLocked ? 'Editor — full' : 'Editor'}</option>
              <option value="viewer">Viewer</option>
            </select>
            <button type="button" className="settings-btn" onClick={invite} disabled={!inviteEmail.trim()}>Invite</button>
          </div>
        </SettingsCategory>
      )}
    </div>
  );
}
