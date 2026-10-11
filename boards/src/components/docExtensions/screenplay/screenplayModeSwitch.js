// Converting a doc's content across a Screenplay ⇄ Doc mode switch.
//
// Done ONCE, by the client that flipped the mode, directly on the page
// Y.XmlFragments and inside the same Yjs transaction as the flip (see
// switchDocMode in lib/docState.js). It used to run in every sheet editor's
// onCreate instead — and every client with the doc open remounts on a mode
// change, so every one of them converted. y-prosemirror can't change a node's
// type in place (it deletes the Y.XmlElement and inserts a new one), so two
// converters each inserted their own copy and the whole doc came back twice.
// Riding in the flip's own transaction also means a peer receives the mode and
// the converted content as one update: there is never a window in which its
// editor sees the new mode over the old content.
//
// Lossless both ways. Leaving Screenplay used to turn every block into a bare
// paragraph, and coming back could only re-detect sluglines and transitions —
// every character cue, line of dialogue and parenthetical came back as Action.
// A paragraph now remembers its element (and a locked scene number and dual
// column) in invisible attrs that ScreenplayBlock declares on `paragraph`, and
// the way back reads them. A paragraph written while in Doc mode has none and
// is detected exactly as before.
//
// Pure Yjs + screenplayFlow, so it is unit-testable without an editor.

import * as Y from 'yjs';
import { cloneYXmlNode } from '../../../lib/yhelpers.js';
import { ELEMENTS, SP_MEMORY, detectElementFromText, shouldUppercase } from './screenplayFlow.js';

// Top-level textblocks that become screenplay lines (the schema's prose
// textblocks). Containers — lists, tables, quotes — keep their prose, as their
// content specs require.
const PROSE_TEXTBLOCKS = new Set(['paragraph', 'heading', 'codeBlock']);

const isXmlText = (n) => !!n && typeof n.toDelta === 'function' && typeof n.toArray !== 'function';
const isXmlElement = (n) => !!n && typeof n.toArray === 'function' && !!n.nodeName;

function plainTextOf(el) {
  let text = '';
  let plain = true; // only unmarked text — safe to uppercase in place
  for (const c of el.toArray()) {
    if (!isXmlText(c)) { plain = false; continue; }
    for (const op of c.toDelta()) {
      if (typeof op.insert === 'string') {
        text += op.insert;
        if (op.attributes && Object.keys(op.attributes).length) plain = false;
      } else plain = false;
    }
  }
  return { text, plain };
}

function rebuilt(src, nodeName, attrs, upperText = null) {
  const el = new Y.XmlElement(nodeName);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined) el.setAttribute(k, v);
  }
  let kids;
  if (upperText != null) {
    const t = new Y.XmlText();
    t.insert(0, upperText);
    kids = [t];
  } else {
    kids = src.toArray().map(cloneYXmlNode).filter(Boolean);
  }
  if (kids.length) el.insert(0, kids);
  return el;
}

function replaceAt(parent, index, el) {
  parent.delete(index, 1);
  parent.insert(index, [el]);
}

function toScreenplay(fragment) {
  const nodes = fragment.toArray();
  // A brand-new page (one empty line) starts on a Scene Heading, as a fresh
  // screenplay page does.
  const lone = nodes.length === 1 && isXmlElement(nodes[0]) && !plainTextOf(nodes[0]).text;
  let changed = false;
  nodes.forEach((node, i) => {
    if (!isXmlElement(node) || !PROSE_TEXTBLOCKS.has(node.nodeName)) return;
    const a = node.getAttributes() || {};
    const remembered = node.nodeName === 'paragraph' && ELEMENTS.includes(a[SP_MEMORY.element])
      ? a[SP_MEMORY.element] : null;
    const { text, plain } = plainTextOf(node);
    const element = remembered || (lone ? 'scene' : (detectElementFromText('action', text) || 'action'));
    const attrs = { element };
    if (remembered) {
      attrs.sceneNumber = a[SP_MEMORY.sceneNumber] ?? null;
      attrs.dual = (a[SP_MEMORY.dual] === 'left' || a[SP_MEMORY.dual] === 'right') ? a[SP_MEMORY.dual] : null;
    }
    // Sluglines, cues and transitions are uppercase — but only as a pure
    // same-length transform of unmarked text, so no mark or comment shifts.
    // Detected lines only: a remembered one was already uppercase when it left
    // Screenplay, so uppercasing it again could only destroy prose written
    // over it in Doc mode.
    let upper = null;
    if (!remembered && shouldUppercase(element) && plain) {
      const u = text.toUpperCase();
      if (u !== text && u.length === text.length) upper = u;
    }
    replaceAt(fragment, i, rebuilt(node, 'screenplayBlock', attrs, upper));
    changed = true;
  });
  return changed;
}

function toProse(parent) {
  let changed = false;
  parent.toArray().forEach((node, i) => {
    if (!isXmlElement(node)) return;
    if (node.nodeName !== 'screenplayBlock') {
      // Screenplay lines can only sit at the top level today, but walk
      // containers anyway — the old converter did.
      if (!PROSE_TEXTBLOCKS.has(node.nodeName) && toProse(node)) changed = true;
      return;
    }
    const a = node.getAttributes() || {};
    replaceAt(parent, i, rebuilt(node, 'paragraph', {
      [SP_MEMORY.element]: ELEMENTS.includes(a.element) ? a.element : 'action',
      [SP_MEMORY.sceneNumber]: a.sceneNumber ?? null,
      [SP_MEMORY.dual]: a.dual ?? null,
    }));
    changed = true;
  });
  return changed;
}

// Convert one page fragment's content for `mode` ('screenplay' | 'doc').
// Idempotent: content already in that mode's shape is left alone. Call inside
// a ydoc.transact so the whole switch is one update (and one undo step).
export function convertFragmentDocMode(fragment, mode) {
  if (!fragment || typeof fragment.toArray !== 'function') return false;
  return mode === 'screenplay' ? toScreenplay(fragment) : toProse(fragment);
}
