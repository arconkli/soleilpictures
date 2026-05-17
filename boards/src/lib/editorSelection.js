// Save/restore the active selection in a contenteditable so toolbar buttons
// (which steal focus) can apply formatting to whatever was selected.

let savedRange = null;
let savedRoot = null;

export function captureSelection() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const r = sel.getRangeAt(0);
  let node = r.commonAncestorContainer;
  if (node.nodeType === 3) node = node.parentNode;
  const editable = node.closest && node.closest('[contenteditable="true"]');
  if (editable) {
    savedRange = r.cloneRange();
    savedRoot = editable;
  }
}

export function clearSelection() {
  savedRange = null;
  savedRoot = null;
}

export function restoreSelection() {
  if (!savedRange || !savedRoot || !document.contains(savedRoot)) return false;
  try { savedRoot.focus(); } catch (_) { return false; }
  const sel = window.getSelection();
  sel.removeAllRanges();
  try {
    sel.addRange(savedRange);
    return true;
  } catch (_) { return false; }
}

export function withSelection(fn) {
  if (!restoreSelection()) return false;
  fn();
  // Re-capture after the action so subsequent operations target the new range.
  captureSelection();
  return true;
}

// Capture the current selection as character offsets within `editable`'s
// textContent. Unlike `captureSelection` (which stores a live Range that
// dies when its nodes are removed from the DOM), offsets survive an
// `innerHTML = ...` rewrite of the editable — the font picker resets
// innerHTML between hover previews, so we need offset-based selection
// tracking to recover the user's selection after each reset.
export function captureSelectionOffsets(editable) {
  if (!editable) return null;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const r = sel.getRangeAt(0);
  if (!editable.contains(r.startContainer) || !editable.contains(r.endContainer)) return null;
  try {
    const a = document.createRange();
    a.setStart(editable, 0);
    a.setEnd(r.startContainer, r.startOffset);
    const start = a.toString().length;
    const b = document.createRange();
    b.setStart(editable, 0);
    b.setEnd(r.endContainer, r.endOffset);
    const end = b.toString().length;
    return { start, end };
  } catch (_) {
    return null;
  }
}

// Re-establish a selection inside `editable` at the given character offsets
// (as produced by `captureSelectionOffsets`). Walks `editable`'s text nodes
// to find the node + local offset corresponding to each absolute index.
export function restoreSelectionFromOffsets(editable, start, end) {
  if (!editable || start == null || end == null) return false;
  const startPos = boundaryFromIndex(editable, start);
  const endPos = boundaryFromIndex(editable, end);
  if (!startPos || !endPos) return false;
  try { editable.focus(); } catch (_) { return false; }
  try {
    const range = document.createRange();
    range.setStart(startPos.node, startPos.offset);
    range.setEnd(endPos.node, endPos.offset);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  } catch (_) {
    return false;
  }
}

function boundaryFromIndex(editable, targetIndex) {
  if (targetIndex < 0) return null;
  let remaining = targetIndex;
  const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT);
  let n;
  let lastNode = null;
  while ((n = walker.nextNode())) {
    lastNode = n;
    const len = n.nodeValue.length;
    if (remaining <= len) {
      return { node: n, offset: remaining };
    }
    remaining -= len;
  }
  // Past the end — clamp to the end of the last text node.
  if (lastNode) return { node: lastNode, offset: lastNode.nodeValue.length };
  return null;
}

// Wrap the current selection in a span with the given inline styles.
// Walks the text nodes inside the range and wraps each one individually
// so cross-element selections don't get mangled by surroundContents /
// extractContents (which can split structural wrappers like <li> or
// <p>, leaving the note in a broken state).
export function wrapSelectionStyle(style) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  if (range.collapsed) return;
  const styleKeys = Object.keys(style);
  if (!styleKeys.length) return;

  // Collect every text node fully or partially inside the range.
  const textNodes = collectTextNodes(range);
  if (textNodes.length === 0) return;

  // For each text node, split off the portion inside the range and
  // wrap that portion. If the text node's parent is already a <span>
  // with no other children except this text, just update the parent's
  // style instead of nesting another span.
  let firstWrapped = null;
  let lastWrapped = null;
  for (const tn of textNodes) {
    const slice = sliceTextNodeToRange(tn, range);
    if (!slice) continue;
    const target = applyStyleToTextNode(slice, style);
    if (target) {
      if (!firstWrapped) firstWrapped = target;
      lastWrapped = target;
    }
  }

  // Reselect the wrapped range so a follow-up format applies to the
  // same span (font-size then bold, for instance).
  if (firstWrapped && lastWrapped) {
    const newRange = document.createRange();
    newRange.setStartBefore(firstWrapped);
    newRange.setEndAfter(lastWrapped);
    sel.removeAllRanges();
    sel.addRange(newRange);
  }
}

function collectTextNodes(range) {
  const root = range.commonAncestorContainer;
  const out = [];
  const walker = document.createTreeWalker(
    root.nodeType === 3 ? root.parentNode : root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(n) {
        if (!n.nodeValue || !n.nodeValue.length) return NodeFilter.FILTER_REJECT;
        // Must intersect the range somehow.
        const ok = range.intersectsNode ? range.intersectsNode(n) : true;
        return ok ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    },
  );
  let n;
  while ((n = walker.nextNode())) out.push(n);
  // Edge case: the range is fully inside a single text node — the walker
  // started AT that node's parent, so it should be included by the
  // intersectsNode check above. If not present, push it explicitly.
  if (out.length === 0 && range.startContainer === range.endContainer && range.startContainer.nodeType === 3) {
    out.push(range.startContainer);
  }
  return out;
}

// Trim a text node so only the portion inside the range remains, then
// return that node. May split the original text node into 2 or 3 nodes
// so the bordering siblings keep their original styling.
function sliceTextNodeToRange(textNode, range) {
  let start = 0;
  let end = textNode.nodeValue.length;
  if (range.startContainer === textNode) start = range.startOffset;
  if (range.endContainer === textNode)   end   = range.endOffset;
  if (start >= end) return null;

  let working = textNode;
  if (end < working.nodeValue.length) {
    working.splitText(end);
  }
  if (start > 0) {
    working = working.splitText(start);
  }
  return working;
}

function applyStyleToTextNode(textNode, style) {
  const parent = textNode.parentElement;
  // Reuse the parent span if it's the lone child and is a plain <span>.
  if (
    parent &&
    parent.tagName === 'SPAN' &&
    parent.childNodes.length === 1 &&
    parent.firstChild === textNode
  ) {
    Object.assign(parent.style, style);
    return parent;
  }
  const span = document.createElement('span');
  Object.assign(span.style, style);
  parent.insertBefore(span, textNode);
  span.appendChild(textNode);
  return span;
}

// Toggle a list type around the current selection. `type` is 'ul' |
// 'ol' | 'task'. Operates on the block elements containing the
// selection. If they're already in a matching list, unwrap to plain
// paragraphs; otherwise wrap them in a fresh <ul>/<ol>/<ul class="note-checklist">.
export function toggleList(type) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  const editable = findEditable(range.commonAncestorContainer);
  if (!editable) return;

  const blocks = collectBlocks(range, editable);
  if (blocks.length === 0) return;

  const wantedTag = type === 'ol' ? 'OL' : 'UL';
  const wantedClass = type === 'task' ? 'note-checklist' : '';

  // Detect: are all blocks already in a matching list?
  const allMatch = blocks.every(b => {
    const li = b.tagName === 'LI' ? b : b.closest('li');
    if (!li) return false;
    const list = li.parentElement;
    if (!list || list.tagName !== wantedTag) return false;
    if (wantedClass) return list.classList.contains(wantedClass);
    return !list.classList.contains('note-checklist');
  });

  if (allMatch) {
    unwrapList(blocks);
  } else {
    wrapInList(blocks, wantedTag, wantedClass);
  }

  // Restore selection to the wrapped/unwrapped content so follow-up
  // formats apply to the same range.
  try {
    const newRange = document.createRange();
    newRange.selectNodeContents(blocks[blocks.length - 1]);
    newRange.collapse(false);
    sel.removeAllRanges();
    sel.addRange(newRange);
  } catch (_) {}
}

function findEditable(node) {
  let n = node;
  if (n && n.nodeType === 3) n = n.parentNode;
  while (n && n.nodeType === 1) {
    if (n.getAttribute && n.getAttribute('contenteditable') === 'true') return n;
    n = n.parentNode;
  }
  return null;
}

function collectBlocks(range, editable) {
  // Find the nearest block-level ancestor for the range's start and end.
  const startBlock = blockAncestor(range.startContainer, editable);
  const endBlock = blockAncestor(range.endContainer, editable);
  if (!startBlock || !endBlock) return [];
  if (startBlock === endBlock) return [startBlock];
  // Walk siblings from startBlock to endBlock (assumes both are direct
  // children of the editable or live in one wrapper).
  const blocks = [];
  let cur = startBlock;
  while (cur) {
    blocks.push(cur);
    if (cur === endBlock) break;
    cur = cur.nextElementSibling;
  }
  return blocks;
}

const BLOCK_TAGS = new Set(['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE']);
function blockAncestor(node, editable) {
  let n = node;
  if (n && n.nodeType === 3) n = n.parentNode;
  while (n && n !== editable) {
    if (n.nodeType === 1 && BLOCK_TAGS.has(n.tagName)) return n;
    n = n.parentNode;
  }
  // Fallback: treat the editable itself as one block.
  return editable;
}

function wrapInList(blocks, wantedTag, wantedClass) {
  if (!blocks.length) return;
  const doc = blocks[0].ownerDocument;
  const list = doc.createElement(wantedTag);
  if (wantedClass) list.classList.add(wantedClass);

  // Special case: the "block" we picked up IS the contentEditable root
  // (the note body had no block-level wrapper around the typed text, so
  // `blockAncestor` fell back to the editable). Removing it would tear the
  // editor's root node out of the DOM. Instead, build a single <li>
  // containing the editable's existing children and append the new list
  // INSIDE the editable.
  if (blocks.length === 1 && blocks[0].isContentEditable) {
    const root = blocks[0];
    const li = doc.createElement('li');
    while (root.firstChild) li.appendChild(root.firstChild);
    list.appendChild(li);
    root.appendChild(list);
    decorateChecklistItem(li, wantedClass, doc);
    return;
  }

  // Insert the list before the first block, then append each block as
  // an <li> (converting existing <li> by lifting its children).
  const parent = blocks[0].parentNode;
  parent.insertBefore(list, blocks[0]);
  for (const block of blocks) {
    let li;
    if (block.tagName === 'LI') {
      // Detach from its old list and move into the new one.
      li = block;
      const oldList = li.parentElement;
      list.appendChild(li);
      // Clean up old list if empty.
      if (oldList && oldList !== list && !oldList.children.length) {
        oldList.remove();
      }
    } else {
      li = doc.createElement('li');
      // Move inner children into the li so styles are preserved.
      while (block.firstChild) li.appendChild(block.firstChild);
      block.remove();
      list.appendChild(li);
    }
    decorateChecklistItem(li, wantedClass, doc);
  }
}

function decorateChecklistItem(li, wantedClass, doc) {
  if (wantedClass !== 'note-checklist') return;
  li.classList.add('ck');
  if (!li.querySelector('.ck-box')) {
    const box = doc.createElement('span');
    box.className = 'ck-box';
    box.contentEditable = 'false';
    box.setAttribute('role', 'checkbox');
    box.setAttribute('aria-checked', 'false');
    li.insertBefore(box, li.firstChild);
  }
  if (!li.querySelector('.ck-text')) {
    const text = doc.createElement('span');
    text.className = 'ck-text';
    while (li.childNodes.length > 1) {
      text.appendChild(li.childNodes[1]);
    }
    li.appendChild(text);
  }
}

function unwrapList(blocks) {
  for (const b of blocks) {
    const li = b.tagName === 'LI' ? b : b.closest('li');
    if (!li) continue;
    const list = li.parentElement;
    if (!list) continue;
    const doc = li.ownerDocument;
    const p = doc.createElement('div');
    // For checklist items, lift only the .ck-text content (drop the checkbox).
    const txt = li.querySelector('.ck-text');
    if (txt) {
      while (txt.firstChild) p.appendChild(txt.firstChild);
    } else {
      while (li.firstChild) p.appendChild(li.firstChild);
    }
    list.parentNode.insertBefore(p, list);
    li.remove();
    if (!list.children.length) list.remove();
  }
}
