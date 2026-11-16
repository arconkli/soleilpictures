// A comment thread stores its author's display name as written. When the person
// had no name or email the writers store the English stand-in 'You' (other
// clients and the API read that field, so it stays English in the data; the
// same goes for 'Someone', the stand-in for a name nobody wrote, and for
// 'Member', which lib/commentModel.js gives someone on a cluster whose name
// did not arrive). Every place that shows an author goes through here, so
// the stand-in shows in the viewer's language.
import { t } from '@lingui/core/macro';

export const STAND_IN_AUTHOR = 'You';
export const STAND_IN_SOMEONE = 'Someone';
export const STAND_IN_MEMBER = 'Member';
export const shownAuthor = (author) => {
  if (author === STAND_IN_AUTHOR) return t`You`;
  if (author === STAND_IN_SOMEONE) return t`Someone`;
  if (author === STAND_IN_MEMBER) return t`Member`;
  return author;
};

// A name inside a sentence ("Comment by Ana") only when it is a real name. A
// stand-in there reads wrong in most languages ("Комментарий от Кто-то"), so
// the two other cases each have a whole sentence of their own:
//   'me'     the reader's own (the 'You' stand-in, or `mine`)
//   'none'   no name is known ('Someone', 'Member', nothing)
//   'name'   anyone else
export const authorIn = (author, mine = false) => {
  if (mine || author === STAND_IN_AUTHOR) return 'me';
  return !author || author === STAND_IN_SOMEONE || author === STAND_IN_MEMBER ? 'none' : 'name';
};
// "Comment by Ana" | "Your comment" | "Comment"
export function commentBy(author, mine = false) {
  const k = authorIn(author, mine);
  if (k === 'me') return t`Your comment`;
  return k === 'none' ? t`Comment` : t`Comment by ${author}`;
}
// "Resolved comment by Ana" | "Your resolved comment" | "Resolved comment"
export function resolvedCommentBy(author, mine = false) {
  const k = authorIn(author, mine);
  if (k === 'me') return t`Your resolved comment`;
  return k === 'none' ? t`Resolved comment` : t`Resolved comment by ${author}`;
}
