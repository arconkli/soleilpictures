// A note's text has two possible homes. `card.html` is the rich form every
// editor writes. `card.body` is PLAIN TEXT, written by the producers that have
// no html to give: a run of text dropped on the canvas (dragMimes), and notes
// made through /api/v1 or MCP with a `body`. Every app edit writes html and
// clears body (`body: null`), so a note carries body text only until its first
// edit.
//
// The display and the editor must agree on which one is the note's text. The
// editor used to seed from html alone, so opening a body-only note seeded an
// empty fragment and the first write-through saved that emptiness over the
// body (NOTES-01). Both now go through noteSourceHtml.
//
// Kept free of Tiptap/Yjs so the canvas chunk can import it.

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

// True when a string has visible text once tags are dropped. Entities count
// (`&nbsp;` alone does not); an html that is only `<p></p>` has none.
export function htmlHasText(html) {
  if (!html) return false;
  return String(html)
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ')
    .trim().length > 0;
}

export function bodyHasText(body) {
  return body != null && String(body).trim().length > 0;
}

// Plain body text → note html: one paragraph per line, escaped, so what the
// editor opens with is what the display showed (the display is pre-wrap, and a
// paragraph per line is exactly what pressing Enter produces in the editor).
export function noteBodyToHtml(body) {
  if (!bodyHasText(body)) return '';
  return String(body)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => (line ? `<p>${escapeHtml(line)}</p>` : '<p></p>'))
    .join('');
}

// The html a note's text should be read from. html wins whenever it has text;
// body is the fallback only when html has none, which also covers an html of
// `<p></p>` next to a body (an older client's blank write over a body note).
// An html with no TEXT but real content (a lone image) still wins when there is
// no body to prefer.
export function noteSourceHtml(html, body) {
  if (htmlHasText(html) || !bodyHasText(body)) return html || '';
  return noteBodyToHtml(body);
}
