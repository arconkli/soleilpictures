// editorLimit.js — the 10-editor limit on Free and Creator (0520/0521), as the
// app reads it. A personal account can have at most EDITOR_LIMIT people who
// can edit, counted across every workspace it owns. A door that would add one
// more refuses with one of the hints below; an edit link lets the person in as
// a viewer instead. Pure, so it runs in node.

// public._editor_limit() in 0520 says the same number;
// editorLimitMigration.test.mjs reads the SQL and holds them together.
export const EDITOR_LIMIT = 10;

// _editor_refuse (0520) raises with one of these hints. The account's owner
// can make room; anyone else can ask the owner to.
export const EDITOR_LIMIT_HINT = 'editor_limit';
export const EDITOR_LIMIT_ASK_HINT = 'editor_limit_ask_owner';

// What a failed share, invite or role change means for the limit: null when
// it wasn't the limit, else { ask }, which is true when the caller isn't the
// account's owner and can only ask them. supabase-js keeps the hint on the
// error it hands back. A wrapper that re-threw a plain Error keeps only the
// message, and _editor_refuse starts that with "editor limit reached:".
export function editorLimitRefusal(err) {
  const hint = err?.hint;
  if (hint === EDITOR_LIMIT_HINT) return { ask: false };
  if (hint === EDITOR_LIMIT_ASK_HINT) return { ask: true };
  const msg = String(err?.message ?? '');
  if (!/^editor limit reached:/i.test(msg)) return null;
  return { ask: !/^editor limit reached: you have/i.test(msg) };
}

// get_editor_capacity's row (0520) in the app's words. null while unknown:
// callers treat unknown as room, because the server refuses anyway.
export function normalizeEditorCapacity(rowOrRows) {
  const r = Array.isArray(rowOrRows) ? rowOrRows[0] : rowOrRows;
  if (!r) return null;
  const limit = Number(r.editor_limit ?? EDITOR_LIMIT);
  const used = Number(r.used ?? 0);
  const pending = Number(r.pending ?? 0);
  return {
    enforced: Boolean(r.enforced),
    limit,
    used,
    pending,
    taken: used + pending,
    left: Math.max(0, limit - used - pending),
    full: Boolean(r.is_full),
    isAccountOwner: Boolean(r.i_am_account_owner),
    subject: r.subject || 'account',
  };
}
