// TipTap extension: dir="auto" on the elements lib/textDirection.js picks, drawn
// as ProseMirror node decorations. View-only on purpose: nothing lands in
// getHTML(), Yjs, the schema or stored html, so every collaborator's older app
// reads the same document it always did. (TipTap 3's textDirection and the
// tiptap-text-direction package store dir in the document; this does not.)
//
// OWNERS. An owner is an element wantsDirAuto() picks: a list item, a task
// item, a blockquote, and a paragraph or heading that is not inside one of
// those. An owner's direction is its first strong letter in its OWN text,
// skipping descendant owners, the way the browser's dir="auto" skips a
// descendant that carries a dir of its own.
//
// DESIRED. What each owner should read as: its own strong letter if it has one;
// else the own strong letter of its first descendant owner that has one (a quote
// holding only an Arabic list is right to left); else that of the nearest EARLIER
// owner in document order that has one (an empty line after Arabic starts at the
// right: Enter after an Arabic line puts the caret, or a new item's marker, at
// the right edge); else ltr. The first letter typed into an empty owner decides.
//
// ONLY OWNERS THAT DIFFER. An owner's INHERITED direction is the desired direction
// of its nearest ancestor owner, or ltr at the top level (the editor itself is
// left to right). An owner is decorated only when desired differs from inherited:
// dir="auto" when it has a strong letter of its own, else the explicit desired
// rtl or ltr. This is safe against the browser's rules: an explicit dir wins; an
// element without dir takes its parent's direction; dir="auto" reads the first
// strong letter of the element's text, skipping descendants that carry a dir but
// reading those that do not. An undecorated descendant's desired direction equals
// its parent's (that is what undecorated means), so any strong letter the browser
// finds in it agrees with the letter it would have read anyway. By induction from
// the top level every owner resolves to its desired direction, and English text
// inside English text, or Arabic inside Arabic, carries nothing.
//
// CHIPS. A chip must not decide its line's direction. Every inline atom that shows
// text (the note mention chip) carries a view-only dir="auto": a descendant with
// a dir is skipped by its owner's dir="auto", and dir="auto" also isolates the
// chip, so its own name reads right. Block atoms with a node view (the board
// embed) set their own dir there. On the English fast path (below) nothing is
// drawn, and no owner has dir="auto" there, so a chip cannot flip a line.
//
// WHEN. A document with no right-to-left text anywhere carries nothing: an empty
// set, so English costs nothing. Once one owner reads right to left, the owners
// that differ from what they inherit are decorated, once each.
//
// COST. DecorationSet.create is quadratic in the number of top-level node
// decorations (prosemirror-view's buildTree scans every span for each child, and
// NodeType.valid walks the children). A mostly English document with some Arabic
// decorates only the Arabic top-level blocks. An all-Arabic document still
// decorates every top-level owner, so it keeps that cost. Per keystroke in the
// middle of a document of 1000 / 2000 / 5000 paragraphs: English 0.07 / 0.07 /
// 0.12 ms, one third Arabic 1.6 / 6.4 / 42 ms (4.7 / 19.5 / 118 before only
// differing owners were decorated), all Arabic 4.7 / 19 / 117 ms.
//
// NO MAPPING. The set is rebuilt from the document on every change, never patched
// with DecorationSet.map, remove or add. map validates a set against the new doc
// with a check that is quadratic in the top-level node decorations, it can throw
// on a multi-step transaction, and remove can leave stale duplicates; a patch also
// misses blocks a ReplaceAroundStep moves. A rebuild is cheap because each
// top-level block's owners are summarised once and cached by node object
// (ProseMirror nodes are immutable, so an unchanged block is the same object in
// the next doc). A summary depends on nothing outside its block, descendant rule
// included; the cross-block rule (the earlier owner) is applied afterwards over
// the summaries.

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { ownsDirection, strongDirection, wantsDirAuto } from './textDirection.js';

// The text an inline atom draws: its spec's leafText if it has one, else a string
// `label` attribute (NoteMention renders its label as the chip's text).
function inlineAtomText(node) {
  const leaf = node.type.spec.leafText;
  if (leaf) return leaf(node);
  return typeof node.attrs.label === 'string' ? node.attrs.label : '';
}

// 'rtl' | 'ltr' | null: the first strong letter in the owner's own text,
// descendant owners skipped. A chip (an inline atom) never decides its line's
// direction: "@Marcus Webb مرحبا" is an Arabic sentence and "@דני hello there" an
// English one. The view draws dir="auto" on every chip that shows text (see
// atomsOf), so the browser's dir="auto" on the owner skips it too, and the model
// and the browser agree. Block atoms (a board embed) are skipped here and carry a
// dir of their own in their node view.
function ownText(node) {
  if (node.isText) return strongDirection(node.text);
  if (node.isLeaf) return null;
  for (let i = 0; i < node.childCount; i += 1) {
    const c = node.child(i);
    if (!c.isText && ownsDirection(c.type.name)) continue;
    const d = ownText(c);
    if (d) return d;
  }
  return null;
}

// Every owner inside `node` (itself included), in document order, as
// { rel, size, strong, parent, below }: `rel` is the offset from the start of the
// top-level block, `parent` the index (in `out`) of the nearest ancestor owner or
// -1, `below` the ownStrong of the first descendant owner that has one.
function collectOwners(node, rel, inside, parent, out, atoms) {
  let here = parent;
  if (wantsDirAuto(node.type.name, inside)) {
    here = out.length;
    out.push({ rel, size: node.nodeSize, strong: ownText(node), parent, below: null });
  }
  if (node.isTextblock) {
    // Text blocks hold only inline content: nothing below them can be an owner,
    // but a chip in them gets a dir of its own (below).
    let at = rel + 1;
    for (let i = 0; i < node.childCount; i += 1) {
      const c = node.child(i);
      if (!c.isText && c.isLeaf && c.isInline && inlineAtomText(c) !== '') atoms.push({ rel: at, size: c.nodeSize });
      at += c.nodeSize;
    }
    return;
  }
  if (node.isLeaf) return;
  const inner = inside || ownsDirection(node.type.name);
  let pos = rel + 1;
  for (let i = 0; i < node.childCount; i += 1) {
    const c = node.child(i);
    collectOwners(c, pos, inner, here, out, atoms);
    pos += c.nodeSize;
  }
}

// Fill `below`: owners nest, so the descendants of owner i are the ones right after
// it that start before it ends.
function fillBelow(owners) {
  for (let i = 0; i < owners.length; i += 1) {
    const o = owners[i];
    const end = o.rel + o.size;
    for (let j = i + 1; j < owners.length && owners[j].rel < end; j += 1) {
      if (owners[j].strong) { o.below = owners[j].strong; break; }
    }
  }
}

const summaries = new WeakMap();

function summaryOf(block, cache) {
  if (cache) {
    const hit = summaries.get(block);
    if (hit) return hit;
  }
  const owners = [];
  const atoms = [];
  collectOwners(block, 0, false, -1, owners, atoms);
  fillBelow(owners);
  const summary = { owners, atoms, rtl: owners.some((o) => o.strong === 'rtl') };
  if (cache) summaries.set(block, summary);
  return summary;
}

export function directionDecorations(doc, { cache = true } = {}) {
  const blocks = [];
  let anyRtl = false;
  for (let i = 0; i < doc.childCount; i += 1) {
    const s = summaryOf(doc.child(i), cache);
    blocks.push(s);
    if (s.rtl) anyRtl = true;
  }
  if (!anyRtl) return DecorationSet.empty;
  const decos = [];
  let last = null; // the ownStrong of the nearest earlier owner that has one
  let start = 0;
  for (let i = 0; i < blocks.length; i += 1) {
    const { owners, atoms } = blocks[i];
    for (const a of atoms) decos.push(Decoration.node(start + a.rel, start + a.rel + a.size, { dir: 'auto' }));
    const desired = new Array(owners.length);
    for (let k = 0; k < owners.length; k += 1) {
      const o = owners[k];
      const want = o.strong || o.below || last || 'ltr';
      desired[k] = want;
      const inherited = o.parent < 0 ? 'ltr' : desired[o.parent];
      if (want !== inherited) {
        decos.push(Decoration.node(start + o.rel, start + o.rel + o.size, { dir: o.strong ? 'auto' : want }));
      }
      if (o.strong) last = o.strong;
    }
    start += doc.child(i).nodeSize;
  }
  return DecorationSet.create(doc, decos);
}

const key = new PluginKey('textDirection');

export const TextDirection = Extension.create({
  name: 'textDirection',
  addProseMirrorPlugins() {
    return [new Plugin({
      key,
      state: {
        init: (_, { doc }) => directionDecorations(doc),
        apply: (tr, set) => (tr.docChanged ? directionDecorations(tr.doc) : set),
      },
      props: {
        decorations(state) { return key.getState(state); },
      },
    })];
  },
});
