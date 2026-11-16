// Which newer columns public.comments has, learned from the database itself,
// so the client works before and after the migration that adds them
// (`mentions uuid[]`, `edited_at`). Learned once: from any row read (select *
// names every column), or from a write the database refuses for naming a
// column it does not have; that write is then sent again without it.
//
// Pure: commentsApi.js holds the one probe and does the writes.

// PostgREST answers PGRST204 ("Could not find the 'mentions' column of
// 'comments' in the schema cache"); Postgres itself answers 42703.
export function isUnknownColumnError(error, column) {
  if (!error || !column) return false;
  const code = String(error.code || '');
  if (code !== 'PGRST204' && code !== '42703') return false;
  return new RegExp(`\\b${column}\\b`, 'i').test(`${error.message || ''} ${error.details || ''}`);
}

// has(column) → true | false | null (not known yet)
export function createColumnProbe(columns = ['mentions', 'edited_at']) {
  const known = new Map();
  return {
    has: (c) => (known.has(c) ? known.get(c) : null),
    // a row as select('*') returned it: every column it has is a key
    learn(row) {
      if (!row || typeof row !== 'object' || !('id' in row)) return;
      for (const c of columns) known.set(c, c in row);
    },
    missing(c) { known.set(c, false); },
  };
}

// The mention ids a write carries: ids, each once, at most 20 (the column's
// own check).
export function mentionIds(mentions) {
  const out = [];
  for (const m of Array.isArray(mentions) ? mentions : []) {
    const id = m && typeof m === 'object' ? m.id : m;
    if (typeof id === 'string' && id && !out.includes(id)) out.push(id);
    if (out.length >= 20) break;
  }
  return out;
}

// A copy of a comment (its card was pasted or duplicated) keeps who the words
// "@": `{ mentions }` to spread into the copy's row, or nothing. `src` is the
// original as select('*') returned it, so it has the key only when the table
// has the column; `has` is what the probe knows (false: it does not).
export function copiedMentions(src, has) {
  if (has === false || !src || !Array.isArray(src.mentions)) return {};
  const ids = mentionIds(src.mentions);
  return ids.length ? { mentions: ids } : {};
}

// The row or patch to send, given what is known. `mentions` leaves when the
// column is known to be missing; on a new comment it also leaves when nobody
// is mentioned (the column's default is the empty list), so a comment with no
// "@" never asks the question.
export function withMentions(row, mentions, has, { insert = false } = {}) {
  const out = { ...row };
  delete out.mentions;
  if (mentions === undefined || has === false) return out;
  const ids = mentionIds(mentions);
  if (insert && ids.length === 0) return out;
  out.mentions = ids;
  return out;
}
