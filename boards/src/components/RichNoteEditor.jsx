// Rich note editor — minimal inline UI; the full toolbar lives in the
// canvas's bottom ToolOptionsBar (rendered by CanvasSurface). This editor
// just exposes its editing state via `onEditingChange` so the bar can show.
//
// Double-click the body to start editing. `autoFocus` starts in edit mode.
// Click outside (blur) saves; Escape cancels.

import { useEffect, useRef, useState } from 'react';
import { captureSelection, clearSelection } from '../lib/editorSelection.js';

export function RichNoteEditor({
  html, body, bgColor, textColor,
  onChangeHTML, onChangeBg, onChangeColor,
  onEditingChange,
  onAutoSize, // (height) => void  — fires while editing if not manually resized
  manuallyResized = false,
  autoFocus = false,
}) {
  const ref = useRef(null);
  const [editing, setEditing] = useState(autoFocus);
  const initialRef = useRef('');

  useEffect(() => {
    if (!ref.current) return;
    if (editing) return;
    const next = html || (body ? `<div>${escapeHtml(body)}</div>` : '');
    if (ref.current.innerHTML !== next) {
      ref.current.innerHTML = next;
    }
    initialRef.current = ref.current.innerHTML;
  }, [html, body, editing]);

  useEffect(() => { onEditingChange?.(editing); }, [editing]);

  // Auto-size to content while editing, until the user manually resizes.
  // We measure the contenteditable's scrollHeight + the .note padding (14px
  // each side). Reports up to NoteCard via onAutoSize so the card height
  // grows/shrinks with the typed text. Once `manuallyResized` becomes true,
  // we stop reporting and the card keeps its hand-set size.
  const measureAndReport = () => {
    if (manuallyResized) return;
    if (!ref.current || !onAutoSize) return;
    const NOTE_PAD = 14 * 2;
    const contentH = ref.current.scrollHeight;
    onAutoSize(Math.max(40, contentH + NOTE_PAD));
  };
  // Measure on every input + once on edit-start. ResizeObserver catches
  // wraps from font-size or width changes that don't fire `input`.
  useEffect(() => {
    if (!ref.current || manuallyResized) return;
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

  const commit = (e) => {
    // If focus is moving INTO the bottom toolbar (font/size selects, color
    // pickers, format buttons), don't exit edit mode — otherwise the
    // toolbar unmounts and the user's click on the dropdown never lands.
    const next = e?.relatedTarget;
    if (next && (next.closest?.('.tob') || next.closest?.('.cp-pop') || next.closest?.('.ctx-menu'))) {
      return;
    }
    setEditing(false);
    const newHtml = linkifyNoteHtml(ref.current?.innerHTML || '');
    if (ref.current && ref.current.innerHTML !== newHtml) ref.current.innerHTML = newHtml;
    // Release focus + drop selection so the caret stops blinking inside
    // the now read-only note.
    ref.current?.blur?.();
    try { window.getSelection?.()?.removeAllRanges(); } catch (_) {}
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
  };

  const onBodyClick = (e) => {
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

  const bg = bgColor || undefined;
  const isTransparent = bg === 'transparent';
  const isLightBg = !isTransparent && bg && /^#?(f|e|d|c)/i.test(bg.replace('#', ''));

  // Outer-container double-click also enters edit mode so a click on the
  // padding/border area (not inside .note-body) still re-opens the editor.
  const onOuterDouble = (e) => {
    if (editing) return;
    if (e.target.closest && e.target.closest('a, .note-preview-remove')) return;
    startEdit(e);
  };

  return (
    <div className={`note ${editing ? 'is-editing' : ''} ${isLightBg ? 'is-light-bg' : ''} ${isTransparent ? 'is-transparent' : ''}`}
         style={{ background: bg, color: textColor || undefined }}
         onDoubleClick={onOuterDouble}>
      <div ref={ref}
           className="note-body"
           contentEditable={editing}
           suppressContentEditableWarning
           onPointerDown={editing ? (e) => e.stopPropagation() : onBodyClick}
           onMouseDown={editing ? (e) => e.stopPropagation() : undefined}
           onBlur={editing ? commit : undefined}
           onKeyDown={editing ? onKey : undefined}
           onInput={editing && !manuallyResized ? measureAndReport : undefined}
           onClick={!editing ? onBodyClick : undefined}
           onDoubleClick={!editing ? onOuterDouble : undefined}
      />
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

function linkifyNoteHtml(html) {
  const root = document.createElement('div');
  root.innerHTML = html || '';
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
