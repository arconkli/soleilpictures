// User-id → friendly-name cache.
//
// Anywhere in the app that has a user uuid and wants to render
// "Andrew Conklin" instead of "fa105d6d…" pulls from here. The
// cache is populated four ways:
//
//   1. populateFromPeers(wsPeers) — synchronously hydrate from
//      online workspace members (we already have name+email on
//      every entry in the workspace presence list).
//   2. populateFromUser({ id, email, name }) — pre-seed the current
//      user's row at app boot (saves a roundtrip for self).
//   3. populateFromOwnProfile({ id, displayName, color }) — overwrites
//      with the current user's *real* set display_name + color once
//      ownProfile finishes loading from Supabase.
//   4. resolve(userId) — async; coalesces unknown ids into a single
//      microtask-batched users_by_ids + getProfilesByIds RPC pair.
//
// In addition, subscribeToProfileChanges() opens a single Supabase
// realtime channel on public.profiles so any peer changing their
// display_name / color is reflected here within ~1s (and all
// comment bubbles re-render via the subscribe() notify loop).
//
// Subscribers register via subscribe(fn); we invoke them after every
// cache mutation so React components can re-render with newly-
// resolved names.

import { supabase } from './supabase.js';
import { pickPresenceColor } from './presenceColor.js';
import { getProfilesByIds } from './boardsApi.js';

const cache = new Map();          // userId → { name, email, color, hasProfile }
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
export function emailToName(email) {
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

// Pre-empt the async fetch for the current user once their real
// profile row has loaded. display_name + color from `profiles`
// always wins over email-derived fallbacks; we mark hasProfile so
// resolve() short-circuits and doesn't re-fetch.
export function populateFromOwnProfile({ id, displayName, color }) {
  if (!id) return;
  setEntry(id, {
    name: displayName || undefined,
    color: color || undefined,
    hasProfile: true,
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
      // Presence carries the peer's broadcast color — keep it as a
      // hint, but a real profiles fetch can still override.
      color: p.user.color || existing?.color,
    });
    any = true;
  }
  if (any) notify();
}

// Resolve a userId to a profile entry. Returns immediately if cached;
// otherwise schedules a microtask-batched fetch and returns the best
// available partial entry (may be null). The caller should subscribe()
// and re-read on notify.
//
// Short-circuits only when we've already heard back from profiles —
// a peer-hydrated entry still gets a profiles roundtrip so we pick
// up the user's *set* display_name / color rather than the
// email-derived fallback.
export function resolve(userId) {
  if (!userId) return null;
  const cached = cache.get(userId);
  if (cached?.hasProfile) return cached;
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
    // Fire both RPCs in parallel: users_by_ids returns auth.users.email
    // for any uid we can see; getProfilesByIds returns display_name /
    // color / avatar_url for workspace mates with a profiles row.
    const [usersRes, profilesRes] = await Promise.allSettled([
      supabase.rpc('users_by_ids', { p_user_ids: ids }),
      getProfilesByIds(ids),
    ]);

    if (usersRes.status === 'fulfilled' && !usersRes.value.error && Array.isArray(usersRes.value.data)) {
      for (const row of usersRes.value.data) {
        setEntry(row.user_id, { email: row.email });
      }
    } else if (usersRes.status === 'rejected') {
      console.warn('[userProfiles] users_by_ids failed', usersRes.reason);
    } else if (usersRes.value?.error) {
      console.warn('[userProfiles] users_by_ids error', usersRes.value.error);
    }

    if (profilesRes.status === 'fulfilled' && profilesRes.value instanceof Map) {
      // Mark every requested id with hasProfile so we don't re-fetch,
      // even ones without a profile row (the Map just won't have them).
      for (const id of ids) {
        const row = profilesRes.value.get(id);
        setEntry(id, {
          name: row?.display_name || undefined,
          color: row?.color || undefined,
          hasProfile: true,
        });
      }
    } else if (profilesRes.status === 'rejected') {
      console.warn('[userProfiles] getProfilesByIds failed', profilesRes.reason);
    }

    notify();
  } finally {
    for (const id of ids) inflight.delete(id);
  }
}

// Open a single realtime channel on public.profiles so any peer
// changing their display_name / color shows up here within ~1s. The
// table is already in supabase_realtime (migration 0030). Returns an
// unsubscribe.
export function subscribeToProfileChanges() {
  const chan = supabase.channel(`profiles-cache:${Math.random().toString(36).slice(2, 9)}`)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'profiles',
    }, (payload) => {
      const row = payload?.new || payload?.old;
      const uid = row?.user_id;
      if (!uid) return;
      // DELETE: clear the profile-derived fields but keep email/name
      // we might have from users_by_ids so we still render something.
      if (payload.eventType === 'DELETE') {
        const prev = cache.get(uid);
        if (prev) {
          cache.set(uid, {
            ...prev,
            name: prev.email ? emailToName(prev.email) : undefined,
            color: pickPresenceColor(uid),
            hasProfile: false,
          });
          notify();
        }
        return;
      }
      setEntry(uid, {
        name: payload.new?.display_name || undefined,
        color: payload.new?.color || undefined,
        hasProfile: true,
      });
      notify();
    })
    .subscribe();
  return () => { try { supabase.removeChannel(chan); } catch (_) {} };
}

// React subscription — components call this in useEffect, then call
// the returned cleanup on unmount. Notification fires on any cache
// mutation so subscribed components can re-render.
export function subscribe(fn) {
  subscribers.add(fn);
  return () => { subscribers.delete(fn); };
}
