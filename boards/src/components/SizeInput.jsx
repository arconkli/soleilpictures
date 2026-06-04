import { useEffect, useId, useState } from 'react';

// Compact editable font-size combobox shared by the note (ToolOptionsBar) and
// doc (DocToolbar) toolbars. The user can type an EXACT px size, or pick a
// common size from the native datalist dropdown — replacing the old
// preset-only <select> that couldn't express anything off the list.
//
// Commits ONLY on blur / Enter (and datalist-pick → blur), never mid-keystroke
// — so a half-typed "1" never applies font-size:1 to the live selection.
// Escape reverts to the current value and stops propagation so it doesn't
// bubble out to the editor's own Escape (which would cancel the whole edit).
// Mirrors the LinePxInput idiom already in ToolOptionsBar.
//
// Props:
//   value      — current size (number) or null when the selection is mixed/unknown
//   presets    — number[] shown in the dropdown
//   onCommit   — (px:number) => void, called with the clamped integer size
//   className  — extra class for per-toolbar styling
//   min / max  — clamp bounds (default 6–200)
//   disabled   — boolean
export function SizeInput({ value = null, presets = [], onCommit, className = '', min = 6, max = 200, disabled = false }) {
  const listId = useId();
  const [draft, setDraft] = useState(() => (value ? String(value) : ''));
  const [focused, setFocused] = useState(false);
  // Reflect the caret's current size unless the user is actively editing.
  useEffect(() => { if (!focused) setDraft(value ? String(value) : ''); }, [value, focused]);

  const commit = () => {
    setFocused(false);
    const n = parseInt(draft, 10);
    if (Number.isFinite(n) && n > 0) {
      const clamped = Math.min(max, Math.max(min, n));
      onCommit?.(clamped);
      setDraft(String(clamped));
    } else {
      setDraft(value ? String(value) : '');
    }
  };

  return (
    <>
      <input
        type="text"
        inputMode="numeric"
        className={`size-combo ${className}`.trim()}
        list={listId}
        value={draft}
        placeholder="Size"
        title="Font size — type an exact px value or pick one"
        aria-label="Font size"
        disabled={disabled}
        onFocus={(e) => { setFocused(true); e.target.select(); }}
        onChange={(e) => { const v = e.target.value; if (/^\d{0,3}$/.test(v)) setDraft(v); }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); e.currentTarget.blur(); }
          else if (e.key === 'Escape') {
            e.stopPropagation();
            setDraft(value ? String(value) : '');
            setFocused(false);
            e.currentTarget.blur();
          }
        }}
      />
      <datalist id={listId}>
        {presets.map(s => <option key={s} value={s} />)}
      </datalist>
    </>
  );
}
