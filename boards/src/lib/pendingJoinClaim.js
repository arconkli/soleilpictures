// pendingJoinClaim.js — claiming a stashed ?join=<token> once someone is
// signed in.
//
// pendingJoin.js (in the entry chunk) keeps the stash and what the sign-in
// screen shows from it. Everything that happens after sign-in lives here, and
// AuthGate fetches this module only when a join is waiting, like
// components/TeamJoinCard.jsx for the Team plan's links. Listed in
// scripts/bundleBudget.mjs LAZY_IN_APP.

import { logEvent } from './analytics.js';
import { EV } from './analyticsEvents.js';
import { peekJoinMeta, claimCollabLink, joinViewLink } from './inviteApi.js';
import { readPendingJoin, clearPendingJoin } from './pendingJoin.js';
import { JOIN_RETRY, makeJoinConsumer, isInviteLinkNotFound, joinFailureKind, joinFailureMessage, joinSuccessMessage } from './pendingJoinRules.js';

// Claim a stashed link token: join_view_link for a view link, claim_collab_link
// for an edit link (each inserts the board_shares row, idempotently, and returns
// the workspace/board to land on). A token whose kind is unknown is tried as an
// edit link and, on "invite link not found", as a view link. Best-effort; never
// throws upward. The stash is cleared once the claim has an answer about the
// link (joined, or revoked/expired, which must not retry forever); a transient
// failure resolves JOIN_RETRY and leaves it for the next sign-in or boot. Two
// callers cannot claim it twice (makeJoinConsumer). What happened is said in a
// toast.
async function runPendingJoin(pending, userId, toast) {
  let { token, kind, name, sharer } = pending;
  const say = (message) => { try { toast?.({ type: 'info', message, ttl: 7000 }); } catch (_) {} };
  // The cluster's name is only for the toast: ask while the claim runs, when the
  // page that sent the visitor here did not already hand it over.
  const metaP = name ? Promise.resolve(null) : peekJoinMeta(token).catch(() => null);
  try {
    let row;
    try {
      row = kind === 'view' ? await joinViewLink(token) : await claimCollabLink(token);
    } catch (e) {
      if (kind || !isInviteLinkNotFound(e)) throw e;
      kind = 'view';
      row = await joinViewLink(token);
    }
    const meta = await metaP;
    name = name || meta?.name || null;
    // Record EVERY outcome. claim_collab_link only writes its own
    // invite_link_claimed row on the fresh-join branch — 'upgraded', 'already'
    // and 'noop' each return early, so those claims used to leave no trace at
    // all and a join click could vanish with neither a success nor a failure.
    try { logEvent(EV.INVITE_LINK_CLAIM_RESULT, { status: row?.status || 'unknown', kind: kind || 'invite' }); } catch (_) {}
    // The third grant mechanism, recorded in the same shape as the two in
    // ShareModal so "which path actually produces collaborators" is one query
    // rather than three reconstructions. Only the branches that really created
    // or widened a share count.
    if (row?.status === 'joined' || row?.status === 'upgraded') {
      try {
        logEvent(EV.ACCESS_GRANTED, {
          how: kind === 'view' ? 'view_link' : 'invite_link', board_id: row?.board_id || null, surface: 'join_link',
        });
      } catch (_) {}
    }
    if (row?.workspace_id) {
      const wsKey = `soleil.boards.session.${userId}.workspace`;
      localStorage.setItem(wsKey, JSON.stringify({ activeWorkspaceId: row.workspace_id }));
      if (row.board_id) {
        const boardKey = `soleil.boards.session.${userId}.${row.workspace_id}`;
        let existing = {};
        try { existing = JSON.parse(localStorage.getItem(boardKey) || '{}'); } catch (_) {}
        localStorage.setItem(boardKey, JSON.stringify({ ...existing, stack: [row.board_id] }));
      }
    }
    const done = joinSuccessMessage(row?.status, name);
    if (done) say(done);
  } catch (e) {
    console.warn('[join-link] claim failed', e?.message || e);
    try { logEvent(EV.INVITE_LINK_CLAIM_FAILED, { reason: String(e?.message || e).slice(0, 120) }); } catch (_) {}
    // A link that was turned off between opening and joining used to drop the
    // person into their own space with nothing said.
    const failure = joinFailureKind(e);
    if (failure) say(joinFailureMessage(failure, sharer));
    else return JOIN_RETRY;
  }
}

const consumeJoin = makeJoinConsumer({ read: readPendingJoin, clear: clearPendingJoin, run: runPendingJoin });

// AuthGate's one entry point. The consumer is a module singleton, so every
// caller in the page shares one claim.
export async function claimPendingJoin(userId, toast) {
  if (typeof window === 'undefined' || !userId) return;
  await consumeJoin(userId, toast);
}
