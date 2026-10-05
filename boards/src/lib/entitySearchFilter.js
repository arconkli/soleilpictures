// The PostgREST `or` filter behind ⌘K and list view's workspace search.
//
// Pure, so it tests under node (entitySearch.js imports the Supabase client).
//
// Three columns, not two: an image's or a video's own file name lives in
// card_index.meta.fileName (cardIndexRow.js says why it is never the title),
// so a search for diner_ext_dusk_04 has to look there to find the photo.
//
// The query is cleaned of the characters that are SYNTAX in a PostgREST logic
// tree — `,` separates conditions, `(` `)` group them, `"` quotes a value, and
// `%` is ours to place — so a typed "Act II (rev)" searches for the words
// rather than failing the request and showing nothing.
export function cleanSearchTerm(query) {
  return String(query || '').replace(/[%,()"]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function entitySearchFilter(query) {
  const safe = cleanSearchTerm(query);
  if (!safe) return null;
  return `title.ilike.%${safe}%,body.ilike.%${safe}%,meta->>fileName.ilike.%${safe}%`;
}

// The words INSIDE documents: doc_page_index, one row per page (docText).
export function docPageSearchFilter(query) {
  const safe = cleanSearchTerm(query);
  if (!safe) return null;
  return `page_text.ilike.%${safe}%,page_title.ilike.%${safe}%`;
}

// Ranking: exact, prefix, contains — on the title, or the file name for a
// card that has no title (most photos).
export function entitySearchRank(row, lowerQuery) {
  const t = String(row?.title || row?.meta?.fileName || '').toLowerCase();
  if (t === lowerQuery) return 0;
  if (t.startsWith(lowerQuery)) return 1;
  if (t.includes(lowerQuery)) return 2;
  return 3;
}
