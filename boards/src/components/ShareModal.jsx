// Share panel — everything about who can open one cluster, in four blocks:
//
//   1. General access — one picker, one button. Who can open this via a link?
//   2. Invite specific people — email + role
//   3. People with access — one truthful list
//   4. Publish to Explore — collapsed
//
// The panel used to render the two kinds of link (anonymous view-only, and the
// sign-in-then-join-as-editor invite) as two independent sections with two
// create flows, two sets of options and up to four buttons per link row, above
// two people lists with two headers and two empty states. Nothing in it was
// unnecessary — permissions are genuinely detailed — but ALL of it was present
// at rest, so the common case (hand someone a link) was buried inside the rare
// one (audit and revoke). At rest this is now one button, one picker, one
// invite row and one list; every option that existed still exists, one
// disclosure away.
//
// The two link kinds are not two features to somebody deciding what to send a
// person. They are one question with two answers, so the panel asks it once and
// lib/shareAccess.js does the mapping back to rows.
//
// Owners and editors can invite people and create links. Editors may only
// remove/change the invites and links THEY created; the owner can manage
// anything, plus workspace membership. Viewers see the panel read-only but can
// still see who has access, for transparency.

import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal.jsx';
import {
  shareBoard, unshareBoard, listBoardShares,
  removeWorkspaceMember, transferWorkspaceOwnership,
  createCollabLink, revokePublicLink, listPublicLinks, ensurePublicLink,
  setPublicLinkSubboards, setPublicLinkIndexing,
  inviteWorkspaceMember,
  listPendingInvitesForBoard, listPendingInvitesForWorkspace,
  revokePendingInvite,
} from '../lib/boardsApi.js';
import { activeLinks, deriveAccessMode, linkForMode, linkKind, otherModeLinks } from '../lib/shareAccess.js';
import { pickPresenceColor } from '../lib/presenceColor.js';
import { undoToast } from '../lib/undoToast.js';
import * as userProfiles from '../lib/userProfiles.js';
import { ExplorePublishSection } from './ExplorePublishSection.jsx';
import { useFeedback } from './AppFeedback.jsx';
import { logEventNow } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { X as XIcon, Link as LinkIcon, UserPlus as UserPlusIcon } from '../lib/icons.js';
import { Icon as Glyph } from './Icon.jsx';

// Turn an expiry choice into a timestamp. 'never' is an explicit null, which
// the RPCs read as "no expiry" — undefined would take the server default.
const expiryAt = (choice) =>
  choice === 'never' ? null
    : new Date(Date.now() + (choice === '7d' ? 7 : 30) * 86400000).toISOString();

const liveOnly = (rows) => (rows || []).filter(
  l => !l.revoked_at && (!l.expires_at || new Date(l.expires_at).getTime() > Date.now())
);

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
  initialSection = null,  // 'invite-link' → open on the edit mode (nudge CTA)
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
  // Board-scoped pending list renders alongside `shares`; the workspace-scoped
  // list renders as "gets access when they sign up" rows in the same list.
  const [pendingBoardInvites, setPendingBoardInvites]     = useState([]);
  const [pendingWorkspaceInvites, setPendingWorkspaceInvites] = useState([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('editor');
  const [inviting, setInviting] = useState(false);
  const [publicLinks, setPublicLinks] = useState([]);  // active links, both kinds
  const [busyLink, setBusyLink] = useState(false);

  // GENERAL ACCESS. One picker over both link kinds: 'view' (anonymous, no
  // account) · 'edit' (signs in, joins as editor) · 'off' (nothing live).
  // Derived from what is actually true the first time the links land, so the
  // panel opens describing the board rather than proposing something.
  const [accessMode, setAccessMode] = useState('view');
  const derivedFor = useRef(null);
  const [linkSettingsOpen, setLinkSettingsOpen] = useState(false);
  // Opening the panel lands you ON the copy button rather than on the close X
  // (Modal's default is the first focusable, which is the header's close). The
  // topbar is a single "Share" that opens this, so Share → Enter has to be a
  // link on the clipboard or the one-press path is genuinely gone.
  const takeLinkRef = useRef(null);

  // Expiry is per-kind, and the two defaults are the ones that shipped: a
  // view-only link you paste into a brief should outlive the brief, and an
  // edit key handed to a collaborator should not sit open forever.
  const [linkExpiry, setLinkExpiry] = useState('never');
  const [inviteLinkExpiry, setInviteLinkExpiry] = useState('30d');
  // Sub-clusters ON by default, matching the topbar's one-tap copy. They used
  // to disagree, and because ensurePublicLink reuses by SCOPE, a board touched
  // by both surfaces ended up with two live links that were the same link in
  // every way a person cares about.
  const [linkIncludeSubboards, setLinkIncludeSubboards] = useState(true);

  // The invite nudge's CTA asks you to recruit a collaborator, so it opens on
  // the mode that does that. Minting still takes an explicit press.
  useEffect(() => {
    if (initialSection !== 'invite-link') return;
    setAccessMode('edit');
    derivedFor.current = board?.id || 'pending';   // don't let the fetch overrule the CTA
  }, [initialSection, board?.id]);

  // Bumped on every userProfiles cache mutation so offline rows re-render
  // with their resolved display names as soon as the lookup lands.
  const [, setProfilesTick] = useState(0);

  useEffect(() => userProfiles.subscribe(() => setProfilesTick(t => t + 1)), []);

  // Owners and editors can list per-board shares; viewers can't (RLS
  // permission denied), so we just skip the fetch in that case. We
  // also pull pending board-level + workspace-level invites in parallel
  // so the panel renders both granted shares and "pending signup" rows.
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
  // non-expired) so the UI only shows useful links, then let the FIRST load
  // for a board decide which mode the picker opens on.
  useEffect(() => {
    if (!canInvite || !board?.id) { setPublicLinks([]); return; }
    let cancelled = false;
    listPublicLinks(board.id)
      .then(rows => {
        if (cancelled) return;
        const live = liveOnly(rows);
        setPublicLinks(live);
        if (derivedFor.current !== board.id) {
          derivedFor.current = board.id;
          setAccessMode(deriveAccessMode(live, { selfUserId }));
        }
      })
      .catch(e => { console.warn('[share] list public links failed', e); });
    return () => { cancelled = true; };
  }, [board?.id, canInvite, selfUserId]);

  const refreshLinks = async () => {
    try { setPublicLinks(liveOnly(await listPublicLinks(board.id))); } catch (_) {}
  };

  // Copy a link's URL to the clipboard; returns whether the write worked.
  //
  // Every copy path funnels through here so the act of putting a link on the
  // clipboard — the step that actually sends a cluster to another human — is
  // recorded exactly once. It used to emit nothing at all from inside this
  // modal, leaving share_open as the last observable step of the funnel.
  // `kind` must be passed on the mint paths: a freshly created link isn't in
  // publicLinks until the list refetches.
  const copyLinkUrl = async (token, kind) => {
    const url = `${window.location.origin}/share/${token}`;
    try {
      logEventNow(EV.SHARE_LINK_COPIED, {
        kind: kind || (publicLinks.find(l => l.token === token)?.kind === 'invite' ? 'invite' : 'view'),
        surface: 'share_modal',
        board_id: board.id,
      });
    } catch (_) {}
    try { await navigator.clipboard.writeText(url); return true; }
    catch (_) { return false; }
  };

  // ── General access ────────────────────────────────────────────────────────

  const live = activeLinks(publicLinks);
  const modeOpts = { selfUserId, includeSubboards: linkIncludeSubboards };
  const currentLink = linkForMode(publicLinks, accessMode, modeOpts);
  const otherLinks = otherModeLinks(publicLinks, accessMode, modeOpts);

  // Mint-or-reuse the link the current mode describes, then copy it.
  //
  // The view path goes through ensurePublicLink rather than reimplementing
  // reuse-before-mint, so this panel and the topbar's one-tap copy converge on
  // the same link instead of each minting its own.
  const takeLink = async () => {
    if (busyLink || accessMode === 'off') return;
    setBusyLink(true);
    try {
      let token; let kind; let reused;
      if (accessMode === 'edit') {
        kind = 'invite';
        // create_collab_link reuses the caller's own live link for the same
        // board+role, so repeat presses copy rather than accumulate.
        reused = !!currentLink;
        token = currentLink?.token || await createCollabLink({
          boardId: board.id, role: 'editor', expiresAt: expiryAt(inviteLinkExpiry),
        });
        if (!reused) {
          logEventNow(EV.INVITE_LINK_CREATED, {
            role: 'editor', expiry: inviteLinkExpiry, board_id: board.id, surface: 'share_modal',
          });
        }
      } else {
        kind = 'view';
        const r = await ensurePublicLink({
          boardId: board.id,
          includeSubboards: linkIncludeSubboards,
          expiresAt: expiryAt(linkExpiry),
        });
        token = r.token; reused = r.reused;
      }
      // Refresh the board's OG thumbnail so the link unfurls with a real preview.
      if (!reused) { try { onLinkCreated?.(); } catch (_) {} }
      const copied = await copyLinkUrl(token, kind);
      // If the clipboard write failed (permissions, non-secure context), say
      // so — the link is listed under Link settings with a Copy button, so
      // point there instead of pretending it copied.
      feedback.toast(copied
        ? { type: 'success',
            message: kind === 'invite'
              ? 'Invite link copied — anyone with it can join as an editor.'
              : 'Link copied — anyone with it can view this cluster.' }
        : { type: 'warning', message: 'Link ready — copying failed, use Copy under Link settings.', ttl: 7000 });
      await refreshLinks();
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Could not create the link — try again. (' + (e.message || e) + ')' });
    } finally {
      setBusyLink(false);
    }
  };

  // The picker IS the setting, so choosing a mode performs it: view/edit mint
  // (or reuse) and copy, off revokes everything behind the existing confirm.
  // Switching between view and edit never revokes — a link already pasted into
  // a message keeps working, and the status line names it as still live.
  const onPickAccess = async (next) => {
    const from = accessMode;
    if (next === from || busyLink) return;

    if (next === 'off') {
      if (live.length > 0) {
        const ok = await feedback.confirm({
          title: live.length === 1 ? 'Revoke this link?' : `Revoke all ${live.length} links?`,
          message: 'Anyone using them will lose access immediately. People invited by email keep their access.',
          confirmLabel: 'Revoke',
          danger: true,
        });
        if (!ok) return;   // the picker does not move on a cancelled confirm
        setBusyLink(true);
        const results = await Promise.allSettled(live.map(l => revokePublicLink(l.token)));
        setBusyLink(false);
        const failed = results.filter(r => r.status === 'rejected').length;
        await refreshLinks();
        feedback.toast(failed
          ? { type: 'error', message: `Could not revoke ${failed} of ${live.length} — try again.` }
          : { type: 'success', message: live.length === 1 ? 'Link revoked.' : 'Links revoked.' });
        if (failed) return;
      }
      setAccessMode('off');
    } else {
      setAccessMode(next);
    }

    // Picking a mode that already has a link hands you that link — the pick and
    // the act are one press, the same reason the share ask is a toast whose
    // action IS the share. Picking one that doesn't does NOT mint: creating
    // server state as a side effect of reading a dropdown would leave a trail
    // of links behind anyone who merely looked at the options. The button
    // beside the picker is one press away and says exactly what it will do.
    const existing = next === 'off' ? null : linkForMode(publicLinks, next, modeOpts);

    // has_link separates "changed who can open this" from "wanted to and would
    // have had to press again" — both are worth knowing, and lumping them
    // together would report intent as if it were a setting.
    try {
      logEventNow(EV.SHARE_ACCESS_CHANGED, {
        from, to: next, has_link: !!existing || next === 'off',
        board_id: board.id, surface: 'share_modal',
      });
    } catch (_) {}

    if (existing) {
      const c = await copyLinkUrl(existing.token, next === 'edit' ? 'invite' : 'view');
      feedback.toast(c
        ? { type: 'success', message: 'Link copied.' }
        : { type: 'info', message: `${window.location.origin}/share/${existing.token}`, ttl: 8000 });
    }
  };

  const onCopyPublicLink = async (token) => {
    const copied = await copyLinkUrl(token);
    feedback.toast(copied
      ? { type: 'success', message: 'Link copied to clipboard.' }
      : { type: 'info', message: `${window.location.origin}/share/${token}` });
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
      await refreshLinks();
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
      await refreshLinks();
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
        // Which MECHANISM created access. Of every board that has ever had two
        // people put cards on it, the overwhelming majority got its second
        // person through workspace membership rather than a board invite link —
        // but establishing that took reconstructing actors out of card_placed
        // props, which is archaeology, not measurement. Recording `how` at the
        // grant makes the next read a query.
        if (status !== 'pending') {
          try {
            logEventNow(EV.ACCESS_GRANTED, {
              how: inviteRole === 'workspace' ? 'workspace' : 'email',
              role: inviteRole,
              board_id: board.id,
              surface: 'share_modal',
            });
          } catch (_) {}
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
      message: `They'll lose access to "${board.name}" immediately. You can undo right after.`,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    try {
      await unshareBoard({ boardId: board.id, userId: share.user_id });
      setShares(s => s.filter(x => x.user_id !== share.user_id));
      onSharesChanged?.();
      // share_board is an email-keyed upsert, so re-sharing with the same
      // role is a faithful inverse (their account still exists — only the
      // share row was removed).
      undoToast(feedback, {
        message: `Removed ${share.email}'s access`,
        onUndo: async () => {
          try {
            await shareBoard({ boardId: board.id, email: share.email, role: share.role || 'viewer' });
            setShares(s => (s.some(x => x.user_id === share.user_id) ? s : [...s, share]));
            onSharesChanged?.();
          } catch (e) {
            feedback.toast({ type: 'error', message: 'Could not restore access: ' + (e.message || e) });
          }
        },
      });
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

  // What the general-access block says about itself. Built from rows, never
  // from the picker, so it can never claim a link that does not exist.
  const accessHint = accessMode === 'off'
    ? 'Only the people listed below can open this cluster.'
    : accessMode === 'edit'
      ? 'Anyone with the link can preview this cluster and join as an editor with one click. They sign in to accept; sub-clusters are included.'
      : `Anyone with the link can open this cluster${linkIncludeSubboards ? ' and its sub-clusters' : ''} — view only, no account needed.`;

  const linkStatus = () => {
    if (accessMode === 'off') return live.length > 0 ? `${live.length} link${live.length === 1 ? '' : 's'} still live` : 'No link';
    if (!currentLink) return 'No link yet';
    if (linkKind(currentLink) === 'invite') {
      return `Live · ${currentLink.joined_count > 0 ? `${currentLink.joined_count} joined` : 'nobody joined yet'}`
        + (currentLink.expires_at ? ` · expires ${new Date(currentLink.expires_at).toLocaleDateString()}` : ' · never expires');
    }
    return `Live · ${currentLink.include_subboards ? 'with sub-clusters' : 'this cluster only'}`
      + (currentLink.expires_at ? ` · expires ${new Date(currentLink.expires_at).toLocaleDateString()}` : ' · never expires');
  };

  // One count over everything the list actually renders. The pending/share
  // arrays stay empty for viewers, who never fetch them.
  const accessCount = workspaceMembers.length + pendingWorkspaceInvites.length
    + shares.length + pendingBoardInvites.length;

  const linkRow = (l) => (
    <div key={l.token} className="share-row">
      {/* The two link kinds are only distinguishable here and in the sub-line,
          so this icon is load-bearing — it can be neutral, but not absent. */}
      <span className="share-avatar" style={{ background: 'var(--bg-3)', color: 'var(--ink-1)' }}
            aria-label={linkKind(l) === 'invite' ? 'Invite link' : 'View-only link'}>
        <Glyph as={linkKind(l) === 'invite' ? UserPlusIcon : LinkIcon} size={14} />
      </span>
      <div className="share-row-text">
        <div className="share-row-name">/share/{l.token.slice(0, 8)}…</div>
        <div className="share-row-sub">
          {linkKind(l) === 'invite'
            ? `Joins as ${l.role} · ${l.joined_count > 0 ? `${l.joined_count} joined` : 'nobody joined yet'}`
            : `View-only · ${l.include_subboards ? 'with sub-clusters' : 'this cluster only'}`}
          {l.expires_at ? ` · expires ${new Date(l.expires_at).toLocaleDateString()}` : ' · never expires'}
          {l.allow_indexing ? ' · indexable by search' : ''}
        </div>
      </div>
      {/* Wrapped so the four controls a link row can carry wrap as a GROUP.
          Loose in the row they wrapped one at a time and left a single orphaned
          "Revoke" on its own line. */}
      <div className="share-row-actions">
        {linkKind(l) !== 'invite' && (isOwner || l.created_by === selfUserId) && (
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
    </div>
  );

  return (
    <Modal open onClose={onClose} className="share-modal" backdropClassName="share-backdrop"
           labelledBy="share-title" initialFocusRef={canInvite ? takeLinkRef : undefined}>
        <div className="share-head">
          <div>
            <div className="share-eyebrow">SHARE</div>
            <div className="share-title" id="share-title">{board?.name || 'Untitled cluster'}</div>
          </div>
          <button className="share-close" onClick={onClose} aria-label="Close">
            <Glyph as={XIcon} size={14} />
          </button>
        </div>

        {/* ONE scroll container. Each section used to carry its own
            overflow-y:auto, which on a phone — where .share-modal is a
            full-screen flex column — meant three independently scrolling
            regions stacked inside one dialog. */}
        <div className="share-body">

        {/* GENERAL ACCESS — the whole point of the panel, in one row.
            "Anonymous view-only link" and "sign-in-then-join-as-editor link"
            are not two features to somebody deciding what to send a person;
            they are one question with two answers. Everything else about a
            link — expiry, scope, indexing, the list of them — is behind Link
            settings, where its density is correct. */}
        {canInvite && (
          <div className="share-section">
            <div className="share-eyebrow">GENERAL ACCESS</div>

            <div className="share-access-row">
              <button className="share-invite-btn share-invite-btn-primary"
                      ref={takeLinkRef}
                      onClick={takeLink}
                      disabled={busyLink || accessMode === 'off'}
                      title={accessMode === 'off'
                        ? 'Nobody can open this by link — choose an access level first'
                        : 'Copies the existing link when one is already live.'}>
                <Glyph as={LinkIcon} size={14} />{' '}
                {busyLink ? 'Working…' : currentLink ? 'Copy link' : 'Create link & copy'}
              </button>
              <select className="share-role-select share-access-select"
                      aria-label="Who can open this cluster with a link"
                      value={accessMode}
                      onChange={(e) => onPickAccess(e.target.value)}>
                <option value="view">Anyone with the link · can view</option>
                <option value="edit">Anyone with the link · can edit</option>
                <option value="off">Only invited people</option>
              </select>
            </div>

            <div className="share-status">{linkStatus()}</div>
            <div className="share-hint">
              {accessHint}
              {otherLinks.length > 0 && (
                <>
                  {' '}Also live: {otherLinks.length} other link{otherLinks.length === 1 ? '' : 's'} —{' '}
                  <button type="button" className="share-linkish"
                          onClick={() => setLinkSettingsOpen(true)}>
                    manage
                  </button>.
                </>
              )}
            </div>

            <details className="share-link-options"
                     open={linkSettingsOpen}
                     onToggle={(e) => setLinkSettingsOpen(e.currentTarget.open)}>
              <summary className="share-hint">Link settings</summary>
              <div className="share-link-create">
                <label className="share-link-opt">
                  Expires:
                  <select className="share-role-select"
                          value={accessMode === 'edit' ? inviteLinkExpiry : linkExpiry}
                          onChange={(e) => (accessMode === 'edit'
                            ? setInviteLinkExpiry(e.target.value)
                            : setLinkExpiry(e.target.value))}>
                    <option value="never">Never</option>
                    <option value="7d">In 7 days</option>
                    <option value="30d">In 30 days</option>
                  </select>
                </label>
                {/* Invite links cover the subtree inherently, so the scope
                    choice only means something for a view-only link. */}
                {accessMode !== 'edit' && (
                  <label className="share-link-opt">
                    <input type="checkbox"
                           checked={linkIncludeSubboards}
                           onChange={(e) => setLinkIncludeSubboards(e.target.checked)} />
                    Include sub-clusters
                  </label>
                )}
              </div>
              <div className="share-hint">
                Applies to the next link you create. Existing links keep their own
                settings — change them below.
              </div>

              {live.length > 0 && (
                <div className="share-list" style={{ marginTop: 10 }}>
                  {live.map(linkRow)}
                </div>
              )}
            </details>
          </div>
        )}

        {/* INVITE SPECIFIC PEOPLE — the addressed path. Unchanged in behaviour;
            the role labels shed the scope explanation, which now lives once in
            the hint instead of inside every <option>. */}
        {canInvite && (
          <div className="share-section">
            <div className="share-eyebrow">INVITE SPECIFIC PEOPLE</div>
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
                <option value="editor">Can edit</option>
                <option value="viewer">Can view</option>
                {/* Workspace membership grants access to every board, so
                    only the owner may hand it out. */}
                {isOwner && (
                  <option value="workspace">Whole workspace</option>
                )}
              </select>
              <button className="share-invite-btn"
                      onClick={submitInvite}
                      disabled={!inviteEmail.trim() || inviting}>
                {inviting ? 'Inviting…' : 'Invite'}
              </button>
            </div>
            <div className="share-hint">
              They sign in to accept, and get the same access to this
              cluster&apos;s sub-clusters. Editors are free on every plan.
              {isOwner && ' Workspace members can edit every cluster in this workspace, not just this one.'}
            </div>
          </div>
        )}

        {/* PEOPLE WITH ACCESS — one truthful list. It used to be two lists with
            two headers, two counts and two empty states; the scope that
            justified the split is already spelled out in every row's sub-line
            ("can edit every cluster" vs. "Can edit"), so the split was buying
            nothing and costing a screenful. */}
        <div className="share-section">
          <div className="share-eyebrow">PEOPLE WITH ACCESS · {accessCount}</div>
          <div className="share-list">
            {loadingShares && accessCount === 0 ? (
              <div className="share-empty">Loading…</div>
            ) : accessCount === 0 ? (
              <div className="share-empty">
                Just you so far — invite someone above and they&apos;ll see this
                cluster and everything inside it.
              </div>
            ) : null}

            {workspaceMembers.map(m => {
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
                    <div className="share-row-actions">
                      <button className="share-remove" onClick={() => onMakeOwner(m)}
                              title="Transfer workspace ownership">
                        Make owner
                      </button>
                      <button className="share-remove" onClick={() => onRemoveMember(m)}>
                        Remove
                      </button>
                    </div>
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
                    Workspace invite sent — gets access when they sign up · {new Date(row.created_at).toLocaleDateString()}
                  </div>
                </div>
                {isOwner && (
                  <button className="share-remove" onClick={() => onRevokePending(row)}>
                    Revoke
                  </button>
                )}
              </div>
            ))}

            {shares.map(s => {
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
                      {profile?.name && s.email ? `${s.email} · ` : ''}{ROLE_LABEL[s.role]} — this cluster
                    </div>
                  </div>
                  {(isOwner || s.invited_by === selfUserId) && (
                    <div className="share-row-actions">
                      <select className="share-role-select share-row-role"
                              value={s.role}
                              onChange={(e) => onChangeShareRole(s, e.target.value)}>
                        <option value="editor">Can edit</option>
                        <option value="viewer">Can view</option>
                      </select>
                      <button className="share-remove" onClick={() => onRemoveShare(s)}>
                        Remove
                      </button>
                    </div>
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
        </div>

        <ExplorePublishSection board={board} canManage={canInvite} collapsible />

        {!canInvite && (
          <div className="share-section">
            <div className="share-hint">
              Only people who can edit this cluster can change who has access. You
              can still see who does, above.
            </div>
          </div>
        )}
        </div>
    </Modal>
  );
}
