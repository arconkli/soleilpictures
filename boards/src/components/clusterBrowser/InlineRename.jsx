// Rename in place — F2, or Rename in the right-click menu. The name becomes a
// field: Enter or clicking away saves, Esc puts it back. Like Finder, the
// extension isn't selected, so typing replaces just the name.
//
// It carries the `editable` class, which Files' tile and row handlers already
// ignore, and stops its own pointer and key events so the tile it sits in
// doesn't select, open or drag while you type.

import { useEffect, useRef } from 'react';

export function InlineRename({ value = '', onCommit, onCancel, className = '', label = 'Name' }) {
  const ref = useRef(null);
  const doneRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    const dot = value.lastIndexOf('.');
    const ext = dot > 0 ? value.length - dot - 1 : 0;
    el.setSelectionRange(0, ext >= 1 && ext <= 5 ? dot : value.length);
    // value is the starting text only; re-selecting on every keystroke would
    // fight the person typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = (save) => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (save) onCommit?.(ref.current?.value ?? '');
    else onCancel?.();
  };

  const stop = (e) => e.stopPropagation();
  return (
    <input
      ref={ref}
      className={`editable ir-input ${className}`.trim()}
      defaultValue={value}
      aria-label={label}
      spellCheck={false}
      maxLength={200}
      onClick={stop} onDoubleClick={stop} onPointerDown={stop} onMouseDown={stop}
      onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      }}
      onBlur={() => finish(true)}
    />
  );
}
