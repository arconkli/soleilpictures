// A doc's pages in the page list's order, and the text on each, read straight
// off its Y types: what the doc look's side panel reads (its Comments quote
// the words a thread is on, its Find searches every page), for every page and
// not only the one open in the editor. Pure (yjs), so it tests under node with
// real Y.Docs.
//
// A page's text is its textblocks (a paragraph, a heading, a code block, a
// screenplay line), in order, each read the way the editor's own find reads
// one (DocFindReplace.jsx findMatches): its text, with anything inline that
// isn't text (a mention, a hard break, an inline image) as one NUL, so a
// match can never run across it. The editor's document is the same tree
// (y-prosemirror builds one from the other), so the k-th match in a page's
// blocks here is the k-th the editor finds in that page.

import * as Y from 'yjs';
import { readPages, buildPageTree, pageContentMap, pageSheetsMap, sheetContentMap } from './docState.js';

// The pages as the page list shows them, top to bottom: [{ id, name, trail }],
// where `trail` is the names of the pages it sits under, outermost first.
export function docPageOrder(ydoc, scope) {
  const out = [];
  const walk = (nodes, trail) => {
    for (const n of nodes) {
      const name = String(n.name || '');
      out.push({ id: n.id, name, trail });
      walk(n.children || [], [...trail, name]);
    }
  };
  walk(buildPageTree(readPages(ydoc, scope)), []);
  return out;
}

const sheetIdOf = (s) => (s && typeof s.get === 'function' ? s.get('id') : s?.id) || null;

// A page's text lives in its own fragment, then in each extra sheet's (an
// older layout: DocSurface opens them one under the other), in order:
// [{ sheetId, frag }], the page's own with the page's id.
export function pageFragments(ydoc, pageId, scope) {
  const out = [];
  if (!pageId) return out;
  const own = pageContentMap(ydoc, scope)?.get?.(pageId);
  if (own instanceof Y.XmlFragment) out.push({ sheetId: pageId, frag: own });
  const list = pageSheetsMap(ydoc, scope)?.get?.(pageId);
  const content = sheetContentMap(ydoc, scope);
  for (const s of (list && typeof list.toArray === 'function' ? list.toArray() : [])) {
    const sid = sheetIdOf(s);
    if (!sid || sid === pageId) continue;
    const frag = content?.get?.(sid);
    if (frag instanceof Y.XmlFragment) out.push({ sheetId: sid, frag });
  }
  return out;
}

// The textblocks under `node`, in document order: [{ text, parts }]. Each
// part is one Y.XmlText of the block: { ytext, start, len, ops }, where
// `start` is where its text begins in the block's and its index i is at the
// block's start + i; `ops` are its runs as the delta has them,
// { text, attributes, start } (text null for an embed, which reads as NUL).
// A block is an element holding text; one holding only elements is a
// container (a list, a quote, a table) and its blocks are read in turn.
export function textblocksOf(node) {
  const out = [];
  const walk = (n) => {
    const kids = n.toArray();
    if (kids.some((k) => k instanceof Y.XmlText)) { out.push(readBlock(kids)); return; }
    for (const k of kids) if (k instanceof Y.XmlElement) walk(k);
  };
  if (node instanceof Y.XmlFragment) walk(node);
  return out;
}

function readBlock(kids) {
  let text = '';
  const parts = [];
  for (const k of kids) {
    if (!(k instanceof Y.XmlText)) { text += '\u0000'; continue; }
    const part = { ytext: k, start: text.length, len: 0, ops: [] };
    for (const op of k.toDelta()) {
      const s = typeof op.insert === 'string' ? op.insert : null;
      part.ops.push({ text: s, attributes: op.attributes || null, start: text.length });
      text += s ?? '\u0000';
    }
    part.len = text.length - part.start;
    parts.push(part);
  }
  return { text, parts };
}
