// Inline plain-text editor — double-click to edit, Enter / blur to save,
// Escape to cancel. `autoFocus` enters edit mode on mount (and selects all).
//
// Display-mode auto-linking: when not editing AND the workspace trie
// is present in context, the displayed text is scanned for entity-name
// matches and the matches are wrapped in <EntityLink> chips. Editing
// flips contenteditable on and the chips collapse back to plain text
// (commit reads textContent so the chip's text survives edits).

import { useEffect, useRef, useState } from 'react';
import { useEntityTrie } from '../hooks/useEntityNameTrie.js';
import { scanForAutoLinks } from '../lib/scanForAutoLinks.js';
import { EntityLink } from './EntityLink.jsx';
import { tapIsDouble } from '../lib/doubleTap.js';

export function EditableText({
  value, onChange,
  multiline = false,
  placeholder = '···',
  className = '',
  tag: Tag = 'div',
  stopPropagation = true,
  autoFocus = false,
  selectAllOnFocus = false,
  // Controlled mode (optional): parent owns editing state.
  editing: editingProp,
  setEditing: setEditingProp,
  singleClickEdit = false,
}) {
  const [internalEditing, setInternalEditing] = useState(autoFocus);
  const isControlled = editingProp !== undefined;
  const editing = isControlled ? editingProp : internalEditing;
  const setEditing = isControlled ? setEditingProp : setInternalEditing;
  const ref = useRef(null);
  const initialRef = useRef(value);
  // Touch double-tap → edit. `lastTapRef` feeds tapIsDouble; `lastPtrTypeRef`
  // records the most recent pointer type so startEdit (also reachable via
  // onClick in singleClickEdit mode) knows when to focus in-gesture; and
  // `touchEntryRef` tells the focus effect below to skip its out-of-gesture
  // refocus (we already focused in the tap gesture to raise the iOS keyboard).
  const lastTapRef = useRef({});
  const lastPtrTypeRef = useRef('mouse');
  const touchEntryRef = useRef(false);

  useEffect(() => {
    if (!editing) initialRef.current = value;
  }, [value, editing]);

  useEffect(() => {
    if (editing && ref.current) {
      // Touch entry already focused + placed the caret synchronously inside
      // the tap gesture (see startEdit). A second focus here runs out of
      // user-activation (iOS ignores it for the keyboard); skip it.
      if (touchEntryRef.current) { touchEntryRef.current = false; return; }
      // Avoid scrollIntoView side-effect: the canvas is transformed, and
      // a browser auto-scroll-into-view on a focused contenteditable
      // can shove the entire page out of place — manifests as the
      // whole canvas appearing to go black when starting an inline edit.
      try { ref.current.focus({ preventScroll: true }); }
      catch (_) { ref.current.focus(); }
      const range = document.createRange();
      range.selectNodeContents(ref.current);
      if (!selectAllOnFocus) range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const commit = () => {
    if (!ref.current) return;
    const txt = ref.current.textContent.trim();
    setEditing(false);
    // Drop focus + clear the selection so no caret keeps blinking inside the
    // (now read-only) element after edit ends.
    ref.current.blur?.();
    try { window.getSelection?.()?.removeAllRanges(); } catch (_) {}
    if (txt !== (value || '').trim()) onChange(txt);
  };

  const cancel = () => {
    if (ref.current) ref.current.textContent = initialRef.current || '';
    setEditing(false);
    ref.current?.blur?.();
    try { window.getSelection?.()?.removeAllRanges(); } catch (_) {}
  };

  const onKey = (e) => {
    if (e.key === 'Enter' && !multiline) { e.preventDefault(); commit(); }
    if (e.key === 'Enter' && multiline && e.shiftKey) { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  };

  const startEdit = (e) => {
    if (stopPropagation) e.stopPropagation?.();
    // Touch: the iOS soft keyboard only rises if focus() runs synchronously in
    // the tap gesture on an already-editable element. React flips
    // contentEditable on the next render, so make it editable + focus NOW;
    // the focus effect above is gated to not re-focus out of gesture.
    if (lastPtrTypeRef.current === 'touch' && ref.current) {
      const el = ref.current;
      try {
        el.contentEditable = 'true';
        el.focus({ preventScroll: true });
        const range = document.createRange();
        range.selectNodeContents(el);
        if (!selectAllOnFocus) range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      } catch (_) {
        try { el.focus(); } catch (_) { /* noop */ }
      }
      touchEntryRef.current = true;
    }
    setEditing(true);
  };

  // Record the pointer type on every pointerdown so startEdit (incl. the
  // singleClickEdit onClick path) knows whether to focus in-gesture; keep the
  // editing-time stopPropagation that the old `swallow` provided.
  const onPtrDown = (e) => {
    lastPtrTypeRef.current = e.pointerType || 'mouse';
    if (stopPropagation && editing) e.stopPropagation();
  };
  // Touch double-tap enters edit (native dblclick is unreliable on touch).
  // singleClickEdit mode keeps using onClick — now keyboard-correct via the
  // startEdit augmentation above.
  const onPtrUp = (!editing && !singleClickEdit)
    ? (e) => { if (e.pointerType === 'touch' && tapIsDouble(lastTapRef, e)) startEdit(e); }
    : undefined;

  const swallow = stopPropagation && editing
    ? { onMouseDown: (e) => e.stopPropagation() }
    : {};

  // When editing, the displayed text is whatever the user has typed (we let
  // contenteditable manage the DOM). Avoid clobbering by only setting the
  // `display` text when not editing.
  const display = editing ? value : (value || (editing ? '' : placeholder));
  const showPlaceholder = !value && !editing;

  const clickHandler = singleClickEdit && !editing ? startEdit : undefined;
  const dblClickHandler = !singleClickEdit ? startEdit : undefined;

  const { trie, workspaceId } = useEntityTrie();
  // Only run auto-detect when not editing and the value is real text
  // (not the placeholder). Hidden behind a context lookup so callers
  // don't have to opt in.
  const renderedChildren = (!editing && trie && value)
    ? renderTitleWithAutoLinks(display, { trie, workspaceId })
    : display;

  return (
    <Tag
      ref={ref}
      className={`editable ${className} ${editing ? 'is-editing' : ''} ${showPlaceholder ? 'is-placeholder' : ''}`}
      contentEditable={editing}
      suppressContentEditableWarning
      // Titles/labels live inside the canvas's `transform: scale(zoom)` layer.
      // Grammarly's overlay and Chromium's native squiggles are both painted
      // untransformed, so at zoom ≠ 100% they drift off the words — keep both
      // off here (same policy as the note editors).
      data-gramm="false"
      data-gramm_editor="false"
      data-enable-grammarly="false"
      spellCheck={false}
      onClick={clickHandler}
      onDoubleClick={dblClickHandler}
      onPointerDown={onPtrDown}
      onPointerUp={onPtrUp}
      onKeyDown={onKey}
      onBlur={commit}
      {...swallow}
    >
      {renderedChildren}
    </Tag>
  );
}

// Wrap entity-name matches in <EntityLink> chips. Used by every
// EditableText display in the canvas (card titles, source URLs,
// etc.) so card titles become a first-class linking surface.
function renderTitleWithAutoLinks(text, { trie, workspaceId }) {
  if (!text || typeof text !== 'string') return text;
  const matches = scanForAutoLinks(text, trie);
  if (!matches.length) return text;
  const out = [];
  let last = 0; let cc = 0;
  for (const m of matches) {
    if (m.start > last) out.push(text.slice(last, m.start));
    out.push(
      <EntityLink
        key={`et-${cc++}`}
        term={m.text}
        workspaceId={workspaceId}
        asTag="span"
      >
        {m.text}
      </EntityLink>
    );
    last = m.end;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
