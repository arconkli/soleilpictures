// "Is this name one the app wrote for the person?" in every language. A new
// doc, page or cluster is written with a name from the person's language
// (t({ message: 'Untitled doc', context: 'default name' })), and code that
// compares it asks here instead of testing the English.
//
// Plain data, no macros and no app imports, so the Worker can import it. The
// table is generated from the catalogs (scripts/i18nDefaultNames.mjs).
import DEFAULT_NAMES from './defaultNames.data.js';

const fold = (s) => String(s ?? '').trim().toLowerCase();

// `english` is the default's English name ('Untitled doc'), or an array of
// them. True when `name`, trimmed and ignoring case, is that English or any
// translation of it. `table` is for tests.
export function isDefaultName(english, name, table = DEFAULT_NAMES) {
  const folded = fold(name);
  if (!folded) return false;
  return [].concat(english).some((key) => (table[key] || [key]).some((n) => fold(n) === folded));
}
