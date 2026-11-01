// pendingJoinRules.js — the claim's rules with no Supabase and no React in
// them: single flight, which failures are about the link, and the toasts'
// words. Imported only by pendingJoinClaim.js (so it ships in that lazy chunk,
// never the entry) and tested in node.

import { cleanText } from './pendingJoin.js';

// What `run` returns when the claim could not settle for a reason that is not
// about the link (a network error, a 5xx, 42501 while the session settles): the
// stash stays, so the next sign-in or boot retries it.
export const JOIN_RETRY = Symbol('join-retry');

// One pending join is consumed exactly once. AuthGate reaches it from both
// getSession and onAuthStateChange, and on a fresh sign-in both fire within a
// moment of each other: without this each read the stash, each called the
// claim, and the second toast said "already in". A caller that arrives while
// the claim is in flight gets the same promise. The stash is cleared only once
// the claim has an answer about the link itself (joined, or gone / one cluster
// only, which would never succeed on a retry); a `run` that resolves JOIN_RETRY
// or throws leaves it for the next sign-in or boot.
export function makeJoinConsumer({ read, clear, run }) {
  let inflight = null;
  return function consume(...args) {
    if (inflight) return inflight;
    const pending = read();
    if (!pending) return Promise.resolve(null);
    const started = Promise.resolve().then(() => run(pending, ...args)).then((result) => {
      if (result === JOIN_RETRY) return null;
      clear();
      return result;
    });
    inflight = started.finally(() => { inflight = null; });
    return inflight;
  };
}

// claim_collab_link's answer for a token that is not an edit link. A token of
// unknown kind is tried as an edit link first, then as a view link.
export function isInviteLinkNotFound(err) {
  return err?.code === 'P0002' && /invite link not found/i.test(String(err?.message || ''));
}

// 'gone' (not found, turned off, expired), 'one_cluster' (a view link that
// leaves sub-clusters out, on a cluster that has some), or null for anything
// that is not about the link itself (signed out, suspended, a network error).
export function joinFailureKind(err) {
  const msg = String(err?.message || '');
  if (/one cluster only/i.test(msg)) return 'one_cluster';
  if (err?.code === 'P0002' || err?.code === '22023') return 'gone';
  return null;
}

export function joinFailureMessage(failure, sharer) {
  const who = cleanText(sharer, 40);
  if (failure === 'one_cluster') {
    return who
      ? `This link can’t be joined. Ask ${who} to invite you.`
      : 'This link can’t be joined. Ask the person who sent it to invite you.';
  }
  return who
    ? `This link was turned off. Ask ${who} for a new one.`
    : 'This link was turned off. Ask the person who sent it for a new one.';
}

// The toast after a claim, or null when there is nothing to say ('noop': the
// person owns it or is on its team, and is just taken there).
export function joinSuccessMessage(status, name) {
  const n = cleanText(name);
  if (status === 'joined') {
    return n ? `You joined “${n}”. It stays in your sidebar.` : 'You joined the cluster. It stays in your sidebar.';
  }
  if (status === 'upgraded') {
    return n ? `You can now edit “${n}”.` : 'You can now edit this cluster.';
  }
  if (status === 'already') {
    return n ? `You’re already in “${n}”.` : 'You’re already in this cluster.';
  }
  return null;
}
