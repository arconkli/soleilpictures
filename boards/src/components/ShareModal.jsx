// Unified share modal — replaces the topbar prompt. Scoped to a single
// board (the one currently being viewed). Three sections:
//
//   1. Invite — email + role picker (Editor / Viewer / Workspace)
//   2. Workspace members — read-only list with Remove for owners
//   3. Per-board shares — editable role + Remove for owners
//
// Owners and editors can invite people and create public links. Editors
// may only remove/change the invites and links THEY created; the owner can
// manage anything, plus workspace membership. Viewers see the modal in
// read-only mode but can still see who has access for transparency.

import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal.jsx';
import {
  shareBoard, unshareBoard, listBoardShares,
  removeWorkspaceMember, transferWorkspaceOwnership,
  createPublicLink, createCollabLink, revokePublicLink, listPublicLinks, setPublicLinkSubboards, setPublicLinkIndexing,
  inviteWorkspaceMember,
  listPendingInvitesForBoard, listPendingInvitesForWorkspace,
  revokePendingInvite,
} from '../lib/boardsApi.js';
import { pickPresenceColor } from '../lib/presenceColor.js';
import * as userProfiles from '../lib/userProfiles.js';
import { ExplorePublishSection } from './ExplorePublishSection.jsx';
import { useFeedback } from './AppFeedback.jsx';
import { logEventNow } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { X as XIcon } from '../lib/icons.js';
import { Icon as Glyph } from './Icon.jsx';

export function ShareModal({
  board,                  // { id, name, workspace_id }
  workspace,              // { id, name, created_by }
  workspaceMembers = [],  // [{ user_id, role, ... }]
  wsPeers = [],           // workspace presence — used to resolve names/emails
  selfUserId,
  canManage = false,      // caller can write this board (owner OR editor) — mirrors can_write_board
  onClose,
  onMembersChanged,       // refetch trigger after remove-member
  onSharesChanged,        // refetch trigger after share / unshare
  onLinkCreated,          // a public link was minted — refresh the OG thumbnail
  initialSection = null,  // 'invite-link' → scroll that section into view on open (nudge CTA)
}) {
  const feedback = useFeedback();
  const isOwner = workspace?.created_by === selfUserId;
  // Editors share too: anyone who can write the board may invite people and
  // create public links. The owner-only affordances (workspace membership,
  // managing OTHER people's invites/links) stay gated on isOwner below.
  const canInvite = isOwner || canManage;
  const [shares, setShares] = useState([]);          // per-board shares
  const [loadingShares, setLoadingShares] = useState(false);
  // Pending invites = rows in pending_invites (email-only, no account yet).
  // Board-scoped pending list is what we render alongside `shares`; the
  // workspace-scoped list shows up in the workspace members section as
  // "(pending signup)" rows.
  const [pendingBoardInvites, setPendingBoardInvites]     = useState([]);
  const [pendingWorkspaceInvites, setPendingWorkspaceInvites] = useState([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('editor');
  const [inviting, setInviting] = useState(false);
  const [publicLinks, setPublicLinks] = useState([]);  // active links
  const [creatingLink, setCreatingLink] = useState(false);
  // Public-link create options. 'never' | '7d' | '30d' — mapped to an
  // expires_at timestamp on create (the column + read-path filter already
  // exist; only this create UI was missing).
  const [linkExpiry, setLinkExpiry] = useState('never');
  // When true, a created public link lets anonymous viewers also navigate
  // into the board's sub-boards (server enforces the subtree boundary).
  const [linkIncludeSubboards, setLinkIncludeSubboards] = useState(false);
  // Invite-link create options (0189). Editor + 30 days are the defaults —
  // the growth path is "hand an edit key to a collaborator", not a viewer.
  const [inviteLinkRole, setInviteLinkRole] = useState('editor');
  const [inviteLinkExpiry, setInviteLinkExpiry] = useState('30d');
  const [creatingInviteLink, setCreatingInviteLink] = useState(false);
  // Nudge CTA lands here: bring the invite-link section into view on open.
  const inviteLinkSectionRef = useRef(null);
  useEffect(() => {
    if (initialSection !== 'invite-link') return;
    try { inviteLinkSectionRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (_) {}
  }, [initialSection]);

  // publicLinks carries BOTH kinds since 0189 — split for the two sections.
  const viewLinks = publicLinks.filter(l => (l.kind || 'view') === 'view');
  const inviteLinks = publicLinks.filter(l => l.kind === 'invite');
  // Bumped on every userProfiles cache mutation so offline rows re-render
  // with their resolved display names as soon as the lookup lands.
  const [, setProfilesTick] = useState(0);

  useEffect(() => userProfiles.subscribe(() => setProfilesTick(t => t + 1)), []);

  // Owners and editors can list per-board shares; viewers can't (RLS
  // permission denied), so we just skip the fetch in that case. We
  // also pull pending board-level + workspace-level invites in parallel
  // so the modal renders both granted shares and "pending signup" rows.
  // (The workspace-level list stays owner-only server-side; its .catch
  // below quietly yields [] for editors.)
  useEffect(() => {
    if (!canInvite || !board?.id) {
      setShares([]); setPendingBoardInvites([]); setPendingWorkspaceInvites([]);
      return;
    }
    let cancelled = false;
    setLoadingShares(true);
    Promise.all([
      listBoardShares(board.id),
      listPendingInvitesForBoard(board.id).catch(() => []),
      workspace?.id ? listPendingInvitesForWorkspace(workspace.id).catch(() => []) : Promise.resolve([]),
    ])
      .then(([shareRows, pendingBoard, pendingWs]) => {
        if (cancelled) return;
        setShares(shareRows);
        setPendingBoardInvites(pendingBoard);
        setPendingWorkspaceInvites(pendingWs);
        shareRows.forEach(r => userProfiles.resolve(r.user_id));
      })
      .catch(e => {
        console.warn('[share] list failed', e);
        if (!cancelled) { setShares([]); setPendingBoardInvites([]); setPendingWorkspaceInvites([]); }
      })
      .finally(() => { if (!cancelled) setLoadingShares(false); });
    return () => { cancelled = true; };
  }, [board?.id, canInvite, workspace?.id]);

  // Resolve names for workspace members too — peers covers online ones,
  // but offline members were rendering as a generic "Member".
  useEffect(() => {
    workspaceMembers.forEach(m => userProfiles.resolve(m.user_id));
  }, [workspaceMembers]);

  // Public links — owner or editor. Filter to active (non-revoked,
  // non-expired) so the UI only shows useful links.
  useEffect(() => {
    if (!canInvite || !board?.id) { setPublicLinks([]); return; }
    let cancelled = false;
    listPublicLinks(board.id)
      .then(rows => {
        if (cancelled) return;
        const now = Date.now();
        setPublicLinks(rows.filter(l =>
          !l.revoked_at && (!l.expires_at || new Date(l.expires_at).getTime() > now)
        ));
      })
      .catch(e => { console.warn('[share] list public links failed', e); });
    return () => { cancelled = true; };
  }, [board?.id, canInvite]);

  // Copy a link's URL to the clipboard; returns whether the write worked.
  const copyLinkUrl = async (token) => {
    const url = `${window.location.origin}/share/${token}`;
    try { await navigator.clipboard.writeText(url); return true; }
    catch (_) { return false; }
  };

  const onCreatePublicLink = async () => {
    if (creatingLink) return;
    // Reuse before mint: an active VIEW link with the same scope IS this
    // board's link — copy it instead of accumulating interchangeable random
    // tokens. (Rotating a leaked link still works: revoke it, then create.)
    const existing = viewLinks.find(l => !!l.include_subboards === !!linkIncludeSubboards);
    if (existing) {
      const copied = await copyLinkUrl(existing.token);
      feedback.toast(copied
        ? { type: 'success', message: 'Copied your existing link — no new link created.' }
        : { type: 'info', message: `${window.location.origin}/share/${existing.token}`, ttl: 8000 });
      return;
    }
    setCreatingLink(true);
    try {
      const expiresAt = linkExpiry === 'never'
        ? null
        : new Date(Date.now() + (linkExpiry === '7d' ? 7 : 30) * 86400000).toISOString();
      const token = await createPublicLink({ boardId: board.id, expiresAt, includeSubboards: linkIncludeSubboards });
      // Refresh the board's OG thumbnail so the link unfurls with a real preview.
      try { onLinkCreated?.(); } catch (_) {}
      const copied = await copyLinkUrl(token);
      // If the clipboard write failed (permissions, non-secure context),
      // say so — the link still appears in the list below with a Copy
      // button, so point there instead of pretending it copied.
      feedback.toast(copied
        ? { type: 'success', message: 'Public link created and copied to clipboard.' }
        : { type: 'warning', message: 'Public link created — copying failed, use the Copy button below.', ttl: 7000 });
      const rows = await listPublicLinks(board.id);
      setPublicLinks(rows.filter(l => !l.revoked_at && (!l.expires_at || new Date(l.expires_at).getTime() > Date.now())));
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Could not create the link — try again. (' + (e.message || e) + ')' });
    } finally {
      setCreatingLink(false);
    }
  };

  const onCopyPublicLink = async (token) => {
    const url = `${window.location.origin}/share/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      feedback.toast({ type: 'success', message: 'Link copied to clipboard.' });
    } catch (_) {
      feedback.toast({ type: 'info', message: url });
    }
  };

  // Mint (or reuse) an INVITE link — "anyone with this link joins as
  // editor/viewer" (0189). The server also reuses the caller's own live link
  // for the same board+role, so repeat clicks copy rather than accumulate.
  const onCreateInviteLink = async () => {
    if (creatingInviteLink) return;
    const existing = inviteLinks.find(l => l.role === inviteLinkRole && l.created_by === selfUserId);
    if (existing) {
      const copied = await copyLinkUrl(existing.token);
      feedback.toast(copied
        ? { type: 'success', message: 'Copied your existing invite link — no new link created.' }
        : { type: 'info', message: `${window.location.origin}/share/${existing.token}`, ttl: 8000 });
      return;
    }
    setCreatingInviteLink(true);
    try {
      const expiresAt = inviteLinkExpiry === 'never'
        ? null
        : new Date(Date.now() + (inviteLinkExpiry === '7d' ? 7 : 30) * 86400000).toISOString();
      const token = await createCollabLink({ boardId: board.id, role: inviteLinkRole, expiresAt });
      logEventNow(EV.INVITE_LINK_CREATED, {
        role: inviteLinkRole, expiry: inviteLinkExpiry, board_id: board.id, surface: 'share_modal',
      });
      try { onLinkCreated?.(); } catch (_) {}
      const copied = await copyLinkUrl(token);
      feedback.toast(copied
        ? { type: 'success', message: `Invite link copied — anyone with it can join as ${inviteLinkRole}.` }
        : { type: 'warning', message: 'Invite link created — copying failed, use the Copy button below.', ttl: 7000 });
      const rows = await listPublicLinks(board.id);
      setPublicLinks(rows.filter(l => !l.revoked_at && (!l.expires_at || new Date(l.expires_at).getTime() > Date.now())));
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Could not create the invite link — try again. (' + (e.message || e) + ')' });
    } finally {
      setCreatingInviteLink(false);
    }
  };

  const onRevokePublicLink = async (token) => {
    const ok = await feedback.confirm({
      title: 'Revoke this public link?',
      message: 'Anyone using this link will lose access immediately.',
      confirmLabel: 'Revoke',
      danger: true,
    });
    if (!ok) return;
    try {
      await revokePublicLink(token);
      setPublicLinks(arr => arr.filter(l => l.token !== token));
      feedback.toast({ type: 'success', message: 'Link revoked.' });
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Could not revoke: ' + (e.message || e) });
    }
  };

  // Flip an existing link's sub-board access. Optimistic — the server
  // re-checks ownership; on failure we revert by re-listing.
  const onToggleLinkSubboards = async (link) => {
    const next = !link.include_subboards;
    setPublicLinks(arr => arr.map(l => l.token === link.token ? { ...l, include_subboards: next } : l));
    try {
      await setPublicLinkSubboards({ token: link.token, include: next });
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Could not update link: ' + (e.message || e) });
      try {
        const rows = await listPublicLinks(board.id);
        setPublicLinks(rows.filter(l => !l.revoked_at && (!l.expires_at || new Date(l.expires_at).getTime() > Date.now())));
      } catch (_) {}
    }
  };

  // Flip whether search engines may index this link's /share page.
  // Same optimistic pattern as onToggleLinkSubboards.
  const onToggleLinkIndexing = async (link) => {
    const next = !link.allow_indexing;
    setPublicLinks(arr => arr.map(l => l.token === link.token ? { ...l, allow_indexing: next } : l));
    try {
      await setPublicLinkIndexing({ token: link.token, allow: next });
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Could not update link: ' + (e.message || e) });
      try {
        const rows = await listPublicLinks(board.id);
        setPublicLinks(rows.filter(l => !l.revoked_at && (!l.expires_at || new Date(l.expires_at).getTime() > Date.now())));
      } catch (_) {}
    }
  };

  // Resolve a user_id to a friendly display tuple. Order: live presence
  // (peers) → cached profile (userProfiles, populated by users_by_ids
  // RPC) → "You" / "Member" fallback. The cache hydrates async; the
  // profilesTick subscription above re-renders us when names land.
  const peerById = new Map((wsPeers || []).map(p => [p?.user?.id, p]));
  const userMeta = (uid) => {
    const peer = peerById.get(uid);
    const profile = userProfiles.get(uid);
    return {
      name: peer?.user?.name || profile?.name
        || peer?.user?.email || profile?.email
        || (uid === selfUserId ? 'You' : 'Member'),
      email: peer?.user?.email || profile?.email || null,
      online: !!peer,
    };
  };

  // Parse a free-form email field that may contain one or many
  // addresses separated by commas, semicolons, whitespace, or newlines.
  // Loose validation: anything with "@" and a dot in the domain part.
  // Invalid entries are surfaced (not silently dropped) so a typo'd
  // address never looks like it was invited.
  const parseEmails = (raw) => {
    const parts = raw.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
    const valid = parts.filter(s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
    const invalid = parts.filter(s => !valid.includes(s));
    return { valid, invalid };
  };

  const submitInvite = async () => {
    const { valid: emails, invalid } = parseEmails(inviteEmail);
    if (invalid.length > 0) {
      feedback.toast({
        type: 'warning',
        message: `Skipped ${invalid.length === 1 ? 'an invalid address' : `${invalid.length} invalid addresses`}: ${invalid.join(', ')}`,
      });
    }
    if (emails.length === 0 || inviting) return;
    setInviting(true);
    // granted = invitee already had an account; the share is live now
    // pending = no account yet, we wrote pending_invites + sent an
    //           invite-signup email. Claimed automatically on signup.
    const granted = []; const pending = []; const fail = [];

    for (const email of emails) {
      try {
        let status;
        if (inviteRole === 'workspace') {
          status = await inviteWorkspaceMember({
            workspaceId: workspace.id, email, role: 'editor',
          });
          if (status === 'already_member') {
            fail.push({ email, reason: 'already a member' });
            continue;
          }
        } else {
          status = await shareBoard({ boardId: board.id, email, role: inviteRole });
        }
        if (status === 'pending') pending.push(email);
        else granted.push(email);
      } catch (e) {
        const msg = e?.message || String(e);
        fail.push({ email, reason: msg });
      }
    }

    // K-factor numerator: invites actually SENT. The referral ledger only
    // records signups, so without this the "invites per activated user" half
    // of the loop is invisible. One event per outcome group, not per address.
    try {
      if (granted.length > 0) logEventNow(EV.INVITE_SENT, { role: inviteRole, result: 'granted', n: granted.length, surface: 'share_modal' });
      if (pending.length > 0) logEventNow(EV.INVITE_SENT, { role: inviteRole, result: 'pending', n: pending.length, surface: 'share_modal' });
    } catch (_) { /* analytics must never break the invite flow */ }

    // Refresh derived state once after the loop.
    if (inviteRole === 'workspace' && (granted.length > 0 || pending.length > 0)) {
      onMembersChanged?.();
      if (workspace?.id) {
        try { setPendingWorkspaceInvites(await listPendingInvitesForWorkspace(workspace.id)); } catch (_) {}
      }
    }
    if (inviteRole !== 'workspace' && (granted.length > 0 || pending.length > 0)) {
      try {
        const [shareRows, pendingRows] = await Promise.all([
          listBoardShares(board.id),
          listPendingInvitesForBoard(board.id).catch(() => []),
        ]);
        setShares(shareRows);
        setPendingBoardInvites(pendingRows);
      } catch (_) {}
      onSharesChanged?.();
    }

    // Summary toast.
    const okCount = granted.length + pending.length;
    if (fail.length === 0 && okCount > 0) {
      if (emails.length === 1) {
        const only = (granted[0] || pending[0]);
        const wasPending = pending.length === 1;
        feedback.toast({
          type: 'success',
          message: wasPending
            ? `Invite sent to ${only}. They'll get access when they sign up.`
            : (inviteRole === 'workspace'
                ? `Added ${only} to "${workspace.name}".`
                : `Shared "${board.name}" with ${only}.`),
        });
      } else if (pending.length > 0 && granted.length > 0) {
        feedback.toast({
          type: 'success',
          message: `Invited ${granted.length}, plus ${pending.length} pending signup.`,
        });
      } else if (pending.length > 0) {
        feedback.toast({
          type: 'success',
          message: `${pending.length} invite${pending.length === 1 ? '' : 's'} sent — they'll get access when they sign up.`,
        });
      } else {
        feedback.toast({
          type: 'success',
          message: `Invited ${granted.length} ${granted.length === 1 ? 'person' : 'people'}.`,
        });
      }
    } else if (okCount === 0) {
      feedback.toast({
        type: 'error',
        message: emails.length === 1
          ? `Invite failed: ${fail[0].reason}`
          : `Failed to invite ${fail.length}: ${fail.slice(0, 3).map(f => `${f.email} (${f.reason})`).join(', ')}${fail.length > 3 ? '…' : ''}`,
      });
    } else {
      feedback.toast({
        type: 'info',
        message: `Invited ${okCount}${pending.length > 0 ? ` (${pending.length} pending signup)` : ''}, failed ${fail.length}: ${fail.slice(0, 3).map(f => `${f.email} (${f.reason})`).join(', ')}${fail.length > 3 ? '…' : ''}`,
      });
    }

    if (okCount > 0) setInviteEmail('');
    setInviting(false);
  };

  const onRevokePending = async (row) => {
    const ok = await feedback.confirm({
      title: `Revoke invite to ${row.email}?`,
      message: `They'll no longer get access if they sign up.`,
      confirmLabel: 'Revoke',
      danger: true,
    });
    if (!ok) return;
    try {
      await revokePendingInvite(row.id);
      setPendingBoardInvites(arr => arr.filter(x => x.id !== row.id));
      setPendingWorkspaceInvites(arr => arr.filter(x => x.id !== row.id));
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Could not revoke: ' + (e.message || e) });
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

  const onMakeOwner = async (member) => {
    const meta = userMeta(member.user_id);
    const label = meta.email || meta.name;
    const ok = await feedback.confirm({
      title: `Transfer ownership to ${label}?`,
      message: `${label} becomes the new owner of "${workspace.name}". You'll be demoted to editor and can then leave if you want. This can't be undone without their cooperation.`,
      confirmLabel: 'Transfer ownership',
      danger: true,
    });
    if (!ok) return;
    try {
      await transferWorkspaceOwnership({ workspaceId: workspace.id, newOwnerId: member.user_id });
      feedback.toast({ type: 'success', message: `Transferred "${workspace.name}" to ${label}.` });
      onMembersChanged?.();
      onClose?.();   // close modal — the user is no longer the owner; modal switches to read-only
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Could not transfer: ' + (e.message || e) });
    }
  };

  const onRemoveMember = async (member) => {
    const meta = userMeta(member.user_id);
    const label = meta.email || meta.name;
    const ok = await feedback.confirm({
      title: `Remove ${label}?`,
      message: `They'll lose access to "${workspace.name}" and all its clusters.`,
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

  return (
    <Modal open onClose={onClose} className="share-modal" backdropClassName="share-backdrop" labelledBy="share-title">
        <div className="share-head">
          <div>
            <div className="share-eyebrow">SHARE</div>
            <div className="share-title" id="share-title">{board?.name || 'Untitled cluster'}</div>
          </div>
          <button className="share-close" onClick={onClose} aria-label="Close">
            <Glyph as={XIcon} size={14} />
          </button>
        </div>

        {/* INVITE */}
        {canInvite && (
          <div className="share-section">
            <div className="share-eyebrow">INVITE PEOPLE</div>
            <div className="share-invite-row">
              <input className="share-input"
                     type="text"
                     aria-label="Email addresses to invite"
                     placeholder="Email address — add several, separated by commas"
                     value={inviteEmail}
                     onChange={(e) => setInviteEmail(e.target.value)}
                     onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitInvite(); } }} />
              <select className="share-role-select" aria-label="Access level for invitees"
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value)}>
                <option value="editor">Can edit — this cluster &amp; its sub-clusters</option>
                <option value="viewer">Can view — this cluster &amp; its sub-clusters</option>
                {/* Workspace membership grants access to every board, so
                    only the owner may hand it out. */}
                {isOwner && (
                  <option value="workspace">Workspace member — every cluster in this workspace</option>
                )}
              </select>
              <button className="share-invite-btn"
                      onClick={submitInvite}
                      disabled={!inviteEmail.trim() || inviting}>
                {inviting ? 'Inviting…' : 'Invite'}
              </button>
            </div>
            <div className="share-hint">
              Anyone you add gets the same access to this cluster&apos;s
              sub-clusters too.{isOwner && ' Workspace members can edit every cluster in this workspace, not just this one.'}
            </div>
          </div>
        )}

        {/* INVITE WITH A LINK — a claimable link anyone can use to join as
            editor/viewer (0189). Opening the link previews the board; access
            is granted only when they click Join (and sign in). */}
        {canInvite && (
          <div className="share-section" ref={inviteLinkSectionRef}>
            <div className="share-eyebrow">INVITE WITH A LINK{inviteLinks.length > 0 ? ` · ${inviteLinks.length} active` : ''}</div>
            {inviteLinks.length > 0 && (
              <div className="share-list" style={{ marginBottom: 8 }}>
                {inviteLinks.map(l => (
                  <div key={l.token} className="share-row">
                    <span className="share-avatar" style={{ background: 'var(--bg-3)', color: 'var(--ink-1)' }}>🤝</span>
                    <div className="share-row-text">
                      <div className="share-row-name">/share/{l.token.slice(0, 8)}…</div>
                      <div className="share-row-sub">
                        Joins as {l.role} · {l.joined_count > 0 ? `${l.joined_count} joined` : 'nobody joined yet'}
                        {l.expires_at ? ` · expires ${new Date(l.expires_at).toLocaleDateString()}` : ' · never expires'}
                      </div>
                    </div>
                    <button className="share-remove" onClick={() => onCopyPublicLink(l.token)} title="Copy URL">
                      Copy
                    </button>
                    {(isOwner || l.created_by === selfUserId) && (
                      <button className="share-remove" onClick={() => onRevokePublicLink(l.token)}>
                        Revoke
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="share-link-create">
              <label className="share-link-opt">
                Joins as:
                <select className="share-role-select"
                        value={inviteLinkRole}
                        onChange={(e) => setInviteLinkRole(e.target.value)}>
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
              </label>
              <label className="share-link-opt">
                Expires:
                <select className="share-role-select"
                        value={inviteLinkExpiry}
                        onChange={(e) => setInviteLinkExpiry(e.target.value)}>
                  <option value="30d">In 30 days</option>
                  <option value="7d">In 7 days</option>
                  <option value="never">Never</option>
                </select>
              </label>
              <button className="share-invite-btn"
                      onClick={onCreateInviteLink}
                      disabled={creatingInviteLink}
                      title="Copies your existing invite link when one with this role is already active.">
                {creatingInviteLink
                  ? 'Creating…'
                  : inviteLinks.some(l => l.role === inviteLinkRole && l.created_by === selfUserId)
                    ? 'Copy invite link'
                    : 'Create invite link'}
              </button>
            </div>
            <div className="share-hint">
              Anyone with this link can preview the cluster and join with one
              click — no email needed. It covers sub-clusters too; revoke it
              any time.
            </div>
          </div>
        )}

        {/* PEOPLE WITH ACCESS — one truthful access list. Two sub-groups:
            the whole workspace (edits every board) vs. people added to just
            this board. The sub-headers are load-bearing: each group has
            different scope AND different controls. */}
        <div className="share-section">
          <div className="share-eyebrow">
            PEOPLE WITH ACCESS · {workspaceMembers.length + (canInvite ? shares.length : 0)}
          </div>

          <div className="share-subhead">
            Everyone in this workspace · {workspaceMembers.length}{pendingWorkspaceInvites.length > 0 ? ` (+${pendingWorkspaceInvites.length} pending)` : ''}
          </div>
          <div className="share-list">
            {workspaceMembers.length === 0 && pendingWorkspaceInvites.length === 0 ? (
              <div className="share-empty">No members yet — clusters are better together.</div>
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
                      {isWsOwner ? 'Owner' : 'Member — can edit every cluster'}
                      {meta.email && ` · ${meta.email}`}
                    </div>
                  </div>
                  {isOwner && !isSelf && !isWsOwner && (
                    <>
                      <button className="share-remove" onClick={() => onMakeOwner(m)}
                              title="Transfer workspace ownership">
                        Make owner
                      </button>
                      <button className="share-remove" onClick={() => onRemoveMember(m)}>
                        Remove
                      </button>
                    </>
                  )}
                </div>
              );
            })}
            {pendingWorkspaceInvites.map(row => (
              <div key={row.id} className="share-row">
                <span className="share-avatar" style={{ background: 'var(--bg-3)', color: 'var(--ink-1)' }}>
                  {(row.email || '?').charAt(0).toUpperCase()}
                </span>
                <div className="share-row-text">
                  <div className="share-row-name">{row.email}</div>
                  <div className="share-row-sub">
                    Invite sent — gets access when they sign up · {new Date(row.created_at).toLocaleDateString()}
                  </div>
                </div>
                {isOwner && (
                  <button className="share-remove" onClick={() => onRevokePending(row)}>
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </div>

          {canInvite && (
            <>
              <div className="share-subhead">
                Added to this cluster · {shares.length}{pendingBoardInvites.length > 0 ? ` (+${pendingBoardInvites.length} pending)` : ''}
              </div>
              <div className="share-list">
                {loadingShares ? (
                  <div className="share-empty">Loading…</div>
                ) : shares.length === 0 && pendingBoardInvites.length === 0 ? (
                  <div className="share-empty">
                    No one yet. Invite someone above — they&apos;ll see this
                    cluster and everything inside it.
                  </div>
                ) : shares.map(s => {
                  const profile = userProfiles.get(s.user_id);
                  const displayName = profile?.name || s.email;
                  return (
                    <div key={s.user_id} className="share-row">
                      <span className="share-avatar"
                            style={{ background: pickPresenceColor(s.user_id) }}>
                        {(displayName || '?').charAt(0).toUpperCase()}
                      </span>
                      <div className="share-row-text">
                        <div className="share-row-name">{displayName}</div>
                        <div className="share-row-sub">
                          {profile?.name && s.email ? `${s.email} · ` : ''}{ROLE_LABEL[s.role]}
                        </div>
                      </div>
                      {(isOwner || s.invited_by === selfUserId) && (
                        <>
                          <select className="share-role-select share-row-role"
                                  value={s.role}
                                  onChange={(e) => onChangeShareRole(s, e.target.value)}>
                            <option value="editor">Can edit</option>
                            <option value="viewer">Can view</option>
                          </select>
                          <button className="share-remove" onClick={() => onRemoveShare(s)}>
                            Remove
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
                {pendingBoardInvites.map(row => (
                  <div key={row.id} className="share-row">
                    <span className="share-avatar" style={{ background: 'var(--bg-3)', color: 'var(--ink-1)' }}>
                      {(row.email || '?').charAt(0).toUpperCase()}
                    </span>
                    <div className="share-row-text">
                      <div className="share-row-name">{row.email}</div>
                      <div className="share-row-sub">
                        {ROLE_LABEL[row.role] || row.role} · gets access when they sign up · {new Date(row.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    {(isOwner || row.invited_by === selfUserId) && (
                      <button className="share-remove" onClick={() => onRevokePending(row)}>
                        Revoke
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* ANYONE WITH THE LINK — anonymous, account-free, view-only access.
            Scope is THIS board only unless the sub-boards toggle is on, in
            which case viewers can also navigate into its sub-boards. */}
        {canInvite && (
          <div className="share-section">
            <div className="share-eyebrow">ANYONE WITH THE LINK · {viewLinks.length} active</div>
            {viewLinks.length === 0 ? (
              <>
                <div className="share-hint" style={{ marginBottom: 8 }}>
                  Create a link that lets anyone view this cluster without signing
                  in — view-only, no account needed.{' '}
                  {linkIncludeSubboards
                    ? 'Viewers can also open its sub-clusters.'
                    : 'Sub-clusters are not included.'}
                </div>
                <div className="share-link-create">
                  <label className="share-link-opt">
                    <input type="checkbox"
                           checked={linkIncludeSubboards}
                           onChange={(e) => setLinkIncludeSubboards(e.target.checked)} />
                    Include sub-clusters
                  </label>
                  <label className="share-link-opt">
                    Expires:
                    <select className="share-role-select"
                            value={linkExpiry}
                            onChange={(e) => setLinkExpiry(e.target.value)}>
                      <option value="never">Never</option>
                      <option value="7d">In 7 days</option>
                      <option value="30d">In 30 days</option>
                    </select>
                  </label>
                  <button className="share-invite-btn"
                          onClick={onCreatePublicLink}
                          disabled={creatingLink}>
                    {creatingLink ? 'Creating…' : 'Create view-only link'}
                  </button>
                </div>
              </>
            ) : (
              <div className="share-list">
                {viewLinks.map(l => (
                  <div key={l.token} className="share-row">
                    <span className="share-avatar" style={{ background: 'var(--bg-3)', color: 'var(--ink-1)' }}>🔗</span>
                    <div className="share-row-text">
                      <div className="share-row-name">/share/{l.token.slice(0, 8)}…</div>
                      <div className="share-row-sub">
                        View-only · {l.include_subboards ? 'with sub-clusters' : 'this cluster only'} · created {new Date(l.created_at).toLocaleDateString()}
                        {l.expires_at ? ` · expires ${new Date(l.expires_at).toLocaleDateString()}` : ''}
                        {l.allow_indexing ? ' · indexable by search' : ''}
                      </div>
                    </div>
                    {(isOwner || l.created_by === selfUserId) && (
                      <>
                        <button className="share-remove"
                                onClick={() => onToggleLinkSubboards(l)}
                                title={l.include_subboards ? 'Stop sharing sub-clusters' : 'Also share sub-clusters'}>
                          {l.include_subboards ? 'Hide sub-clusters' : 'Add sub-clusters'}
                        </button>
                        <button className="share-remove"
                                onClick={() => onToggleLinkIndexing(l)}
                                title={l.allow_indexing
                                  ? 'Search engines may index this link — click to hide it from search'
                                  : 'Hidden from search engines — click to let this link rank (for marketing clusters)'}>
                          {l.allow_indexing ? 'Hide from search' : 'Allow indexing'}
                        </button>
                      </>
                    )}
                    <button className="share-remove" onClick={() => onCopyPublicLink(l.token)} title="Copy URL">
                      Copy
                    </button>
                    {(isOwner || l.created_by === selfUserId) && (
                      <button className="share-remove" onClick={() => onRevokePublicLink(l.token)}>
                        Revoke
                      </button>
                    )}
                  </div>
                ))}
                <div className="share-link-create" style={{ marginTop: 8 }}>
                  <label className="share-link-opt">
                    <input type="checkbox"
                           checked={linkIncludeSubboards}
                           onChange={(e) => setLinkIncludeSubboards(e.target.checked)} />
                    Include sub-clusters
                  </label>
                  <label className="share-link-opt">
                    Expires:
                    <select className="share-role-select"
                            value={linkExpiry}
                            onChange={(e) => setLinkExpiry(e.target.value)}>
                      <option value="never">Never</option>
                      <option value="7d">In 7 days</option>
                      <option value="30d">In 30 days</option>
                    </select>
                  </label>
                  <button className="share-invite-btn"
                          onClick={onCreatePublicLink}
                          disabled={creatingLink}
                          title="Copies your existing link when one with these settings is already active — a new link is only minted for a new scope.">
                    {creatingLink
                      ? 'Creating…'
                      : viewLinks.some(l => !!l.include_subboards === !!linkIncludeSubboards)
                        ? 'Copy existing link'
                        : 'New link'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <ExplorePublishSection board={board} canManage={canInvite} />

        {!canInvite && (
          <div className="share-section">
            <div className="share-hint">
              Only people who can edit this cluster can change who has access. You
              can still see who does, above.
            </div>
          </div>
        )}
    </Modal>
  );
}
