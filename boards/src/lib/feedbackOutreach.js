// feedbackOutreach.js — Admin › Feedback's "reached out" marks (0894).
//
// The SQL in supabase/migrations/0894_feedback_outreach.sql is the source of
// truth for who counts as reached out and who is waiting. What lives here is
// the client's copy of the same rules for the moment between a click and the
// refreshed list, plus the filter ids the list RPC accepts.
// feedbackOutreachMigration.test.mjs holds the two sides together.

// p_outreach values for admin_list_feedback. '' sends nothing (everyone).
export const OUTREACH_FILTERS = [
  { id: '', label: 'Everyone' },
  { id: 'waiting', label: 'Waiting for a reply' },
  { id: 'reached', label: 'Reached out' },
];

const norm = (email) => (typeof email === 'string' ? email.trim().toLowerCase() : '');

// 0894's "same person": the same user_id, or the same email ignoring case.
export function samePerson(row, who) {
  if (!row || !who) return false;
  if (row.user_id && who.user_id && row.user_id === who.user_id) return true;
  const a = norm(row.email);
  return a !== '' && a === norm(who.email);
}

// Only someone who left an email can be marked (0894's list gives deleted
// accounts and signed-out senders no email).
export const canMark = (row) => norm(row?.email) !== '';

// A mark just logged for `who` (admin_log_outreach's reply: {id, reached_at,
// reached_by_email}) turns every answer of theirs sent at or before it into
// "reached out", as the refreshed list will. Returns the new rows and what the
// touched rows held before, so Undo can put them back exactly — an older
// answer may have been reached by an earlier outreach that Undo must restore.
export function markReached(rows, who, entry) {
  const at = Date.parse(entry?.reached_at);
  const before = {};
  const next = rows.map((r) => {
    if (!samePerson(r, who)) return r;
    if (Number.isFinite(at) && Date.parse(r.created_at) > at) return r;
    before[r.id] = {
      reached_out_at: r.reached_out_at ?? null,
      reached_out_by: r.reached_out_by ?? null,
      reached_out_id: r.reached_out_id ?? null,
      waiting: r.waiting ?? false,
    };
    return {
      ...r,
      reached_out_at: entry.reached_at,
      reached_out_by: entry.reached_by_email ?? null,
      reached_out_id: entry.id,
      waiting: false,
    };
  });
  return { rows: next, before };
}

// Undo of that mark: rows still showing it get back what they held before.
export function unmarkReached(rows, entryId, before) {
  return rows.map((r) => (r.reached_out_id === entryId && before?.[r.id]
    ? { ...r, ...before[r.id] }
    : r));
}

// The admin's name as the row shows it: the part of their email before the @.
export function reachedByName(email) {
  const e = typeof email === 'string' ? email.trim() : '';
  if (!e) return '';
  const at = e.indexOf('@');
  return at > 0 ? e.slice(0, at) : e;
}
