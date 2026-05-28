// Rich note editor — minimal inline UI; the full toolbar lives in the
// canvas's bottom ToolOptionsBar (rendered by CanvasSurface). This editor
// just exposes its editing state via `onEditingChange` so the bar can show.
//
// Double-click the body to start editing. `autoFocus` starts in edit mode.
// Click outside (blur) saves; Escape cancels.

import { useEffect, useRef, useState } from 'react';
import { captureSelection, clearSelection } from '../lib/editorSelection.js';
import { EntityPicker } from './EntityPicker.jsx';
import { useEntityTrie } from '../hooks/useEntityNameTrie.js';
import { recordEntityLinks } from '../lib/recordEntityLinks.js';
import { coerceRef } from '../lib/entityRef.js';
import { ensureFontsFromHtml } from '../lib/googleFonts.js';

export function RichNoteEditor({
  html, body, bgColor, textColor, fontFamily, fontSize,
  onChangeHTML, onChangeBg, onChangeColor,
  onEditingChange,
  onAutoSize, // (height) => void  — fires while editing if not manually resized
  manuallyResized = false,
  autoFocus = false,
  // Live-collab plumbing (optional). When provided, while the user is
  // editing this note we broadcast the current html/selection to the
  // shared awareness; peers see the text appear character-by-character
  // and the highlight-band on selection. Final html still commits on blur.
  awareness = null,
  cardId = null,
  boardId = null,
  peerLiveHtml = null,        // html override broadcast by another peer
}) {
  const ref = useRef(null);
  const [editing, setEditing] = useState(autoFocus);
  const initialRef = useRef('');
  // Coords of the most recent pointerdown in the contenteditable. Used by
  // onBodyClick's checkbox-toggle branch to tell a tap (small movement →
  // toggle) from a drag-end click (movement > threshold → leave alone, so
  // a drag-to-select that ends on/near a checkbox doesn't accidentally
  // flip it).
  const tapStartRef = useRef(null);
  const { workspaceId } = useEntityTrie();
  // @-mention state: { tokenStart, query, anchorRect, tokenRange }
  // tokenRange is a live DOM Range covering the @<query> text so we
  // can replace it on commit without re-finding the position.
  const [mention, setMention] = useState(null);

  useEffect(() => {
    if (!ref.current) return;
    if (editing) return;  // editor owns the DOM while editing
    // Receiver: prefer the peer's in-flight html if a peer is editing this
    // note right now (peerLiveHtml from awareness), otherwise the committed
    // html from Y.Doc. peerLiveHtml clears on the peer's blur and falls
    // back to the canonical html.
    const next = peerLiveHtml ?? (html || (body ? `<div>${escapeHtml(body)}</div>` : ''));
    if (ref.current.innerHTML !== next) ref.current.innerHTML = next;
    initialRef.current = ref.current.innerHTML;
    // Any inline `font-family: 'X', ...` referring to a Google catalog font
    // needs its stylesheet injected on cold load — otherwise the browser
    // falls back to system-ui and the note looks like the font reverted.
    ensureFontsFromHtml(next);
  }, [html, body, editing, peerLiveHtml]);

  useEffect(() => { onEditingChange?.(editing); }, [editing]);

  // Auto-size to content while editing, until the user manually resizes.
  // We measure the contenteditable's scrollHeight + the .note padding (14px
  // each side). Reports up to NoteCard via onAutoSize so the card height
  // grows/shrinks with the typed text. Once `manuallyResized` becomes true,
  // we stop reporting and the card keeps its hand-set size.
  // Cap the auto-grown height so very long notes start scrolling instead
  // of taking over the canvas; the user can still drag-resize bigger if
  // they want, which flips manuallyResized true and disables this cap.
  const NOTE_AUTOSIZE_MAX = 480;
  const measureAndReport = () => {
    if (manuallyResized) return;
    // Only report height while the user is editing. Outside edit mode the
    // measurement runs against scrollHeight while custom fonts may still be
    // swapping in (font-display: swap), shrinking the cached `h` to the
    // fallback metrics — which persists permanently even after the font
    // loads. Keep the saved height stable on snapshot load.
    if (!editing) return;
    if (!ref.current || !onAutoSize) return;
    const NOTE_PAD = 14 * 2;
    const contentH = ref.current.scrollHeight;
    onAutoSize(Math.min(NOTE_AUTOSIZE_MAX, Math.max(40, contentH + NOTE_PAD)));
  };
  // Measure on every input + once on edit-start. ResizeObserver catches
  // wraps from font-size or width changes that don't fire `input`.
  useEffect(() => {
    if (!ref.current || manuallyResized || !editing) return;
    measureAndReport();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measureAndReport());
    ro.observe(ref.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, html, body, manuallyResized]);

  // Track selection so the bottom-bar's format buttons (which take focus)
  // can restore it before applying.
  useEffect(() => {
    if (!editing) return;
    const onSel = () => captureSelection();
    document.addEventListener('selectionchange', onSel);
    return () => {
      document.removeEventListener('selectionchange', onSel);
      clearSelection();
    };
  }, [editing]);

  // Enable styleWithCSS so font-size / color use inline CSS instead of <font>.
  useEffect(() => {
    if (!editing) return;
    try { document.execCommand('styleWithCSS', false, true); } catch (_) {}
    // Self-heal any pre-existing broken checklist items (stray text nodes
    // outside .ck-text, empty .ck-text without a <br> placeholder). Notes
    // saved before the placeholder fix may have one of those shapes; this
    // makes them editable again on entry.
    if (ref.current) normalizeChecklists(ref.current);
    setTimeout(() => {
      if (!ref.current) return;
      ref.current.focus();
      const range = document.createRange();
      range.selectNodeContents(ref.current);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      captureSelection();
    }, 0);
  }, [editing]);

  const startEdit = (e) => {
    e.stopPropagation();
    setEditing(true);
  };

  // Live broadcast: write the in-flight html to AWARENESS (not Y.Map) on
  // each input. Awareness is already throttled (~30Hz) on the same channel
  // as cursor presence, so peers see the text live without spamming Y.Doc
  // updates that would (a) hit broadcast rate limits and (b) pollute the
  // undo stack with one entry per keystroke. Final commit-to-Y.Doc still
  // happens on blur in commit().
  const liveTimerRef = useRef(null);
  const broadcastLive = () => {
    if (liveTimerRef.current) clearTimeout(liveTimerRef.current);
    liveTimerRef.current = setTimeout(() => {
      liveTimerRef.current = null;
      if (!ref.current) return;
      const cur = ref.current.innerHTML;
      if (awareness && cardId && boardId) {
        awareness.setLocalStateField('noteEdit', { boardId, cardId, html: cur });
      }
    }, 60);
  };

  const commit = (e) => {
    // If focus is moving INTO the bottom toolbar (font/size selects, color
    // pickers, format buttons), don't exit edit mode — otherwise the
    // toolbar unmounts and the user's click on the dropdown never lands.
    const next = e?.relatedTarget;
    if (next && (next.closest?.('.tob') || next.closest?.('.cp-pop') || next.closest?.('.ctx-menu'))) {
      return;
    }
    if (liveTimerRef.current) { clearTimeout(liveTimerRef.current); liveTimerRef.current = null; }
    setEditing(false);
    const newHtml = linkifyNoteHtml(ref.current?.innerHTML || '');
    if (ref.current && ref.current.innerHTML !== newHtml) ref.current.innerHTML = newHtml;
    // Release focus + drop selection so the caret stops blinking inside
    // the now read-only note.
    ref.current?.blur?.();
    try { window.getSelection?.()?.removeAllRanges(); } catch (_) {}
    // Clear the live-edit awareness so peers stop seeing our in-flight
    // html (they'll fall back to the canonical html that we just committed).
    try { awareness?.setLocalStateField?.('noteEdit', null); } catch (_) {}
    if (newHtml !== initialRef.current) onChangeHTML(newHtml);
  };

  const cancel = () => {
    if (ref.current) ref.current.innerHTML = initialRef.current;
    setEditing(false);
    ref.current?.blur?.();
    try { window.getSelection?.()?.removeAllRanges(); } catch (_) {}
  };

  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    if (e.key === 'Tab') {
      // Default Tab behavior is to move focus out of the editor, which
      // breaks the writing flow inside a note. Insert 2 spaces instead;
      // Shift-Tab is a no-op (un-indent isn't meaningful for free-form
      // notes).
      e.preventDefault();
      if (e.shiftKey) return;
      try { document.execCommand('insertText', false, '  '); } catch (_) {}
      return;
    }
    if (e.key === 'Enter' || e.key === 'Backspace') {
      if (handleChecklistKey(e)) {
        broadcastLive();
        if (!manuallyResized) measureAndReport();
      }
    }
  };

  const onBodyClick = (e) => {
    // Checklist box toggle — fire whether or not the note is currently
    // editing; checking off items shouldn't require a double-click in.
    const box = e.target.closest?.('.ck-box');
    if (box && ref.current) {
      // Only treat as a toggle if the pointer barely moved between down and
      // up. A drag-to-select gesture that happens to end on a checkbox
      // would otherwise flip it.
      const start = tapStartRef.current;
      tapStartRef.current = null;
      const dx = start ? e.clientX - start.x : 0;
      const dy = start ? e.clientY - start.y : 0;
      if (dx * dx + dy * dy > 25) return;
      e.preventDefault();
      e.stopPropagation();
      const checked = !box.classList.contains('is-checked');
      box.classList.toggle('is-checked', checked);
      box.setAttribute('aria-checked', checked ? 'true' : 'false');
      onChangeHTML(ref.current.innerHTML);
      return;
    }
    const remove = e.target.closest?.('.note-preview-remove');
    if (!remove || !ref.current) return;
    e.preventDefault();
    e.stopPropagation();
    const preview = remove.closest('.note-link-preview');
    const url = preview?.dataset?.url;
    preview?.remove();
    if (url) {
      const marker = document.createElement('span');
      marker.className = 'note-preview-hidden';
      marker.dataset.url = url;
      marker.hidden = true;
      ref.current.appendChild(marker);
    }
    onChangeHTML(ref.current.innerHTML);
  };

  // While editing, stop the pointerdown from bubbling to the canvas (which
  // would otherwise start dragging the whole card). Record the pointer
  // origin so onBodyClick can distinguish a tap on a checkbox (toggle)
  // from the click that ends a drag-to-select (do nothing). Crucially we
  // do NOT preventDefault here — that used to be done over .ck-box spans
  // and broke native drag-select from starting near a checkbox.
  const onEditingPointerDown = (e) => {
    e.stopPropagation();
    tapStartRef.current = { x: e.clientX, y: e.clientY };
  };

  // Handle Backspace / Enter inside a checklist item. Returns true if the
  // event was consumed (caller should not run any default behavior).
  const handleChecklistKey = (e) => {
    const sel = window.getSelection?.();
    if (!sel || sel.rangeCount === 0) return false;
    const range = sel.getRangeAt(0);
    if (!range.collapsed) return false;
    let node = range.startContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
    const text = node?.closest?.('.ck-text');
    if (!text) return false;
    const li = text.closest('.ck');
    const list = li?.parentElement;
    if (!li || !list || list.tagName !== 'UL') return false;

    if (e.key === 'Backspace') {
      if (!isRangeAtStartOf(text, range)) return false;
      e.preventDefault();
      convertChecklistItemToParagraph(li, list);
      return true;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const isEmpty = text.textContent.length === 0;
      if (isEmpty) exitChecklist(li, list);
      else splitChecklistItem(li, text, range);
      return true;
    }
    return false;
  };

  const bg = bgColor || undefined;
  const hasBg = !!bg && bg !== 'transparent';
  const isTransparent = bg === 'transparent';
  const isLightBg = hasBg && /^#?(f|e|d|c)/i.test(bg.replace('#', ''));

  // Outer-container double-click also enters edit mode so a click on the
  // padding/border area (not inside .note-body) still re-opens the editor.
  const onOuterDouble = (e) => {
    if (editing) return;
    if (e.target.closest && e.target.closest('a, .note-preview-remove')) return;
    startEdit(e);
  };

  // Walk the caret's text node backward to find an unbroken @<query>
  // span. Returns { tokenStart, query, tokenRange, anchorRect } | null.
  const detectMentionAtCaret = () => {
    const sel = window.getSelection?.();
    if (!sel || !sel.rangeCount) return null;
    const r = sel.getRangeAt(0);
    if (!r.collapsed) return null;
    const node = r.startContainer;
    if (!node || node.nodeType !== Node.TEXT_NODE) return null;
    const text = node.nodeValue || '';
    const caret = r.startOffset;
    let i = caret - 1;
    while (i >= 0 && /\S/.test(text[i]) && text[i] !== '@') i--;
    if (i < 0 || text[i] !== '@') return null;
    // Don't fire mid-email: @ must be at start of node OR preceded by whitespace.
    if (i > 0 && /\S/.test(text[i - 1])) return null;
    const query = text.slice(i + 1, caret);
    const tokenRange = document.createRange();
    tokenRange.setStart(node, i);
    tokenRange.setEnd(node, caret);
    const anchorRect = tokenRange.getBoundingClientRect();
    return { tokenStart: i, query, tokenRange, anchorRect };
  };

  const onMentionInput = () => {
    if (!editing) return;
    if (!manuallyResized) measureAndReport();
    broadcastLive();
    const detected = detectMentionAtCaret();
    setMention(detected);
  };

  // Insert a chip span at the mention range. The chip is a styled
  // span tagged with data-entity-ref so the display renderer can
  // detect it and replace it with an <EntityLink>.
  const commitMention = (target) => {
    if (!mention || !ref.current) { setMention(null); return; }
    const ref0 = coerceRef(target);
    if (!ref0) { setMention(null); return; }
    try {
      const { tokenRange } = mention;
      tokenRange.deleteContents();
      const span = document.createElement('span');
      span.className = 'tt-link tt-link-manual';
      span.setAttribute('data-entity-ref', JSON.stringify(ref0));
      span.contentEditable = 'false';
      span.textContent = target.title || target.name || ref0.kind;
      tokenRange.insertNode(span);
      // Drop a trailing space + collapse caret after the chip.
      const space = document.createTextNode(' ');
      span.parentNode.insertBefore(space, span.nextSibling);
      const sel = window.getSelection();
      const r = document.createRange();
      r.setStartAfter(space);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      // Persist immediately so a refresh shows the chip even if the
      // user doesn't blur — and so the entity_links row is written.
      const newHtml = ref.current.innerHTML;
      if (cardId && workspaceId) {
        recordEntityLinks({
          source: { kind: 'note', id: cardId, workspace: workspaceId, boardId },
          refs: [{ ref: ref0 }],
        }).catch(() => {});
      }
      onChangeHTML(newHtml);
    } catch (_) {}
    setMention(null);
  };

  const noteStyle = { background: bg, color: textColor || undefined };
  if (fontFamily) noteStyle.fontFamily = fontFamily;
  if (fontSize) noteStyle.fontSize = `${fontSize}px`;
  // Expose the bg color to CSS so .has-bg rules can keep their material
  // polish even when the inline `background` is locally overridden by
  // editing-state tints.
  if (bg) noteStyle['--has-bg-color'] = bg;
  return (
    <div className={`note ${editing ? 'is-editing' : ''} ${isLightBg ? 'is-light-bg' : ''} ${hasBg ? 'has-bg' : ''} ${isTransparent ? 'is-transparent' : ''}`}
         style={noteStyle}
         onDoubleClick={onOuterDouble}>
      <div ref={ref}
           className="note-body"
           contentEditable={editing}
           suppressContentEditableWarning
           onPointerDown={editing ? onEditingPointerDown : undefined}
           onMouseDown={editing ? (e) => e.stopPropagation() : undefined}
           onBlur={editing ? commit : undefined}
           onKeyDown={editing ? onKey : undefined}
           onInput={editing ? onMentionInput : undefined}
           onClick={onBodyClick}
           onDoubleClick={!editing ? onOuterDouble : undefined}
      />
      {mention && workspaceId && (
        <EntityPicker
          workspaceId={workspaceId}
          anchor={mention.anchorRect}
          initialQuery={mention.query}
          onCommit={(targets) => { const t = targets?.[0]; if (t) commitMention(t); else setMention(null); }}
          onCancel={() => setMention(null)}
        />
      )}
    </div>
  );
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch]);
}

const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<>"']+)/gi;

function normalizeUrl(url) {
  const trimmed = String(url || '').replace(/[.,;:!?)]$/, '');
  return trimmed.startsWith('http') ? trimmed : `https://${trimmed}`;
}

// Move any stray children inside a checklist <li> (typed when the caret
// landed outside the .ck-text span) back into .ck-text. Without this, the
// Enter/Backspace handlers can't find the editable span and the user's
// text floats next to the contentEditable=false checkbox.
function normalizeChecklists(root) {
  root.querySelectorAll('li.ck').forEach(li => {
    let text = li.querySelector('.ck-text');
    if (!text) {
      text = li.ownerDocument.createElement('span');
      text.className = 'ck-text';
      li.appendChild(text);
    }
    for (const child of Array.from(li.childNodes)) {
      if (child === text) continue;
      if (child.nodeType === Node.ELEMENT_NODE && child.classList?.contains('ck-box')) continue;
      text.appendChild(child);
    }
    // Strip legacy contenteditable=false off saved checkboxes — see the
    // comment in makeEmptyCheckbox for why we no longer use it.
    li.querySelectorAll('.ck-box').forEach(b => b.removeAttribute('contenteditable'));
    ensureCkTextPlaceholder(text);
  });
}

function linkifyNoteHtml(html) {
  const root = document.createElement('div');
  root.innerHTML = html || '';
  normalizeChecklists(root);
  root.querySelectorAll('.note-link-preview').forEach(node => node.remove());
  const hidden = new Set(Array.from(root.querySelectorAll('.note-preview-hidden')).map(node => node.dataset.url));
  const urls = new Map();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !URL_RE.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
      URL_RE.lastIndex = 0;
      if (node.parentElement?.closest('a, .note-link-preview, .note-preview-hidden')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  textNodes.forEach(node => {
    const frag = document.createDocumentFragment();
    const text = node.nodeValue;
    let last = 0;
    text.replace(URL_RE, (match, _url, index) => {
      const normalized = normalizeUrl(match);
      const label = match.replace(/[.,;:!?)]$/, '');
      if (index > last) frag.appendChild(document.createTextNode(text.slice(last, index)));
      const a = document.createElement('a');
      a.href = normalized;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = label;
      frag.appendChild(a);
      const trailing = match.slice(label.length);
      if (trailing) frag.appendChild(document.createTextNode(trailing));
      urls.set(normalized, label);
      last = index + match.length;
      return match;
    });
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
  });

  urls.forEach((label, url) => {
    if (hidden.has(url)) return;
    const preview = document.createElement('div');
    preview.className = 'note-link-preview';
    preview.dataset.url = url;
    const host = new URL(url).hostname.replace(/^www\./, '');
    preview.innerHTML = `<div class="note-link-preview-meta"><span>LINK PREVIEW</span><strong>${escapeHtml(host)}</strong><small>${escapeHtml(label)}</small></div><button type="button" class="note-preview-remove" aria-label="Remove link preview">x</button>`;
    root.appendChild(preview);
  });

  return root.innerHTML;
}

// ── Checklist key behaviors ────────────────────────────────────────────
// Backspace at start of a checklist item → unwrap into a plain paragraph.
// Enter inside a non-empty checklist item → split into a new item below.
// Enter on an empty checklist item → exit the list back to a paragraph.
// All three keep the .ck/.ck-box/.ck-text HTML shape the rest of the
// editor expects.

function isRangeAtStartOf(el, range) {
  if (!el.contains(range.startContainer)) return false;
  try {
    const probe = document.createRange();
    probe.setStart(el, 0);
    probe.setEnd(range.startContainer, range.startOffset);
    return probe.toString().length === 0;
  } catch (_) {
    return false;
  }
}

function makeEmptyCheckbox(doc) {
  const box = doc.createElement('span');
  box.className = 'ck-box';
  // Intentionally NOT contenteditable=false. Chrome (and Firefox) extend
  // selection forward through ce=false islands but get glitchy extending
  // backward across them — so a drag-up out of one checklist item into
  // the previous one would fail to extend. Leaving the box editable lets
  // native drag-select span both directions. The box has no text content
  // so a misplaced caret is benign; clicks are intercepted by onBodyClick.
  box.setAttribute('role', 'checkbox');
  box.setAttribute('aria-checked', 'false');
  return box;
}

// Insert `block` adjacent to `li` in `list`, splitting the list if needed
// so the block ends up between the items on either side.
function insertBlockNearChecklistItem(block, li, list) {
  const before = li.previousElementSibling;
  const after = li.nextElementSibling;
  if (!before && !after) {
    list.parentNode.insertBefore(block, list);
    return;
  }
  if (!before) {
    list.parentNode.insertBefore(block, list);
    return;
  }
  if (!after) {
    list.parentNode.insertBefore(block, list.nextSibling);
    return;
  }
  // Middle of the list: split. Move all items after `li` into a fresh
  // list of the same tag/classes and place the block between the two.
  const tail = list.cloneNode(false);
  let cur = li.nextElementSibling;
  while (cur) {
    const next = cur.nextElementSibling;
    tail.appendChild(cur);
    cur = next;
  }
  list.parentNode.insertBefore(block, list.nextSibling);
  block.parentNode.insertBefore(tail, block.nextSibling);
}

function caretAtStart(el) {
  const sel = window.getSelection?.();
  if (!sel) return;
  const r = document.createRange();
  r.setStart(el, 0);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

function convertChecklistItemToParagraph(li, list) {
  const doc = li.ownerDocument;
  const div = doc.createElement('div');
  const text = li.querySelector('.ck-text');
  if (text) while (text.firstChild) div.appendChild(text.firstChild);
  if (!div.firstChild) div.appendChild(doc.createElement('br'));
  insertBlockNearChecklistItem(div, li, list);
  li.remove();
  if (!list.querySelector('li')) list.remove();
  caretAtStart(div);
}

function exitChecklist(li, list) {
  const doc = li.ownerDocument;
  const div = doc.createElement('div');
  div.appendChild(doc.createElement('br'));
  insertBlockNearChecklistItem(div, li, list);
  li.remove();
  if (!list.querySelector('li')) list.remove();
  caretAtStart(div);
}

function splitChecklistItem(li, text, range) {
  const doc = li.ownerDocument;
  // Extract everything from caret to end of .ck-text into a fragment.
  const after = document.createRange();
  after.setStart(range.startContainer, range.startOffset);
  after.setEnd(text, text.childNodes.length);
  const frag = after.extractContents();

  const newLi = doc.createElement('li');
  newLi.className = 'ck';
  newLi.appendChild(makeEmptyCheckbox(doc));
  const newText = doc.createElement('span');
  newText.className = 'ck-text';
  if (frag.childNodes.length) newText.appendChild(frag);
  newLi.appendChild(newText);

  li.parentNode.insertBefore(newLi, li.nextSibling);
  // Empty inline .ck-text spans can't anchor a caret without a placeholder
  // (browsers won't paint a caret inside a zero-dimension inline element).
  // Add a <br> to either side that is now empty, then place the caret
  // before the placeholder so the first typed character replaces it.
  ensureCkTextPlaceholder(text);
  ensureCkTextPlaceholder(newText);
  caretAtStartOfCkText(newText);
}

function ensureCkTextPlaceholder(textEl) {
  // extractContents() at a text-node boundary leaves an empty "" text node
  // behind. Strip those first so the "no children" check correctly detects
  // an empty span that needs a placeholder.
  Array.from(textEl.childNodes).forEach(n => {
    if (n.nodeType === Node.TEXT_NODE && !n.nodeValue) n.remove();
  });
  if (!textEl.firstChild) textEl.appendChild(textEl.ownerDocument.createElement('br'));
}

function caretAtStartOfCkText(textEl) {
  const sel = window.getSelection?.();
  if (!sel) return;
  const r = document.createRange();
  if (textEl.firstChild?.nodeName === 'BR' && textEl.childNodes.length === 1) {
    r.setStartBefore(textEl.firstChild);
  } else {
    r.setStart(textEl, 0);
  }
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

// ── Caret preservation helpers ─────────────────────────────────────────
// captureCharOffset returns the integer position of (node, offset) within
// `root` — counting the same way Range positions count. restoreCharOffset
// walks `root` and places the caret at the same integer offset after a
// re-paint, so a remote html update doesn't kick the local user out of
// the line they were typing.
function captureCharOffset(root, node, offset) {
  let count = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (n === node) return count + offset;
    count += n.nodeValue.length;
  }
  return -1;
}
function restoreCharOffset(root, target) {
  let remaining = target;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let node = walker.nextNode();
  while (node) {
    if (remaining <= node.nodeValue.length) {
      const sel = window.getSelection?.();
      if (!sel) return;
      const range = document.createRange();
      range.setStart(node, remaining);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    remaining -= node.nodeValue.length;
    node = walker.nextNode();
  }
}
