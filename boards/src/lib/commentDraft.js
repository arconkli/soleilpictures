// Words typed into a comment box and not sent yet, kept per place: a click
// elsewhere, a closed card or a reload never loses them. In this browser only
// (localStorage, never synced), with a copy in memory for when the browser
// refuses storage. A draft older than two weeks is dropped.
//
// Message drafts (lib/draftStore.js) carry files, cards and the message being
// answered, and a live in-memory copy per conversation with its listeners; a
// comment draft is its words and who was @'d, so it has this smaller store.
const PREFIX = 'soleil.boards.comment.draft.';
export const COMMENT_DRAFT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_BODY = 8000;

const memory = new Map();

function defaultStorage() {
  try { return globalThis.localStorage || null; } catch (_) { return null; }
}

// Where a draft is filed. `surface` is 'canvas' | 'doc' | 'note' | 'file',
// `scope` the cluster or share it is in, `targetId` what it is on: a thread id
// for a reply, `new:<card or point>` for a comment not started yet,
// `edit:<row id>` for a change to one's own.
export function commentDraftKey({ userId = null, surface, scope = null, targetId = null } = {}) {
  const part = (v) => encodeURIComponent(String(v ?? '').slice(0, 120)).replace(/\./g, '%2E') || '-';
  return [userId || 'anon', surface || 'canvas', scope, targetId].map(part).join('.');
}

function clean(draft) {
  const body = String(draft?.body ?? '').slice(0, MAX_BODY);
  const mentions = (Array.isArray(draft?.mentions) ? draft.mentions : [])
    .filter((m) => m && m.id && typeof m.name === 'string' && m.name)
    .map((m) => ({ id: m.id, name: m.name }));
  return { body, mentions };
}

// → { body, mentions } or null when nothing is kept (or it is too old).
export function readCommentDraft(key, { storage = defaultStorage(), now = Date.now() } = {}) {
  if (!key) return null;
  let rec = null;
  try {
    const raw = storage?.getItem(PREFIX + key);
    if (raw) rec = JSON.parse(raw);
  } catch (_) { rec = null; }
  if (!rec || typeof rec !== 'object') rec = memory.get(key) || null;
  if (!rec || typeof rec !== 'object') return null;
  if (!Number.isFinite(rec.at) || now - rec.at > COMMENT_DRAFT_MAX_AGE_MS) {
    clearCommentDraft(key, { storage });
    return null;
  }
  const d = clean(rec);
  return d.body.trim() ? d : null;
}

// Empty words clear the draft. Returns whether something is kept.
export function writeCommentDraft(key, draft, { storage = defaultStorage(), now = Date.now() } = {}) {
  if (!key) return false;
  const d = clean(draft);
  if (!d.body.trim()) { clearCommentDraft(key, { storage }); return false; }
  const rec = { ...d, at: now };
  memory.set(key, rec);
  try { storage?.setItem(PREFIX + key, JSON.stringify(rec)); } catch (_) { /* full or refused: memory has it */ }
  return true;
}

export function clearCommentDraft(key, { storage = defaultStorage() } = {}) {
  if (!key) return;
  memory.delete(key);
  try { storage?.removeItem(PREFIX + key); } catch (_) { /* nothing to remove */ }
}

// Drops every kept draft past two weeks (and anything unreadable). Run once
// when the first comment box mounts. Returns how many went.
export function pruneCommentDrafts({ storage = defaultStorage(), now = Date.now() } = {}) {
  let gone = 0;
  const old = (at) => !Number.isFinite(at) || now - at > COMMENT_DRAFT_MAX_AGE_MS;
  for (const [k, rec] of [...memory]) {
    if (old(rec?.at)) { memory.delete(k); gone += 1; }
  }
  try {
    if (!storage) return gone;
    const keys = [];
    for (let i = 0; i < storage.length; i += 1) {
      const k = storage.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k);
    }
    for (const k of keys) {
      let at = NaN;
      try { at = JSON.parse(storage.getItem(k))?.at; } catch (_) { at = NaN; }
      if (old(at)) { storage.removeItem(k); gone += 1; }
    }
  } catch (_) { /* storage refused: nothing to prune there */ }
  return gone;
}

// What a person has started and not sent in one place: the targetIds (as
// given to commentDraftKey) of every kept draft for that person, surface and
// scope. The canvas reads it to put a draft's pin back where it was left.
export function listCommentDraftTargets({ userId = null, surface, scope = null } = {}, { storage = defaultStorage(), now = Date.now() } = {}) {
  const lead = commentDraftKey({ userId, surface, scope, targetId: 'x' }).split('.').slice(0, 3).join('.') + '.';
  const keys = new Set();
  for (const k of memory.keys()) if (k.startsWith(lead)) keys.add(k);
  try {
    if (storage) {
      for (let i = 0; i < storage.length; i += 1) {
        const k = storage.key(i);
        if (k && k.startsWith(PREFIX + lead)) keys.add(k.slice(PREFIX.length));
      }
    }
  } catch (_) { /* storage refused: memory has what this visit wrote */ }
  const out = [];
  for (const k of keys) {
    if (!readCommentDraft(k, { storage, now })) continue;
    let target = '';
    try { target = decodeURIComponent(k.slice(lead.length)); } catch (_) { continue; }
    if (target && target !== '-') out.push(target);
  }
  return out.sort();
}

// Tests only: forget the in-memory copies.
export function _resetCommentDraftMemory() { memory.clear(); }
