// A comment thread stores its author's display name as written. When the person
// had no name or email the writers store the English stand-in 'You' (other
// clients and the API read that field, so it stays English in the data; the
// same goes for 'Someone', the stand-in for a name nobody wrote). Every
// place that shows an author goes through here, so the stand-in shows in the
// viewer's language.
import { t } from '@lingui/core/macro';

export const STAND_IN_AUTHOR = 'You';
export const STAND_IN_SOMEONE = 'Someone';
export const shownAuthor = (author) => {
  if (author === STAND_IN_AUTHOR) return t`You`;
  if (author === STAND_IN_SOMEONE) return t`Someone`;
  return author;
};
