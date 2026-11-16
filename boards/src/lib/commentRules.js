// Who may do what to a comment. One rule for the canvas, docs and notes, and
// shared files (the database enforces its own; this decides what is offered).
//
//   me        { id } | null   (null: a signed-out viewer of a shared file)
//   row       a commentModel Row (omit for thread-level powers only)
//   thread    a commentModel Thread (omit when starting a new one)
//   canRead   may see the cluster / file, so may start a comment and reply
//   canWrite  may edit the cluster / manage the file
//
// → { edit, delete, resolve, reopen, reply, start, copyLink }
import { t, msg } from '@lingui/core/macro';

// The hint in the reply box. A reply to a resolved conversation reopens it
// only for someone who may reopen it (an editor, or whoever started it), so
// only they are told it will. `hint` is truthy when "@" finds people here.
export function replyHint({ resolved = false, canReopen = false, hint = '' } = {}) {
  if (resolved && canReopen) return t`Reply to reopen…`;
  return hint ? t`Reply… @ to mention` : t`Reply…`;
}
// The hint in the box a new comment is written in.
export function startHint({ hint = '' } = {}) {
  return hint ? t`Add a comment… @ to mention` : t`Add a comment…`;
}

// After a reply to a resolved conversation by someone who may not reopen it:
// did it stay put away? `row` is the conversation's first comment as the
// database has it now ({ resolved, hidden }), or null when it could not be
// read (then nothing is known, and nothing is said).
export function stayedResolved(row) {
  return !!row && (row.resolved === true || row.hidden === true);
}
// Module scope, so a message descriptor: the toast reads it with t(REPLY_NOT_REOPENED).
export const REPLY_NOT_REOPENED = msg`Sent. Only an editor or the person who started this can reopen it.`;

export function commentPowers({ me = null, row = null, thread = null, canRead = false, canWrite = false } = {}) {
  const signedIn = !!(me && me.id);
  // A shared file never sends author ids: its rows say `mine` instead.
  const own = (r) => signedIn && !!r && (r.meta?.mine === true || (!!r.authorId && r.authorId === me.id));
  // A row still being sent (or that failed to send) has nothing to act on yet.
  const settled = !!row && !!row.id && !row.pending && !row.failed;
  // A shared file's rows carry the database's own answers (meta.canDelete,
  // meta.canResolve): those are what is offered, not a guess from canWrite.
  const told = (r, key) => (r && r.meta && typeof r.meta[key] === 'boolean' ? r.meta[key] : null);
  const mayDelete = told(row, 'canDelete') ?? (own(row) || (signedIn && !!canWrite));
  const mayResolve = told(thread?.root, 'canResolve');
  // Whoever started a conversation may close it, on a file too.
  const moderate = !!thread && (mayResolve === null
    ? signedIn && (!!canWrite || own(thread.root))
    : mayResolve || own(thread.root));
  return {
    // Only its author changes the words; never a deleted row's.
    edit: settled && !row.deleted && own(row),
    // Its author, or anyone who can edit the cluster / manage the file (on a
    // file: whoever the database says).
    delete: settled && !row.deleted && mayDelete,
    // An editor, or whoever started the conversation.
    resolve: moderate && !thread.resolved,
    reopen: moderate && !!thread.resolved,
    // People who can only view may still talk. A signed-out viewer may when
    // the surface says so (it passes canRead).
    reply: !!canRead && !!thread,
    start: !!canRead,
    copyLink: settled,
  };
}
