// keepDraft.js — what a draft's keep page (pages/KeepPage.jsx) decides,
// apart from React.
//
// A draft is a cluster ChatGPT or Claude made for someone without an account
// (lib/mcpDrafts.js, 0705). Its keep page reads it through the Worker
// (POST /api/keep/bundle, worker-keep.js) and, once the person is signed in,
// keeps it with keep_mcp_draft. Pure: no imports from the app, so every rule
// here tests under node (keepDraft.test.mjs).

export const KEEP_BUNDLE_PATH = '/api/keep/bundle';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The cluster to open first: ?b=<id>, where the draft's own links point
// (mcpDrafts.js rewriteDraftLinks). Anything else opens its main cluster.
export function firstClusterOf(search) {
  try {
    const b = new URLSearchParams(search || '').get('b');
    return b && UUID.test(b) ? b.toLowerCase() : null;
  } catch (_) {
    return null;
  }
}

// The address bar for a cluster of the draft: the main one has no ?b=.
export function keepPath(token, boardId, rootId) {
  return !boardId || boardId === rootId ? `/keep/${token}` : `/keep/${token}?b=${boardId}`;
}

// The host by name, or null for one we can't name (the page then says "your
// AI chat"). The values are mcp_drafts.host's.
export function hostName(host) {
  if (host === 'chatgpt') return 'ChatGPT';
  if (host === 'claude') return 'Claude';
  return null;
}

// ── Reading the draft ────────────────────────────────────────────────────────

// A failure the page can retry (a dropped connection, a 5xx, too many reads),
// as opposed to an answer about the draft.
export class KeepBundleError extends Error {
  constructor(status, retryAfter = null) {
    super(`keep bundle ${status}`);
    this.name = 'KeepBundleError';
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

// → { state: 'live' | 'kept' | 'expired' | 'unknown', ...the bundle }, or
// throws KeepBundleError. The token goes in the body, never the address
// (worker-keep.js).
export async function fetchKeepBundle(token, boardId, { fetchImpl = globalThis.fetch, origin = '' } = {}) {
  let res;
  try {
    res = await fetchImpl(`${origin}${KEEP_BUNDLE_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(boardId ? { token, board_id: boardId } : { token }),
      cache: 'no-store',
    });
  } catch (_) {
    throw new KeepBundleError(0);
  }
  if (res.status === 404) return { state: 'unknown' };
  if (!res.ok) {
    const after = Number(res.headers?.get?.('retry-after'));
    throw new KeepBundleError(res.status, Number.isFinite(after) && after > 0 ? after : null);
  }
  let body = null;
  try { body = await res.json(); } catch (_) { throw new KeepBundleError(res.status); }
  const state = ['live', 'kept', 'expired'].includes(body?.state) ? body.state : 'unknown';
  return { ...body, state };
}

// ── Keeping it ───────────────────────────────────────────────────────────────

// keep_mcp_draft's refusal, as the page answers it. The hints are the
// function's own (0705); suspended accounts are refused without one.
export function keepFailure(error) {
  const hint = error?.hint;
  if (hint === 'draft_kept') return 'kept';
  if (hint === 'draft_expired') return 'expired';
  if (hint === 'draft_unknown') return 'unknown';
  if (hint === 'not_a_person') return 'not_a_person';
  if (error?.code === '42501' && /suspended/i.test(String(error?.message || ''))) return 'suspended';
  return 'retry';
}

// The cards the keeper can still add on the free plan, or null when no plan
// limit applies to them (keep_mcp_draft answers card_limit only for 'demo').
export function roomLeft(cardCount, cardLimit) {
  if (!Number.isFinite(cardLimit) || !Number.isFinite(cardCount)) return null;
  return Math.max(0, cardLimit - cardCount);
}

// The day an untouched draft is deleted, as "25 Nov" (or the reader's own
// order of day and month).
export function deleteDay(expiresAt, locale) {
  const t = Date.parse(expiresAt || '');
  if (!Number.isFinite(t)) return null;
  try {
    return new Date(t).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  } catch (_) {
    return null;
  }
}

// ── Signing in ───────────────────────────────────────────────────────────────

// A sign-in failure in words: the same words as the sign-in page's
// (AuthGate.jsx humanError; keepDraft.test.mjs holds them equal). resent:
// more than one code went to this address, so an earlier one may be what
// was typed. Only the newest works.
export function signInWords(e, { resent = false } = {}) {
  const msg = (e?.message || String(e || '')).toLowerCase();
  if (msg.includes('captcha')) return "We couldn't confirm you're a person, not a bot. Try again — or another browser if it keeps happening.";
  if (msg.includes('rate') || msg.includes('too many')) return 'Hold on — too many attempts. Try again in a minute.';
  if (resent && msg.includes('expired') && msg.includes('invalid')) return "That code didn't match. Only the newest code works — use the one in the latest email.";
  if (msg.includes('expired') && msg.includes('invalid')) return "That code didn't match. Check the digits, or request a new one.";
  if (msg.includes('expired'))                          return "That code expired. Request a new one.";
  if (resent && msg.includes('invalid') && msg.includes('token')) return "That code didn't match. Only the newest code works — use the one in the latest email.";
  if (msg.includes('invalid') && msg.includes('token')) return "That code didn't match. Try again or request a new one.";
  if (msg.includes('email') && msg.includes('invalid')) return "That email doesn't look right.";
  return e?.message || String(e || 'Something went wrong.');
}

// What a new account made here carries into its first touch (0157's
// backstop reads it at signup): the page's own bag, which already names the
// page as /keep/:token (analytics.js getFirstSource), capped as the sign-in
// page caps it.
export function signupFirstSource(bag) {
  try {
    if (!bag || typeof bag !== 'object' || !Object.keys(bag).length) return null;
    const json = JSON.stringify(bag);
    return json.length <= 2000 ? json : null;
  } catch (_) {
    return null;
  }
}
