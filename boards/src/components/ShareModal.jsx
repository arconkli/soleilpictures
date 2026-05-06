// Unified share modal — replaces the topbar prompt. Scoped to a single
// board (the one currently being viewed). Three sections:
//
//   1. Invite — email + role picker (Editor / Viewer / Workspace)
//   2. Workspace members — read-only list with Remove for owners
//   3. Per-board shares — editable role + Remove for owners
//
// Non-owners see the modal in read-only mode (no add/remove/role-edit
// affordances), but can still see who has access for transparency.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  shareBoard, unshareBoard, listBoardShares,
  removeWorkspaceMember,
} from '../lib/boardsApi.js';
import { supabase } from '../lib/supabase.js';
import { pickPresenceColor } from '../lib/presenceColor.js';
import { useFeedback } from './AppFeedback.jsx';

export function ShareModal({
  board,                  // { id, name, workspace_id }
  workspace,              // { id, name, created_by }
  workspaceMembers = [],  // [{ user_id, role, ... }]
  wsPeers = [],           // workspace presence — used to resolve names/emails
  selfUserId,
  onClose,
  onMembersChanged,       // refetch trigger after remove-member
  onSharesChanged,        // refetch trigger after share / unshare
}) {
  const feedback = useFeedback();
  const isOwner = workspace?.created_by === selfUserId;
  const [shares, setShares] = useState([]);          // per-board shares
  const [loadingShares, setLoadingShares] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('editor'); // 'viewer' | 'editor' | 'workspace'
  const [inviting, setInviting] = useState(false);
  const ref = useRef(null);

  // Close on Escape + outside-click. Outside-click is bound on the
  // backdrop element so clicks inside the panel pass through normally.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Owner sees per-board shares; non-owners can't list them (RLS
  // permission denied), so we just skip the fetch in that case.
  useEffect(() => {
    if (!isOwner || !board?.id) { setShares([]); return; }
    let cancelled = false;
    setLoadingShares(true);
    listBoardShares(board.id)
      .then(rows => { if (!cancelled) setShares(rows); })
      .catch(e => { console.warn('[share] list failed', e); if (!cancelled) setShares([]); })
      .finally(() => { if (!cancelled) setLoadingShares(false); });
    return () => { cancelled = true; };
  }, [board?.id, isOwner]);

  // Resolve a user_id to a friendly display tuple. wsPeers gives us
  // names+emails for currently-online users; offline ones fall back.
  const peerById = new Map((wsPeers || []).map(p => [p?.user?.id, p]));
  const userMeta = (uid) => {
    const peer = peerById.get(uid);
    return {
      name: peer?.user?.name || peer?.user?.email
        || (uid === selfUserId ? 'You' : 'Member'),
      email: peer?.user?.email || null,
      online: !!peer,
    };
  };

  const submitInvite = async () => {
    const email = inviteEmail.trim();
    if (!email || inviting) return;
    setInviting(true);
    try {
      // "workspace" → add them as a workspace_member (full access).
      // anything else → per-board share with the given role.
      if (inviteRole === 'workspace') {
        // Look up the user via the existing user_id_by_email RPC then
        // insert into workspace_members. Mirrors App.jsx#inviteToWorkspace.
        const { data: uid, error } = await supabase
          .rpc('user_id_by_email', { p_email: email });
        if (error) throw error;
        if (!uid) {
          feedback.toast({ type: 'error', message: `No user with email "${email}". They need to sign up first.` });
          setInviting(false);
          return;
        }
        if (uid === selfUserId) {
          feedback.toast({ type: 'info', message: "That's you." });
          setInviting(false);
          return;
        }
        const { error: insErr } = await supabase
          .from('workspace_members')
          .insert({ workspace_id: workspace.id, user_id: uid, role: 'editor' });
        if (insErr) {
          if (insErr.code === '23505') {
            feedback.toast({ type: 'info', message: `${email} is already a member.` });
          } else throw insErr;
        } else {
          feedback.toast({ type: 'success', message: `Added ${email} to "${workspace.name}".` });
          onMembersChanged?.();
        }
      } else {
        await shareBoard({ boardId: board.id, email, role: inviteRole });
        feedback.toast({ type: 'success', message: `Shared "${board.name}" with ${email}.` });
        const rows = await listBoardShares(board.id);
        setShares(rows);
        onSharesChanged?.();
      }
      setInviteEmail('');
    } catch (e) {
      console.error('[share] invite failed', e);
      const msg = e?.message || String(e);
      // Friendly translation of the most common errors.
      if (msg.includes('no user with email')) {
        feedback.toast({ type: 'error', message: `No user with that email. They need to sign up first.` });
      } else {
        feedback.toast({ type: 'error', message: 'Invite failed: ' + msg });
      }
    } finally {
      setInviting(false);
    }
  };

  const onChangeShareRole = async (share, newRole) => {
    try {
      // share_board upserts so re-issuing with a different role updates.
      await shareBoard({ boardId: board.id, email: share.email, role: newRole });
      const rows = await listBoardShares(board.id);
      setShares(rows);
      onSharesChanged?.();
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Could not change role: ' + (e.message || e) });
    }
  };

  const onRemoveShare = async (share) => {
    const ok = await feedback.confirm({
      title: `Remove ${share.email}'s access?`,
      message: `They'll lose access to "${board.name}" immediately.`,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    try {
      await unshareBoard({ boardId: board.id, userId: share.user_id });
      setShares(s => s.filter(x => x.user_id !== share.user_id));
      onSharesChanged?.();
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Could not remove: ' + (e.message || e) });
    }
  };

  const onRemoveMember = async (member) => {
    const meta = userMeta(member.user_id);
    const label = meta.email || meta.name;
    const ok = await feedback.confirm({
      title: `Remove ${label}?`,
      message: `They'll lose access to "${workspace.name}" and all its boards.`,
      confirmLabel: 'Remove member',
      danger: true,
    });
    if (!ok) return;
    try {
      await removeWorkspaceMember({ workspaceId: workspace.id, userId: member.user_id });
      feedback.toast({ type: 'success', message: `Removed ${label}.` });
      onMembersChanged?.();
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Could not remove: ' + (e.message || e) });
    }
  };

  const ROLE_LABEL = { viewer: 'Viewer', editor: 'Editor', workspace: 'Workspace member' };

  return createPortal(
    <div className="share-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div ref={ref} className="share-modal" onPointerDown={(e) => e.stopPropagation()}>
        <div className="share-head">
          <div>
            <div className="share-eyebrow">SHARE</div>
            <div className="share-title">{board?.name || 'Untitled board'}</div>
          </div>
          <button className="share-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 3 L11 11 M11 3 L3 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* INVITE */}
        {isOwner && (
          <div className="share-section">
            <div className="share-eyebrow">INVITE BY EMAIL</div>
            <div className="share-invite-row">
              <input className="share-input"
                     type="email"
                     placeholder="teammate@…"
                     value={inviteEmail}
                     onChange={(e) => setInviteEmail(e.target.value)}
                     onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitInvite(); } }} />
              <select className="share-role-select"
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value)}>
                <option value="editor">Editor (this board)</option>
                <option value="viewer">Viewer (this board)</option>
                <option value="workspace">Workspace member (all boards)</option>
              </select>
              <button className="share-invite-btn"
                      onClick={submitInvite}
                      disabled={!inviteEmail.trim() || inviting}>
                {inviting ? '…' : 'Invite'}
              </button>
            </div>
            <div className="share-hint">
              Editors can edit this board and any sub-boards. Viewers can
              see them but not edit. Workspace members get full access to
              every board in this workspace.
            </div>
          </div>
        )}

        {/* WORKSPACE MEMBERS */}
        <div className="share-section">
          <div className="share-eyebrow">
            WORKSPACE MEMBERS · {workspaceMembers.length}
          </div>
          <div className="share-list">
            {workspaceMembers.length === 0 ? (
              <div className="share-empty">No members yet.</div>
            ) : workspaceMembers.map(m => {
              const meta = userMeta(m.user_id);
              const isWsOwner = m.user_id === workspace?.created_by;
              const isSelf = m.user_id === selfUserId;
              return (
                <div key={m.user_id} className="share-row">
                  <span className="share-avatar"
                        style={{ background: pickPresenceColor(m.user_id) }}>
                    {(meta.name || '?').charAt(0).toUpperCase()}
                  </span>
                  <div className="share-row-text">
                    <div className="share-row-name">
                      {meta.name}{isSelf && ' · You'}
                      {meta.online && <span className="share-online" title="Online" />}
                    </div>
                    <div className="share-row-sub">
                      {isWsOwner ? 'Owner' : 'Editor · workspace member'}
                      {meta.email && ` · ${meta.email}`}
                    </div>
                  </div>
                  {isOwner && !isSelf && !isWsOwner && (
                    <button className="share-remove" onClick={() => onRemoveMember(m)}>
                      Remove
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* PER-BOARD SHARES */}
        {isOwner && (
          <div className="share-section">
            <div className="share-eyebrow">
              SHARED WITH (THIS BOARD ONLY) · {shares.length}
            </div>
            <div className="share-list">
              {loadingShares ? (
                <div className="share-empty">Loading…</div>
              ) : shares.length === 0 ? (
                <div className="share-empty">
                  No one yet. Use the invite field above to share this
                  board (and its sub-boards) with someone outside the
                  workspace.
                </div>
              ) : shares.map(s => (
                <div key={s.user_id} className="share-row">
                  <span className="share-avatar"
                        style={{ background: pickPresenceColor(s.user_id) }}>
                    {(s.email || '?').charAt(0).toUpperCase()}
                  </span>
                  <div className="share-row-text">
                    <div className="share-row-name">{s.email}</div>
                    <div className="share-row-sub">{ROLE_LABEL[s.role]}</div>
                  </div>
                  <select className="share-role-select share-row-role"
                          value={s.role}
                          onChange={(e) => onChangeShareRole(s, e.target.value)}>
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  <button className="share-remove" onClick={() => onRemoveShare(s)}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {!isOwner && (
          <div className="share-section">
            <div className="share-hint">
              Only the workspace owner can change sharing settings.
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
