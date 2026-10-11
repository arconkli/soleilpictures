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
} from '../../lib/boardsApi.js';
import { useFeedback } from '../AppFeedback.jsx';
import { SettingsCategory } from './fields.jsx';
import { useSettingsSave } from './saveState.jsx';
import { WORKSPACE_ROLE_LABEL as ROLE_LABEL, ASSIGNABLE_ROLES, canManageWorkspace } from '../../lib/workspaceRoles.js';

export function MembersTab({ workspaceId, workspaceName, user, role, onWorkspacesChanged }) {
  const feedback = useFeedback();
  const save = useSettingsSave();
  const isOwner = role === 'owner';
  const canManage = canManageWorkspace(role);
  const [members, setMembers] = useState([]);
  const [directory, setDirectory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('editor');

  const load = async () => {
    if (!workspaceId) { setMembers([]); setDirectory([]); return; }
    setLoading(true);
    try {
      const [m, d] = await Promise.all([listWorkspaceMembers(workspaceId), listWorkspaceDirectory(workspaceId)]);
      setMembers(m); setDirectory(d);
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Could not load members: ' + (e.message || e) });
    } finally {
      setLoading(false);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [workspaceId]);

  const byId = useMemo(() => new Map(directory.map(d => [d.user_id, d])), [directory]);
  const label = (m) => byId.get(m.user_id)?.title || byId.get(m.user_id)?.email || m.user_id.slice(0, 8);

  const changeRole = (m, next) => save(async () => {
    await setWorkspaceMemberRole({ workspaceId, userId: m.user_id, role: next });
    await load();
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

  const invite = async () => {
    const email = inviteEmail.trim();
    if (!email || !canManage) return;
    try {
      const status = await inviteWorkspaceMember({ workspaceId, email, role: inviteRole });
      feedback.toast({
        type: status === 'already_member' ? 'warning' : 'success',
        message: status === 'pending' ? `Invited ${email} — access is waiting for them when they sign up.`
              : status === 'already_member' ? `${email} is already a member.`
              : `Added ${email} as ${inviteRole}.`,
      });
      setInviteEmail('');
      await load();
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Could not invite: ' + (e.message || e) });
    }
  };

  return (
    <div className="settings-tab-body">
      <SettingsCategory title="People in this workspace"
                        desc={canManage
                          ? 'Co-owners run the workspace with you — people, sharing, the name and icon — but only the owner can delete it or hand it over. Editors can add and change content. Viewers can open and read, comment, and vote.'
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
                    {ASSIGNABLE_ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                ) : (
                  <span className="settings-member-role">{ROLE_LABEL[m.role] || m.role}</span>
                )}
                {canManage && !isOwnerRow && !self && m.role !== 'service' && (
                  <span className="settings-member-actions">
                    {isOwner && m.role !== 'viewer' && (
                      <button type="button" className="settings-link-btn" onClick={() => transfer(m)}>Make owner</button>
                    )}
                    <button type="button" className="settings-link-btn is-danger" onClick={() => remove(m)}>Remove</button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </SettingsCategory>
      {canManage && (
        <SettingsCategory title="Add someone" desc="They sign in to accept. Editors are free on every plan.">
          <div className="settings-invite-row">
            <input className="settings-input" type="email" placeholder="Email address"
                   aria-label="Email address to invite"
                   value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)}
                   onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); invite(); } }} />
            <select className="settings-input" aria-label="Role for the new member"
                    value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </select>
            <button type="button" className="settings-btn" onClick={invite} disabled={!inviteEmail.trim()}>Invite</button>
          </div>
        </SettingsCategory>
      )}
    </div>
  );
}
