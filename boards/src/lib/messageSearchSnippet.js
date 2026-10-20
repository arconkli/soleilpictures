// What a search result shows of its message: the words around the first
// match, with every match marked. Case-insensitive, like the search itself
// (ilike), and clipped at word boundaries with an ellipsis either side.
//   → [{ text, match }]
export function snippetParts(body, query, { radius = 60 } = {}) {
  const text = String(body || '').replace(/\s+/g, ' ').trim();
  if (!text) return [];
  const q = String(query || '').replace(/\s+/g, ' ').trim();
  const lower = text.toLowerCase();
  const ql = q.toLowerCase();
  const first = ql ? lower.indexOf(ql) : -1;
  const anchor = first === -1 ? 0 : first;
  const len = first === -1 ? 0 : q.length;

  let start = Math.max(0, anchor - radius);
  if (start > 0) {
    const sp = text.indexOf(' ', start);
    if (sp !== -1 && sp < anchor) start = sp + 1;
  }
  let end = Math.min(text.length, anchor + len + Math.round(radius * 1.5));
  if (end < text.length) {
    const sp = text.lastIndexOf(' ', end);
    if (sp > anchor + len) end = sp;
  }

  const parts = [];
  if (start > 0) parts.push({ text: '…', match: false });
  const slice = text.slice(start, end);
  if (!ql) {
    parts.push({ text: slice, match: false });
  } else {
    const sl = slice.toLowerCase();
    let at = 0;
    for (let i = sl.indexOf(ql); i !== -1; i = sl.indexOf(ql, i + ql.length)) {
      if (i > at) parts.push({ text: slice.slice(at, i), match: false });
      parts.push({ text: slice.slice(i, i + ql.length), match: true });
      at = i + ql.length;
    }
    if (at < slice.length) parts.push({ text: slice.slice(at), match: false });
  }
  if (end < text.length) parts.push({ text: '…', match: false });
  return parts;
}
