// User-id → friendly-name cache.
//
// Anywhere in the app that has a user uuid and wants to render
// "Andrew Conklin" instead of "fa105d6d…" pulls from here. The
// cache is populated three ways:
//
//   1. populateFromPeers(wsPeers) — synchronously hydrate from
//      online workspace members (we already have name+email on
//      every entry in the workspace presence list).
//   2. resolve(userId) — async; coalesces unknown ids into a single
//      microtask-batched users_by_ids RPC.
//   3. populateFromUser({ id, email, name }) — pre-seed the current
//      user's row at app boot (saves a roundtrip for self).
//
// Subscribers register via subscribe(fn); we invoke them after every
// cache mutation so React components can re-render with newly-
// resolved names.

import { supabase } from './supabase.js';
import { pickPresenceColor } from './presenceColor.js';

const cache = new Map();          // userId → { name, email, color }
const subscribers = new Set();
const inflight = new Set();       // ids currently being fetched (avoid duplicate roundtrips)
let pendingIds = new Set();
let flushTimer = null;

function notify() {
  for (const fn of subscribers) {
    try { fn(); } catch (_) {}
  }
}

// Convert raw email into a display-friendly name. "andrew@gmail.com"
// → "Andrew" (titlecase the local part, strip dots/numbers). Fall back
// to the bare email if it doesn't look email-y.
function emailToName(email) {
  if (!email) return null;
  const at = email.indexOf('@');
  if (at <= 0) return email;
  const local = email.slice(0, at);
  // "andrew.conklin" / "andrew_conklin" / "andrewconklin1234" → "Andrew Conklin" / "Andrew"
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length === 0) return email;
  return parts
    .map(p => p.replace(/\d+$/, ''))             // strip trailing digits
    .filter(Boolean)
    .map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(' ');
}

function setEntry(userId, partial) {
  if (!userId) return;
  const prev = cache.get(userId) || {};
  const next = { ...prev, ...partial };
  if (!next.color) next.color = pickPresenceColor(userId);
  if (!next.name && next.email) next.name = emailToName(next.email) || next.email;
  cache.set(userId, next);
}

// ── Public API ───────────────────────────────────────────────────────

export function get(userId) {
  if (!userId) return null;
  return cache.get(userId) || null;
}

export function getName(userId, fallback = 'Member') {
  if (!userId) return fallback;
  const e = cache.get(userId);
  return e?.name || e?.email || fallback;
}

export function populateFromUser({ id, email, name }) {
  if (!id) return;
  setEntry(id, {
    email: email || undefined,
    name: name || (email ? emailToName(email) : undefined),
  });
  notify();
}

export function populateFromPeers(wsPeers) {
  if (!Array.isArray(wsPeers) || wsPeers.length === 0) return;
  let any = false;
  for (const p of wsPeers) {
    const id = p?.user?.id;
    if (!id) continue;
    const existing = cache.get(id);
    // Don't trample an already-resolved entry with a less-specific one.
    if (existing?.name && p.user.email === existing.email) continue;
    setEntry(id, {
      email: p.user.email || existing?.email,
      name: p.user.name || existing?.name || (p.user.email ? emailToName(p.user.email) : undefined),
    });
    any = true;
  }
  if (any) notify();
}

// Resolve a userId to a profile entry. Returns immediately if cached;
// otherwise schedules a microtask-batched fetch and returns null. The
// caller should subscribe() and re-read on notify.
export function resolve(userId) {
  if (!userId) return null;
  const cached = cache.get(userId);
  if (cached?.email) return cached;
  // Schedule a batch fetch.
  if (!inflight.has(userId)) {
    pendingIds.add(userId);
    if (!flushTimer) flushTimer = setTimeout(flushPending, 16);
  }
  return cached || null;
}

async function flushPending() {
  flushTimer = null;
  if (pendingIds.size === 0) return;
  const ids = [...pendingIds];
  pendingIds = new Set();
  for (const id of ids) inflight.add(id);

  try {
    const { data, error } = await supabase.rpc('users_by_ids', { p_user_ids: ids });
    if (error) throw error;
    if (Array.isArray(data)) {
      for (const row of data) {
        setEntry(row.user_id, { email: row.email });
      }
    }
    notify();
  } catch (e) {
    console.warn('[userProfiles] users_by_ids failed', e);
  } finally {
    for (const id of ids) inflight.delete(id);
  }
}

// React subscription — components call this in useEffect, then call
// the returned cleanup on unmount. Notification fires on any cache
// mutation so subscribed components can re-render.
export function subscribe(fn) {
  subscribers.add(fn);
  return () => { subscribers.delete(fn); };
}
