// Cut text to a pixel width with an ellipsis, on grapheme boundaries, so a
// family emoji or an accented letter isn't split. `measure(text)` returns the
// text's width; the canvas caller passes ctx.measureText(t).width.
//
// Pure, no imports beyond graphemes.js: no DOM or canvas.
import { graphemes } from './graphemes.js';

export function truncateToWidth(measure, text, maxWidth) {
  if (!text) return '';
  if (measure(text) <= maxWidth) return text;
  const gs = graphemes(text);
  let lo = 0, hi = gs.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(gs.slice(0, mid).join('') + '…') <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? gs.slice(0, lo).join('') + '…' : '…';
}
