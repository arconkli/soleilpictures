// Where a note's editing starts. The gesture that opens a note (a mouse
// double-click, a finger or pen double-tap, and, from plan step 4, a tap on a
// note that is already selected) records its client point; the editor, which
// mounts a beat later in exactly the same place, maps that point to a document
// position and puts the caret there. No point (a new note, typed-ahead text):
// the end, as before.
//
//   entry = { x, y, mode: 'caret', scrollTop? }
//   A mouse double-click, a finger or a pen all put a caret at the point.
//   Inside a word the caret snaps to the word's nearer edge, as a tap does on
//   iOS, so typing straight after opening never lands mid-word and never
//   replaces a word. A point outside the text box is pulled to the nearest line.
//
// x/y are CLIENT coordinates. ProseMirror's posAtCoords takes client
// coordinates and resolves them with caretPositionFromPoint / elementFromPoint
// and client rects, which already carry the canvas's transform: scale(zoom),
// so nothing here corrects for zoom.

export function noteEntryFromEvent(e, pointerType = e?.pointerType) {
  const x = e?.clientX;
  const y = e?.clientY;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  // pointerType no longer changes the mode: every pointer gets a caret.
  const mode = 'caret';
  return { x, y, mode };
}

const WORD_CHAR = /[\p{L}\p{N}\p{M}_]/u;

// [start, end) of the word at `offset` in `text`, or null when the offset sits
// on spaces or punctuation. A word touching the offset on either side counts,
// so a point on the right half of a word's last letter still picks the word.
export function wordAt(text, offset) {
  if (!text || !(offset >= 0) || offset > text.length) return null;
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    let before = null;
    for (const s of new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text)) {
      const a = s.index;
      const b = a + s.segment.length;
      if (a > offset) break;
      if (!s.isWordLike) continue;
      if (offset < b) return [a, b];
      if (b === offset) before = [a, b];
    }
    return before;
  }
  let a = offset;
  let b = offset;
  while (a > 0 && WORD_CHAR.test(text[a - 1])) a--;
  while (b < text.length && WORD_CHAR.test(text[b])) b++;
  return a < b ? [a, b] : null;
}

// { from, to } document positions for `entry` in a mounted ProseMirror view,
// or null when the point maps to nothing (the caller falls back to the end).
// Always a caret, except that a point inside a word snaps to the word's nearer
// edge. A point outside the editor box (the empty band of a centred note, the
// space under a short note's text) is pulled to the nearest edge, so it lands
// on the nearest line, with no snapping.
export function noteEntryRange(view, entry) {
  if (!view || !entry || !Number.isFinite(entry.x) || !Number.isFinite(entry.y)) return null;
  const dom = view.dom;
  if (!dom || !dom.isConnected) return null;
  const r = dom.getBoundingClientRect();
  if (!(r.width > 2 && r.height > 2)) return null;
  const inside = entry.x >= r.left && entry.x <= r.right && entry.y >= r.top && entry.y <= r.bottom;
  const left = Math.min(Math.max(entry.x, r.left + 1), r.right - 1);
  const top = Math.min(Math.max(entry.y, r.top + 1), r.bottom - 1);
  let hit = null;
  try { hit = view.posAtCoords({ left, top }); } catch (_) { hit = null; }
  if (!hit) return null;
  const pos = hit.pos;
  const caret = { from: pos, to: pos };
  if (!inside) return caret;
  // A point inside a word snaps to its nearer edge, as a tap does on iOS:
  // typing straight after opening lands between words, never mid-word.
  let $pos;
  try { $pos = view.state.doc.resolve(pos); } catch (_) { return caret; }
  const parent = $pos.parent;
  if (!parent.isTextblock) return caret;
  // One character per position: text is itself, every inline leaf (a
  // mention, a hard break) is one U+FFFC, so string offsets are parentOffsets.
  const text = parent.textBetween(0, parent.content.size, '\n', '￼');
  const off = $pos.parentOffset;
  const w = wordAt(text, off);
  if (!w || off <= w[0] || off >= w[1]) return caret;
  const edge = off - w[0] < w[1] - off ? w[0] : w[1];
  const at = $pos.start() + edge;
  return { from: at, to: at };
}
