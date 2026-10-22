// messageEvents.js — what the Messages events record about a message: its
// shape, never its words. A message is a colleague talking about someone's
// work and has no business in an analytics table, so its length is bucketed
// (the buckets comments use, commentsApi.js), attachments and mentions are
// counts, and a failure is its code alone: an error's message can quote the row.

// Coarse enough that a length can't single out a message.
export function lenBucket(n) {
  if (n <= 20) return 'xs';
  if (n <= 80) return 's';
  if (n <= 240) return 'm';
  return 'l';
}

// What msg_send says about the message it sent.
export function sendShape(row) {
  return {
    chars: lenBucket(String(row?.body || '').length),
    attach_n: Array.isArray(row?.attachments) ? row.attachments.length : 0,
    mention_n: Array.isArray(row?.mentions) ? row.mentions.length : 0,
    reply: !!row?.parent_id,
  };
}

// By who is in it now (conversation_summary.active_participant_count); null
// while the list hasn't caught up with a conversation that was just made.
export function conversationKind(people) {
  if (!Number.isFinite(people)) return null;
  return people === 2 ? 'dm' : people > 2 ? 'group' : 'solo';
}

export function errorCode(e) {
  const code = e?.code || e?.name;
  return code ? String(code).slice(0, 40) : 'unknown';
}
