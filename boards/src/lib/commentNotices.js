// Notices for the threads on a doc's or a note's words.
//
// A canvas comment is a row in public.comments, so the database sees it and
// tells people itself. A doc's and a note's threads live in the cluster's
// Y.Doc (lib/docState.js), which the database cannot see: the client says what
// happened through one RPC, notify_doc_comment (the comment notices
// migration), and the database decides who may be told, folds a burst into one
// unread row and keeps the count. Bell only: the mention email still comes
// from notify_comment_mention (lib/commentMentions.js), unchanged.
//
// A doc opened on its own through its share knows its cluster only when the
// reader manages the share. A signed-in person who can edit it there has the
// share's token instead, and the token form of the same RPC,
// notify_shared_doc_comment, finds the cluster from it (docNoticeCall).
//
//   a new thread        doc.new        the cluster's maker (the database picks),
//                                      unless the comment names them
//   a reply             doc.reply      everyone who wrote in the thread
//   a name (@)          doc.mention    the people named
//   an edit adds names  doc.mention    only the people it added
//   resolved            doc.resolved   who started the thread
//
// Never yourself, and a person a comment names is told once, as a mention.
//
// Pure, apart from sendDocNotices, which is handed the client to call.

import { LOOSE_ID } from './commentLink.js';

// Ids from another person's client are data: letters, digits, _ and - only,
// 80 characters at most (the one rule: lib/commentLink.js LOOSE_ID).
export const NOTICE_ID = LOOSE_ID;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const NOTICE_EXCERPT_MAX = 280;
// The RPC tells at most this many people in one call.
export const NOTICE_MAX_PEOPLE = 20;

const idOf = (m) => (m && typeof m === 'object' ? m.id : m);
const people = (list, skip) => {
  const out = [];
  const seen = new Set(skip);
  for (const m of Array.isArray(list) ? list : []) {
    const id = idOf(m);
    if (typeof id !== 'string' || !UUID.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out.slice(0, NOTICE_MAX_PEOPLE);
};

// A comment's words on one line (its names are already "@Name" in the text).
export function noticeExcerpt(body) {
  const text = String(body ?? '').replace(/\s+/g, ' ').trim();
  return text.length > NOTICE_EXCERPT_MAX ? text.slice(0, NOTICE_EXCERPT_MAX - 1).trimEnd() + '…' : text;
}

// Everyone who wrote in the thread, minus `skip` (you, and whoever the reply
// names). `thread` is lib/commentModel.js's Thread.
export function threadPeople(thread, skip = []) {
  if (!thread) return [];
  return people([thread.root?.authorId, ...(thread.replies || []).map((r) => r?.authorId)], skip.filter(Boolean));
}

// What to tell the database about one thing done to a thread:
//   { what: 'new',     threadId, body, mentions }
//   { what: 'reply',   thread, replyId, body, mentions }
//   { what: 'edit',    thread, rowId, body, added }      added: who the edit names that the comment did not
//   { what: 'resolve', thread }
// → [{ kind, comment, recipients, excerpt }], in the order they are sent.
export function docNoticePlan(ev, meId) {
  if (!ev || !meId) return [];
  const me = [meId];
  const excerpt = noticeExcerpt(ev.body);
  const out = [];
  if (ev.what === 'new') {
    if (!ev.threadId) return [];
    const named = people(ev.mentions, me);
    // doc.new is handed the people named: a maker the comment names reads the
    // mention and gets no second row for the same comment
    out.push({ kind: 'doc.new', comment: ev.threadId, recipients: named, excerpt });
    if (named.length) out.push({ kind: 'doc.mention', comment: ev.threadId, recipients: named, excerpt });
  } else if (ev.what === 'reply') {
    if (!ev.thread?.id) return [];
    const comment = ev.replyId || ev.thread.id;
    const named = people(ev.mentions, me);
    // the mention first: someone both named and in the thread reads the mention
    if (named.length) out.push({ kind: 'doc.mention', comment, recipients: named, excerpt });
    const rest = threadPeople(ev.thread, [...me, ...named]);
    if (rest.length) out.push({ kind: 'doc.reply', comment, recipients: rest, excerpt });
  } else if (ev.what === 'edit') {
    if (!ev.thread?.id) return [];
    const named = people(ev.added, me);
    if (named.length) out.push({ kind: 'doc.mention', comment: ev.rowId || ev.thread.id, recipients: named, excerpt });
  } else if (ev.what === 'resolve') {
    const starter = people([ev.thread?.root?.authorId], me);
    if (ev.thread?.id && starter.length) {
      out.push({ kind: 'doc.resolved', comment: ev.thread.id, recipients: starter, excerpt: noticeExcerpt(ev.thread.root?.body) });
    }
  }
  return out;
}

// Which RPC one step of a plan is, and what it is handed. With the cluster
// known, notify_doc_comment; without it, with the share's token (a signed-in
// editor of a doc opened through its share), notify_shared_doc_comment; with
// neither, null: nobody is told.
export function docNoticeCall({ boardId, shareToken, cardId, threadId } = {}, step) {
  if (!threadId || !step?.kind) return null;
  const rest = {
    p_card: cardId || null,
    p_thread: threadId,
    p_comment: step.comment || threadId,
    p_kind: step.kind,
    p_recipients: step.recipients || [],
    p_excerpt: step.excerpt || '',
  };
  if (boardId && UUID.test(String(boardId))) return { fn: 'notify_doc_comment', args: { p_board: boardId, ...rest } };
  if (shareToken && UUID.test(String(shareToken)) && cardId) return { fn: 'notify_shared_doc_comment', args: { p_token: shareToken, ...rest } };
  return null;
}

// Sends a plan, one call after another, and never throws: the comment is
// already written, so a notice that fails is dropped. Before the migration is
// applied the RPC is not there (PGRST202 / 404): the rest of the plan is
// skipped, and nothing is logged. → how many people the database told.
export async function sendDocNotices(client, where, plan) {
  if (!client || !plan?.length) return 0;
  let told = 0;
  for (const p of plan) {
    const call = docNoticeCall(where, p);
    if (!call) return told;
    try {
      const { data, error, status } = await client.rpc(call.fn, call.args);
      if (error) {
        const missing = error.code === 'PGRST202' || status === 404 || /could not find the function/i.test(String(error.message || ''));
        if (!missing) console.warn('[comment-notices] notify failed', error);
        return told;
      }
      told += Number(data) || 0;
    } catch (e) {
      console.warn('[comment-notices] notify failed', e);
      return told;
    }
  }
  return told;
}
