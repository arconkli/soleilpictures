// Decorations that each belong to one textblock, kept up to date by redoing
// only the textblocks an edit touched. The underline plugins (AutoDetectPlugin,
// CandidateNamePlugin) used to re-run the name trie over every text node of
// the doc on every keystroke — a few milliseconds each in a long doc, per key.
//
// What changed is found by comparing the two docs, not by reading the
// transaction's steps: ProseMirror keeps every node an edit didn't touch the
// same object, so the comparison is one identity check per untouched block.
// The steps would mislead twice over — y-prosemirror applies a collaborator's
// edit as a replace of the whole document, which maps every decoration away,
// and a mark or attribute step moves no positions at all.

import { Mapping, StepMap } from '@tiptap/pm/transform';
import { DecorationSet } from '@tiptap/pm/view';

// Where `next` differs from `prev`: the range in `next` (from, to), where it
// ends in `prev` (toA), and a mapping that moves `prev`'s positions outside it
// to theirs in `next`. Null when the two docs are equal.
export function changedRange(prev, next) {
  const start = prev.content.findDiffStart(next.content);
  if (start == null) return null;
  let { a: endA, b: endB } = prev.content.findDiffEnd(next.content);
  // A run of the same character lets the two ends cross ("aa" → "aaa"); pin
  // the change to one side of the run, as ProseMirror's own DOM reader does.
  if (endA < start && prev.content.size < next.content.size) {
    endB = start + (endB - endA);
    endA = start;
  } else if (endB < start) {
    endA = start + (endA - endB);
    endB = start;
  }
  return { from: start, to: endB, toA: endA, mapping: new Mapping([new StepMap([start, endA - start, endB - start])]) };
}

// Every textblock of `doc` touching [from, to], with the span they cover.
export function textblocksIn(doc, from, to) {
  const blocks = [];
  let lo = Infinity;
  let hi = -Infinity;
  doc.nodesBetween(Math.max(0, from - 1), Math.min(doc.content.size, to + 1), (node, pos) => {
    if (!node.isTextblock) return true;
    blocks.push({ node, pos });
    lo = Math.min(lo, pos);
    hi = Math.max(hi, pos + node.nodeSize);
    return false;
  });
  return { blocks, from: lo, to: hi };
}

// The decorations of a whole doc: `decorate(node, pos)` for each textblock.
export function decorateAll(doc, decorate) {
  const decos = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    for (const d of decorate(node, pos)) decos.push(d);
    return false;
  });
  return decos.length ? DecorationSet.create(doc, decos) : DecorationSet.empty;
}

// `set`, drawn for the doc before an edit, redrawn for `doc` after it: what
// the edit didn't touch moves with the text, and the touched textblocks
// (`touched`, from textblocksIn) are decorated afresh.
export function redecorate(set, mapping, doc, touched, decorate) {
  let out = set.map(mapping, doc);
  if (!touched.blocks.length) return out;
  // Everything over the touched span goes, not only what sits inside one of
  // its textblocks: an underline mapped across a split now straddles the two
  // halves ("Lov|elace").
  const stale = out.find(touched.from, touched.to).filter((d) => d.from < touched.to && d.to > touched.from);
  const fresh = [];
  for (const { node, pos } of touched.blocks) {
    for (const d of decorate(node, pos)) fresh.push(d);
  }
  if (stale.length) out = out.remove(stale);
  if (fresh.length) out = out.add(doc, fresh);
  return out;
}

// Whether ranges outside the touched span are the old ones moved by `mapping`
// (the applied tag ranges, which suppress underlines under them): if one
// outside appeared, vanished or moved on its own, the textblocks it covers
// need redrawing too, so the caller redraws everything instead.
export function sameRangesOutside(prevRanges, nextRanges, mapping, touched) {
  const outside = (r) => r.to <= touched.from || r.from >= touched.to;
  const key = (r) => `${r.from}:${r.to}`;
  const moved = (prevRanges || [])
    .map((r) => ({ from: mapping.map(r.from, 1), to: mapping.map(r.to, -1) }))
    .filter(outside).map(key).sort();
  const now = (nextRanges || []).filter(outside).map(key).sort();
  return moved.length === now.length && moved.every((k, i) => k === now[i]);
}
