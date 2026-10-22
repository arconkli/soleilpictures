// Where each comment thread of a doc sits: the words it is on, the page they
// are on, and its place in the doc, read off the comment marks in the text
// (components/docExtensions/CommentMark.js: the mark is the anchor). The doc
// look's side panel lists the threads in the doc's order with those words
// quoted, for every page, open in the editor or not.

import { docPageOrder, pageFragments, textblocksOf } from './docBlocks.js';

// y-prosemirror files a mark as a text attribute named after it, and a mark
// that can overlap itself, as a comment can, under its name plus a hash of
// its attributes (sync-plugin.js marksToAttributes).
const COMMENT_ATTR = /^comment(--[a-zA-Z0-9+/=]{8})?$/;

// Map of thread id → { pageId, order, quote }. `order` counts up through the
// doc; `quote` is the marked words, cut at `max` characters: a run that goes
// on into the next block reads on after a space, and words left out between
// two runs show as " … ". A thread whose words are gone (deleted, or its mark
// taken off) isn't in it.
export function commentAnchors(ydoc, scope, { max = 280 } = {}) {
  const out = new Map();
  const ends = new Map();
  let block = 0;
  let order = 0;
  for (const page of docPageOrder(ydoc, scope)) {
    for (const { frag } of pageFragments(ydoc, page.id, scope)) {
      for (const { text, parts } of textblocksOf(frag)) {
        block += 1;
        for (const part of parts) {
          for (const op of part.ops) {
            if (op.text == null || !op.attributes) continue;
            for (const [key, value] of Object.entries(op.attributes)) {
              const id = value && typeof value === 'object' ? value.id : null;
              if (!COMMENT_ATTR.test(key) || typeof id !== 'string' || !id) continue;
              let a = out.get(id);
              if (!a) {
                a = { pageId: page.id, order: order++, quote: '' };
                out.set(id, a);
              }
              const end = ends.get(id);
              const gap = !a.quote ? ''
                : end.block === block && end.at === op.start ? ''
                  : end.block === block - 1 && end.whole && op.start === 0 ? ' ' : ' … ';
              if (a.quote.length <= max) a.quote += gap + op.text;
              const at = op.start + op.text.length;
              ends.set(id, { block, at, whole: at === text.length });
            }
          }
        }
      }
    }
  }
  for (const a of out.values()) {
    const q = a.quote.replace(/\s+/g, ' ').trim();
    a.quote = q.length > max ? `${q.slice(0, max).replace(/\s+\S*$/, '')}…` : q;
  }
  return out;
}
