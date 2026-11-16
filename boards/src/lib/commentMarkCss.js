// How the words under a comment look, in a doc and in a note. ProseMirror
// owns the spans (and a note that is being read is drawn from its cached
// html), so the state is not a class on a span: it is a rule that names the
// thread's id. The mark at rest reads as plain text (styles.css .tt-comment);
// these rules say which marks are more than that:
//
//   an open thread's words     a neutral ink tint, and they can be pressed
//   the thread that is open    gold (the one place gold is used: what is open)
//   a resolved thread's words  plain text (no rule)
//   words whose thread is gone plain text (no rule), and not pressable
//
// Pure: returns CSS text. Ids are the comment keys' (lib/commentKeys.js);
// anything else is left out, so nothing in a rule needs escaping.
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export const markable = (id) => typeof id === 'string' && ID.test(id);

const sel = (scope, id) => `${scope} .tt-comment[data-comment-id="${id}"]`;

// The pointer is how a note that is only being read knows the words open a
// thread (components/cards.jsx: a tap on any other mark is a tap on the note).
//
// threads: [{ id, resolved }]   scope: the selector the marks are under
// openId: the thread that is open (lit gold even when it is resolved, so a
// resolved one picked from the list shows where it was; never when it is not
// one of `threads`: a thread deleted while it was open leaves plain words)
// → { rest, open } CSS text ('' when there is nothing to say)
export function commentMarkCss({ threads = [], scope = '', openId = null } = {}) {
  const ids = [];
  const seen = new Set();
  for (const t of threads || []) {
    if (!t || t.resolved || !markable(t.id) || seen.has(t.id)) continue;
    seen.add(t.id);
    ids.push(t.id);
  }
  const rest = ids.length
    ? `${ids.map((id) => sel(scope, id)).join(',')}{background:var(--cmt-mark);cursor:pointer}`
    : '';
  const open = markable(openId) && (threads || []).some((t) => t && t.id === openId)
    ? `${sel(scope, openId)}{background:var(--soleil-soft);box-shadow:inset 0 -2px 0 var(--soleil);cursor:pointer}`
    : '';
  return { rest, open };
}

// Is this mark one a press opens? (its thread is there and not resolved)
export function markOpens(thread) {
  return !!thread && !thread.resolved;
}
