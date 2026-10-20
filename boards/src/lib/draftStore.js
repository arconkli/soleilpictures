// A message draft per conversation: what you've typed, the files and links
// staged under it, the cards and clusters dropped on it, who you @'d, and the
// message you're replying to.
//
// The live copy is in memory, so a draft is exactly where you left it when you
// come back to the conversation, however quickly you switched away — files
// still uploading included: an upload that lands while you're elsewhere lands
// in its draft. The browser keeps a copy too (localStorage, never synced),
// written 300ms after the last change and at once when the composer goes away
// or the page is hidden, so a reload or a closed tab loses nothing. Only what
// can come back is stored: a file still uploading, or one that failed, lasts
// as long as this page does.
//
// The stored copy has its own key. The plain-text drafts from before
// (`soleil.boards.msg.draft.<conversation>`) and the ones written in the old
// reply-thread view (`…<conversation>:r:<parent>`) are read once, taken in as
// the body, and removed.

const LEGACY_PREFIX = 'soleil.boards.msg.draft.';
const PREFIX = 'soleil.boards.msg.draft2.';
const FLUSH_MS = 300;

// items: what's staged under the text, in the order it was added.
//   { key, status: 'uploading' | 'failed', name, size, mime, file, previewUrl }
//   { key, status: 'done', att }   (att is the attachment record that's sent)
// replyTo: { id, sender_id, sender_name, sender_email, body }
export const EMPTY_DRAFT = Object.freeze({ body: '', items: [], refs: [], mentions: [], replyTo: null });

const live = new Map();
const listeners = new Map();
const dirty = new Set();
let flushTimer = null;
let seq = 0;

export const newItemKey = () => `att-${Date.now().toString(36)}-${(seq += 1)}`;

function storage() {
  try { return globalThis.localStorage || null; } catch (_) { return null; }
}

// What a reply keeps of the message it answers: enough to show "Replying to …"
// after a reload, and its id for the send.
export function replyTarget(m) {
  if (!m?.id) return null;
  return {
    id: m.id,
    sender_id: m.sender_id || null,
    sender_name: m.sender_name || null,
    sender_email: m.sender_email || null,
    body: String(m.body || '').slice(0, 280),
  };
}

export function isEmptyDraft(d) {
  return !d || (!String(d.body || '').trim() && !d.items?.length && !d.refs?.length && !d.replyTo);
}

export function serializeDraft(d) {
  const attachments = (d?.items || []).filter((i) => i.status === 'done' && i.att).map((i) => i.att);
  const stored = {
    v: 2,
    body: String(d?.body || ''),
    attachments,
    refs: d?.refs || [],
    mentions: d?.mentions || [],
    replyTo: d?.replyTo || null,
  };
  if (!stored.body.trim() && !attachments.length && !stored.refs.length && !stored.replyTo) return null;
  return JSON.stringify(stored);
}

export function parseDraft(raw) {
  if (!raw) return EMPTY_DRAFT;
  try {
    const v = JSON.parse(raw);
    if (v?.v !== 2) return EMPTY_DRAFT;
    return {
      body: typeof v.body === 'string' ? v.body : '',
      items: (Array.isArray(v.attachments) ? v.attachments : [])
        .filter((a) => a && typeof a === 'object' && a.kind)
        .map((att) => ({ key: newItemKey(), status: 'done', att })),
      refs: Array.isArray(v.refs) ? v.refs.filter((r) => r && typeof r === 'object') : [],
      mentions: Array.isArray(v.mentions) ? v.mentions.filter((x) => typeof x === 'string') : [],
      replyTo: v.replyTo && typeof v.replyTo.id === 'string' ? v.replyTo : null,
    };
  } catch (_) {
    return EMPTY_DRAFT;
  }
}

// The plain-text drafts from before: the conversation's own, else the first
// one written in its old reply-thread view. Removed once read.
function adoptLegacy(s, key) {
  let body = '';
  const drop = [];
  try {
    const own = s.getItem(LEGACY_PREFIX + key);
    if (own != null) { drop.push(LEGACY_PREFIX + key); body = own; }
    const threadPrefix = `${LEGACY_PREFIX}${key}:r:`;
    for (let i = 0; i < s.length; i += 1) {
      const k = s.key(i);
      if (!k || !k.startsWith(threadPrefix)) continue;
      drop.push(k);
      if (!body.trim()) body = s.getItem(k) || '';
    }
  } catch (_) { return null; }
  if (!drop.length) return null;
  return { body, drop };
}

function readStored(key) {
  const s = storage();
  if (!s) return EMPTY_DRAFT;
  let raw = null;
  try { raw = s.getItem(PREFIX + key); } catch (_) {}
  if (raw) return parseDraft(raw);
  const legacy = adoptLegacy(s, key);
  if (!legacy) return EMPTY_DRAFT;
  const d = legacy.body.trim() ? { ...EMPTY_DRAFT, body: legacy.body } : EMPTY_DRAFT;
  writeStored(key, d);
  try { legacy.drop.forEach((k) => s.removeItem(k)); } catch (_) {}
  return d;
}

function writeStored(key, d) {
  const s = storage();
  if (!s) return;
  try {
    const raw = serializeDraft(d);
    if (raw) s.setItem(PREFIX + key, raw); else s.removeItem(PREFIX + key);
  } catch (_) {}
}

export function getDraft(key) {
  if (!key) return EMPTY_DRAFT;
  let d = live.get(key);
  if (!d) { d = readStored(key); live.set(key, d); }
  return d;
}

export function subscribeDraft(key, fn) {
  if (!key) return () => {};
  let set = listeners.get(key);
  if (!set) { set = new Set(); listeners.set(key, set); }
  set.add(fn);
  return () => { set.delete(fn); if (!set.size) listeners.delete(key); };
}

// fn(draft) → the next draft. { now: true } writes the stored copy at once
// (after a send, so a reload can't bring the sent message back).
export function updateDraft(key, fn, { now = false } = {}) {
  if (!key) return;
  const prev = getDraft(key);
  const next = typeof fn === 'function' ? fn(prev) : { ...prev, ...fn };
  if (!next || next === prev) return;
  live.set(key, next);
  dirty.add(key);
  if (now) flushDrafts(key); else scheduleFlush();
  listeners.get(key)?.forEach((l) => l());
}

export function flushDrafts(key) {
  const keys = key ? (dirty.has(key) ? [key] : []) : [...dirty];
  for (const k of keys) {
    dirty.delete(k);
    writeStored(k, live.get(k) || EMPTY_DRAFT);
  }
  if (!dirty.size && flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
}

function scheduleFlush() {
  watchPageHide();
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => { flushTimer = null; flushDrafts(); }, FLUSH_MS);
}

let watching = false;
function watchPageHide() {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  window.addEventListener('pagehide', () => flushDrafts());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushDrafts(); });
}

// A staged file's thumbnail is an object URL; let it go with the chip.
export function releaseItems(items) {
  for (const i of items || []) {
    if (i?.previewUrl?.startsWith?.('blob:')) {
      try { globalThis.URL?.revokeObjectURL?.(i.previewUrl); } catch (_) {}
    }
  }
}

// Tests only: forget every live draft.
export function resetDraftsForTest() {
  live.clear();
  listeners.clear();
  dirty.clear();
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
}
