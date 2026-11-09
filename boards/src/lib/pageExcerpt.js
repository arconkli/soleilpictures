// A doc page can run to thousands of words, so a hit quotes the stretch around
// the first match (the page's opening when the match was in its title), with
// an ellipsis wherever it was cut.
import { findFolded } from './textFold.js';

export const PAGE_EXCERPT_MAX = 300;
export function pageExcerpt(text, q) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= PAGE_EXCERPT_MAX) return s;
  const hit = findFolded(s, q);
  const at = hit ? hit.start : 0;
  const start = Math.max(0, at - 80);
  const end = Math.min(s.length, start + PAGE_EXCERPT_MAX);
  return `${start ? '…' : ''}${s.slice(start, end)}${end < s.length ? '…' : ''}`;
}
