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

  useEffect(() => {
    if (!editing) initialRef.current = value;
  }, [value, editing]);

  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus();
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
    if (stopPropagation) e.stopPropagation();
    setEditing(true);
  };

  const swallow = stopPropagation && editing
    ? { onPointerDown: (e) => e.stopPropagation(), onMouseDown: (e) => e.stopPropagation() }
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
      onClick={clickHandler}
      onDoubleClick={dblClickHandler}
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
