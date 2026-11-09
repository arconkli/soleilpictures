// The PostgREST `or` filter behind ⌘K and list view's workspace search.
//
// Pure, so it tests under node (entitySearch.js imports the Supabase client).
//
// Four columns: an image's or a video's own file name lives in
// card_index.meta.fileName (cardIndexRow.js says why it is never the title),
// so a search for diner_ext_dusk_04 has to look there to find the photo; and
// `seen` is what is in a described picture (0595: its description, keywords
// and labels), so "red car" or "night exterior" finds it too.
//
// `fold` (0879) is the same text with accents, Hebrew points and Arabic
// harakat dropped and ß æ ł … spelled plainly (lib/textFold.js), NULL where
// folding changes nothing. The query is folded the same way and ORed in,
// ALWAYS (not only when it differs from what was typed): "cafe" has to find a
// card that says "Café", and the raw terms stay because fold is NULL for the
// rows the fold leaves alone, so nothing that matches today stops matching.
// A database that has not run 0879 answers 42703 (no such column); callers
// retry once with `{ fold: false }` (isMissingColumn).
//
// The query is cleaned of the characters that are SYNTAX in a PostgREST logic
// tree — `,` separates conditions, `(` `)` group them, `"` quotes a value, and
// `%` is ours to place — so a typed "Act II (rev)" searches for the words
// rather than failing the request and showing nothing.
import { searchKey, cleanSearchTerm, foldedSearchTerm } from './textFold.js';

export { cleanSearchTerm };

// foldedSearchTerm (textFold.js) cleans again after the fold; see there why.
const foldedTerm = foldedSearchTerm;

// Folding works both ways: when the folded query differs from what was typed
// ("café" -> "cafe"), the raw columns are also matched against the folded one,
// because `fold` is NULL on a row the fold leaves alone, so a typed "café"
// would never find a stored "cafe". Those terms need no `fold` column, so they
// stay when a database has not run 0879.
function withFoldTerms(cols, safe, fold) {
  const raw = cols.map((c) => `${c}.ilike.%${safe}%`);
  const f = foldedTerm(safe);
  if (!f) return raw.join(',');
  if (f !== safe) raw.push(...cols.map((c) => `${c}.ilike.%${f}%`));
  if (fold) raw.push(`fold.ilike.%${f}%`);
  return raw.join(',');
}

export function entitySearchFilter(query, { fold = true } = {}) {
  const safe = cleanSearchTerm(query);
  if (!safe) return null;
  return withFoldTerms(['title', 'body', 'meta->>fileName', 'seen'], safe, fold);
}

// PostgREST 42703: the column does not exist, i.e. the app shipped before 0879.
// Reads a supabase-js error ({ code }) and the Worker's userSelect error, which
// keeps the upstream body in `detail`.
export function isMissingColumn(err) {
  return !!err && (err.code === '42703' || /"code"\s*:\s*"42703"/.test(String(err.detail || '')));
}

// A picture found only by what is in it: none of the words a person can see
// on it (its title, its text, its file name) holds the query, so the match was
// `seen`. ⌘K says "In the picture" there, never the AI's words (owner,
// 2026-10-28: the descriptions are for finding, not for reading).
export function foundOnlyInPicture(row, query) {
  if (row?.kind !== 'image') return false;
  const q = searchKey(cleanSearchTerm(query));
  if (!q) return false;
  return ![row.title, row.body, row.meta?.fileName].some((v) => searchKey(v).includes(q));
}

// The words INSIDE documents: doc_page_index, one row per page (docText).
export function docPageSearchFilter(query, { fold = true } = {}) {
  const safe = cleanSearchTerm(query);
  if (!safe) return null;
  return withFoldTerms(['page_text', 'page_title'], safe, fold);
}

// Ranking: exact, prefix, contains — on the title, or the file name for a
// card that has no title (most photos).
export function entitySearchRank(row, lowerQuery) {
  const t = searchKey(row?.title || row?.meta?.fileName || '');
  if (t === lowerQuery) return 0;
  if (t.startsWith(lowerQuery)) return 1;
  if (t.includes(lowerQuery)) return 2;
  return 3;
}
