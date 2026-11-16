// How a doc's comments are filed in its docComments map. docState.js writes
// and reads them; the shared-doc room's check on guest writes
// (docRoomBridge.js) holds a guest to them, and runs in the party worker, so
// this imports nothing.
//
//   <thread id>               the thread as it was started; never rewritten
//   <thread id>~r~<reply id>  one reply, written once
//   <thread id>~s             whether the thread is resolved; the last write wins
//   <thread id>~e~<row id>    a change to one comment's words (row id: the
//                             thread's own for its first comment, else a
//                             reply's), or their removal (`deleted`) when the
//                             first comment goes and its replies stay; the
//                             last write wins
//
// So nothing rewrites a thread or a reply once it is written: two people
// changing different things both keep theirs, and a change that meets a
// delete of its thread leaves an entry nobody reads, never a thread with half
// its parts. (The one exception: a reply written INTO its thread by a build
// from before 2026-10-20 can only be taken out by rewriting that thread.)
//
// Builds from before 2026-10-20 rewrote the whole thread (its `replies` and
// `resolved`) for every reply and resolve, so two people writing at once lost
// one of the two. Those threads read as they are: their replies count along
// with the ones filed beside them.

const ID = '[A-Za-z0-9_-]{1,64}';
const REPLY_KEY = new RegExp(`^(${ID})~r~(${ID})$`);
const STATE_KEY = new RegExp(`^(${ID})~s$`);
const EDIT_KEY = new RegExp(`^(${ID})~e~(${ID})$`);

export const commentReplyKey = (threadId, replyId) => `${threadId}~r~${replyId}`;
export const commentStateKey = (threadId) => `${threadId}~s`;
export const commentEditKey = (threadId, rowId) => `${threadId}~e~${rowId || threadId}`;

// { kind: 'thread' | 'reply' | 'state' | 'edit', threadId, replyId?, rowId? }, or null for a
// key that is neither a thread nor one of its entries.
export function parseCommentKey(key) {
  if (typeof key !== 'string' || !key) return null;
  if (!key.includes('~')) return { kind: 'thread', threadId: key };
  let m = REPLY_KEY.exec(key);
  if (m) return { kind: 'reply', threadId: m[1], replyId: m[2] };
  m = STATE_KEY.exec(key);
  if (m) return { kind: 'state', threadId: m[1] };
  m = EDIT_KEY.exec(key);
  if (m) return { kind: 'edit', threadId: m[1], rowId: m[2] };
  return null;
}

// Every value in docComments is a plain object. Nothing in the app has ever
// put a Y type there, so one found there was put there by something else, and
// is never read as a thread.
export function isPlainEntry(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v) && typeof v.toJSON !== 'function';
}

// A reply filed under `key` that says it is the one filed there.
export function isFiledReply(key, v) {
  const p = parseCommentKey(key);
  return !!p && p.kind === 'reply' && isPlainEntry(v) && v.kind === 'reply'
    && v.threadId === p.threadId && v.id === p.replyId;
}

// A thread's resolved state filed under `key`, likewise.
export function isFiledState(key, v) {
  const p = parseCommentKey(key);
  return !!p && p.kind === 'state' && isPlainEntry(v) && v.kind === 'state'
    && v.threadId === p.threadId && typeof v.resolved === 'boolean';
}

// A change to one comment's words filed under `key`, likewise.
export function isFiledEdit(key, v) {
  const p = parseCommentKey(key);
  return !!p && p.kind === 'edit' && isPlainEntry(v) && v.kind === 'edit'
    && v.threadId === p.threadId && v.rowId === p.rowId && typeof v.body === 'string';
}
