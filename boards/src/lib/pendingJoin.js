// pendingJoin.js — what a stashed ?join=<token> knows about itself, and the
// rules for claiming it once.
//
// joinLink.js keeps the bare token across the sign-in hop. A view link
// (join_view_link, 0830) and an edit link (claim_collab_link, 0189) are claimed
// by different functions, so the stash also carries the link's KIND, plus the
// words the sign-in screen and the toasts need (the cluster's name, the
// sender's first name, the card count). All of it is display copy; the token
// stays the only key, and it never goes into an event.
//
// Kept free of the Supabase client and of React so it can sit in the entry
// chunk next to AuthGate and be tested in node. Only what the sign-in screen
// needs before sign-in is here; claiming the join once signed in lives in
// pendingJoinClaim.js, which AuthGate loads only when a join is waiting.

import { parseJoinParam, stashJoin, readJoin, clearJoin } from './joinLink.js';

const INFO_KEY = 'soleil.boards.pending.join.info';

// A stashed join older than this is ignored and cleared when read: a link
// clicked yesterday and never finished is not something to spring on a later
// sign-in.
export const PENDING_JOIN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function normalizeJoinKind(kind) {
  return kind === 'view' || kind === 'invite' ? kind : null;
}

export function cleanText(v, max = 80) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

function cleanCount(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function readInfo() {
  try {
    const raw = JSON.parse(localStorage.getItem(INFO_KEY) || 'null');
    return raw && typeof raw === 'object' ? raw : null;
  } catch (_) { return null; }
}

// Record (or add to) the pending join for `token`. Anything not given keeps
// what was already stored for the same token; a different token starts over.
export function stashPendingJoin({ token, kind, name, sharer, cards } = {}) {
  const t = parseJoinParam(token);
  if (!t) return;
  stashJoin(t);
  const prev = readInfo();
  const same = prev && prev.token === t ? prev : {};
  const next = {
    token: t,
    kind: normalizeJoinKind(kind) || normalizeJoinKind(same.kind),
    name: cleanText(name) || cleanText(same.name),
    sharer: cleanText(sharer, 40) || cleanText(same.sharer, 40),
    cards: cleanCount(cards) || cleanCount(same.cards),
    savedAt: Date.now(),
  };
  try { localStorage.setItem(INFO_KEY, JSON.stringify(next)); } catch (_) {}
}

// { token, kind, name, sharer, cards } or null. kind is null for a token
// stashed without one (an older link, or a ?join= typed by hand).
export function readPendingJoin() {
  const token = readJoin();
  if (!token) return null;
  const info = readInfo();
  const same = info && info.token === token ? info : {};
  // A record with no timestamp was stashed before this existed: honoured, so
  // links stashed before it shipped aren't dropped.
  if (Number.isFinite(same.savedAt) && Date.now() - same.savedAt > PENDING_JOIN_MAX_AGE_MS) {
    clearPendingJoin();
    return null;
  }
  return {
    token,
    kind: normalizeJoinKind(same.kind),
    name: cleanText(same.name),
    sharer: cleanText(same.sharer, 40),
    cards: cleanCount(same.cards),
  };
}

export function clearPendingJoin() {
  clearJoin();
  try { localStorage.removeItem(INFO_KEY); } catch (_) {}
}
