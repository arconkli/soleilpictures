// What the doc look's side panel's Find searches with (the owner's pick of
// 2026-10-21, mockup dx AC-find): the words as typed, in any case or only as
// typed (Aa), anywhere or as whole words, on every page of the doc or the
// one open; each hit with the words around it; and Replace all on the pages
// that aren't open, in place in their Y types. Pure (yjs), so it tests under
// node with real Y.Docs.
//
// A page's text is read block by block as the editor's own find reads it
// (lib/docBlocks.js): anything inline that isn't text is one NUL, which no
// search holds, so no hit runs across it. The k-th hit on a page here is the
// k-th the open page's editor finds (matchesInPM), which is how a hit picked
// on a page that isn't open is found once that page opens.

import { docPageOrder, pageFragments, textblocksOf } from './docBlocks.js';

const WORD_CHAR = /^[\p{L}\p{N}_]$/u;

// The search, or null when there's nothing to search for. Every character of
// it is itself (nothing in it is a pattern).
function compile(query, matchCase) {
  const q = String(query ?? '').replace(/\u0000/g, '');
  if (!q) return null;
  return new RegExp(q.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'), matchCase ? 'gu' : 'giu');
}

const charBefore = (text, i) => {
  if (i <= 0) return '';
  const c = text.charCodeAt(i - 1);
  return c >= 0xdc00 && c <= 0xdfff && i >= 2 ? text.slice(i - 2, i) : text[i - 1];
};
const charAt = (text, i) => (i < text.length ? String.fromCodePoint(text.codePointAt(i)) : '');
const isWord = (ch) => !!ch && WORD_CHAR.test(ch);

function scan(text, re, wholeWord) {
  const out = [];
  if (!re || !text) return out;
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text))) {
    const a = m.index;
    const b = a + m[0].length;
    // A hit inside a longer word, under Whole word, isn't one; look again a
    // character on (a whole word may start inside what it covered).
    if (b === a || (wholeWord && (isWord(charBefore(text, a)) || isWord(charAt(text, b))))) {
      re.lastIndex = a + (text.codePointAt(a) > 0xffff ? 2 : 1);
      continue;
    }
    out.push([a, b]);
  }
  return out;
}

// [[start, end], …] in `text`, left to right, none overlapping. Whole word:
// neither side of a hit is a letter, a digit or _, in any alphabet.
export function matchesIn(text, query, { matchCase = false, wholeWord = false } = {}) {
  return scan(text, compile(query, matchCase), wholeWord);
}

// The words around a hit, for its row in the list: up to `before` and
// `after` characters each side, cut at a word, with … where it's cut.
export function snippetOf(text, start, end, { before = 32, after = 56 } = {}) {
  const tidy = (s) => s.replace(/\u0000/g, ' ').replace(/\s+/g, ' ');
  const from = start - before;
  let b = text.slice(Math.max(0, from), start);
  if (from > 0) {
    if (!/\s/.test(text[from - 1]) && !/^\s/.test(b)) b = b.replace(/^\S*/, '');
    b = `…${b.trimStart()}`;
  }
  const to = end + after;
  let a = text.slice(end, to);
  if (to < text.length) {
    if (!/\s/.test(text[to]) && !/\s$/.test(a)) a = a.replace(/\S*$/, '');
    a = `${a.trimEnd()}…`;
  }
  return { before: tidy(b), match: tidy(text.slice(start, end)), after: tidy(a) };
}

// Where a hit lies in the Y types: the pieces of text it covers (one, or
// more where a block's text is in pieces side by side), and the marks of its
// first character, which a replacement takes.
function segmentsOf(parts, start, end) {
  const segs = [];
  for (const p of parts) {
    const a = Math.max(start, p.start);
    const b = Math.min(end, p.start + p.len);
    if (b > a) segs.push({ ytext: p.ytext, index: a - p.start, len: b - a });
  }
  return segs;
}
function attrsAt(parts, at) {
  for (const p of parts) {
    for (const op of p.ops) {
      const len = op.text == null ? 1 : op.text.length;
      if (at >= op.start && at < op.start + len) return op.attributes || {};
    }
  }
  return {};
}

function hitsOn(ydoc, scope, pageId, re, wholeWord) {
  const out = [];
  if (!re) return out;
  let k = 0;
  for (const { sheetId, frag } of pageFragments(ydoc, pageId, scope)) {
    for (const { text, parts } of textblocksOf(frag)) {
      for (const [start, end] of scan(text, re, wholeWord)) {
        out.push({
          pageId, sheetId, k: k++, start, end,
          snippet: snippetOf(text, start, end),
          segs: segmentsOf(parts, start, end),
          attrs: attrsAt(parts, start),
        });
      }
    }
  }
  return out;
}

// One page's hits, in order: [{ pageId, sheetId, k, start, end, snippet,
// segs, attrs }], `k` counting the page's hits from 0.
export function pageHits(ydoc, scope, pageId, query, { matchCase = false, wholeWord = false } = {}) {
  return hitsOn(ydoc, scope, pageId, compile(query, matchCase), wholeWord);
}

// The pages with hits, in the page list's order, each { id, name, trail,
// hits }; `pageIds` keeps to those pages.
export function docHits(ydoc, scope, query, { matchCase = false, wholeWord = false } = {}, { pageIds = null } = {}) {
  const re = compile(query, matchCase);
  if (!re) return [];
  const want = pageIds ? new Set(pageIds) : null;
  return docPageOrder(ydoc, scope)
    .filter((p) => !want || want.has(p.id))
    .map((p) => ({ ...p, hits: hitsOn(ydoc, scope, p.id, re, wholeWord) }))
    .filter((p) => p.hits.length);
}

// Every hit on `pageIds` replaced by `replacement` (nothing deletes them), in
// place, each in its first character's marks, as one transaction with
// `origin` (so one undo step where that origin is tracked). Searched as it is
// now, so nothing that changed since a list was shown is missed or hit twice.
// Returns { n, pages }: how many it replaced, on how many pages.
export function replaceInPages(ydoc, scope, pageIds, query, { matchCase = false, wholeWord = false } = {}, replacement = '', origin = null) {
  const re = compile(query, matchCase);
  let n = 0;
  let pages = 0;
  if (!re || !ydoc) return { n, pages };
  ydoc.transact(() => {
    for (const id of pageIds) {
      const hits = hitsOn(ydoc, scope, id, re, wholeWord);
      if (!hits.length) continue;
      pages += 1;
      n += hits.length;
      // From the last, so the places of those before it hold.
      for (const h of [...hits].reverse()) {
        for (const s of [...h.segs].reverse()) s.ytext.delete(s.index, s.len);
        if (replacement) h.segs[0].ytext.insert(h.segs[0].index, replacement, { ...h.attrs });
      }
    }
  }, origin);
  return { n, pages };
}

// The same search in an editor's document: [[from, to], …] in its positions,
// block by block in the document's order.
export function matchesInPM(doc, query, { matchCase = false, wholeWord = false } = {}) {
  const re = compile(query, matchCase);
  const out = [];
  if (!re || !doc) return out;
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = '';
    node.content.forEach((child) => { text += child.isText ? child.text : '\u0000'.repeat(child.nodeSize); });
    for (const [a, b] of scan(text, re, wholeWord)) out.push([pos + 1 + a, pos + 1 + b]);
    return false;
  });
  return out;
}
