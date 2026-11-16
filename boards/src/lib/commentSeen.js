// What in a doc's or a note's comments this person has not read yet. Docs and
// notes keep their threads in the cluster's Y.Doc, which has no per-person
// "last looked" (the canvas has comment_views), so it is kept on this device:
//
//   cmt-seen:<userId>:<boardId>:<cardId>  →  { base: ISO, seen: { <threadId>: ISO } }
//
// `base` is when this person first opened the card's comments here: nothing
// from before it is ever "new" (a doc with forty old threads does not light
// up on a first visit). A comment is unread when someone else wrote it after
// both `base` and the last time its thread was opened. Storage that refuses
// (private mode, full) falls back to memory for the visit.
//
// Pure apart from the storage handed in: no React, no clock but `now`.
import { toMs } from './toMs.js';

const PREFIX = 'cmt-seen:';
const MAX_THREADS = 400;
const memory = new Map();

function defaultStorage() {
  try { return globalThis.localStorage || null; } catch (_) { return null; }
}

export function commentSeenKey({ userId, boardId, cardId } = {}) {
  if (!userId || !cardId) return null;
  return `${PREFIX}${userId}:${boardId || '-'}:${cardId}`;
}

const shape = (rec) => {
  const base = typeof rec?.base === 'string' && Number.isFinite(Date.parse(rec.base)) ? rec.base : null;
  const seen = {};
  if (rec?.seen && typeof rec.seen === 'object') {
    for (const [k, v] of Object.entries(rec.seen)) {
      if (typeof v === 'string' && Number.isFinite(Date.parse(v))) seen[k] = v;
    }
  }
  return base ? { base, seen } : null;
};

// The record for a card, or null when this person has not opened its
// comments on this device.
export function readCommentSeen(key, { storage = defaultStorage() } = {}) {
  if (!key) return null;
  let rec = null;
  try {
    const raw = storage?.getItem(key);
    if (raw) rec = shape(JSON.parse(raw));
  } catch (_) { rec = null; }
  return rec || shape(memory.get(key)) || null;
}

// Whoever shows unread dots hears a change (the panel, the gutter and the
// header's Comments button read the same record).
let version = 0;
const subs = new Set();
export function subscribeCommentSeen(fn) { subs.add(fn); return () => subs.delete(fn); }
export function commentSeenVersion() { return version; }

function write(key, rec, storage) {
  memory.set(key, rec);
  version += 1;
  subs.forEach((fn) => fn());
  try { storage?.setItem(key, JSON.stringify(rec)); } catch (_) { /* memory has it */ }
}

// The first look at a card's comments: from now on, what others write is new.
// → the record (the one already there, when there is one).
export function openCommentSeen(key, { storage = defaultStorage(), now = Date.now() } = {}) {
  if (!key) return null;
  const have = readCommentSeen(key, { storage });
  if (have) return have;
  const rec = { base: new Date(now).toISOString(), seen: {} };
  write(key, rec, storage);
  return rec;
}

// A thread was opened (or a reply arrived while it was open): read up to
// `at`, never moved back. → the record.
export function markCommentSeen(key, threadId, { storage = defaultStorage(), now = Date.now(), at = now } = {}) {
  if (!key || !threadId) return null;
  const rec = openCommentSeen(key, { storage, now });
  const was = Date.parse(rec.seen[threadId] || '') || 0;
  const to = Math.max(Number.isFinite(at) ? at : now, now);
  if (to <= was) return rec;
  const seen = { ...rec.seen, [threadId]: new Date(to).toISOString() };
  // the oldest go first once there are very many
  const ids = Object.keys(seen);
  if (ids.length > MAX_THREADS) {
    ids.sort((a, b) => Date.parse(seen[a]) - Date.parse(seen[b]));
    for (const id of ids.slice(0, ids.length - MAX_THREADS)) delete seen[id];
  }
  const next = { base: rec.base, seen };
  write(key, next, storage);
  return next;
}

// Is there something in this thread (lib/commentModel.js Thread) that someone
// else wrote and this person has not read? `rec` is the card's record; with
// none there is nothing to compare against, so nothing is new.
export function threadUnread(thread, rec, meId) {
  if (!thread || !rec) return false;
  const base = Date.parse(rec.base) || 0;
  const seen = Date.parse(rec.seen?.[thread.id] || '') || 0;
  const after = Math.max(base, seen);
  return [thread.root, ...(thread.replies || [])].some((r) => {
    if (!r || r.deleted) return false;
    if (meId && r.authorId === meId) return false;
    const at = toMs(r.createdAt);
    return at != null && at > after;
  });
}

// The newest time in a thread, for marking it read no earlier than its last
// row (a device clock may run slow).
export function threadNewest(thread) {
  const times = [thread?.root, ...(thread?.replies || [])].map((r) => toMs(r?.createdAt)).filter((t) => t != null);
  return times.length ? Math.max(...times) : null;
}

export function _resetCommentSeenMemory() { memory.clear(); }
