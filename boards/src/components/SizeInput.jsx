import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { isComposingKey } from '../lib/composerKeys.js';
import { useAnchoredPopover } from '../hooks/useAnchoredPopover.js';

// Compact editable font-size combobox shared by the note (ToolOptionsBar) and
// doc (DocToolbar) toolbars. The user can type an EXACT px size, or pick a
// preset from the dropdown. The presets used to live in a native <datalist>,
// but Chrome only surfaces datalist suggestions while typing into an empty/
// matching field — there's no affordance, so the control read as type-only.
// The dropdown is now an explicit chevron + list with the current size
// highlighted; ArrowUp/Down nudge the size by 1.
//
// Commits ONLY on blur / Enter / preset click / arrow step, never
// mid-keystroke — so a half-typed "1" never applies font-size:1 to the live
// selection. Escape reverts to the current value and stops propagation so it
// doesn't bubble out to the editor's own Escape (which would cancel the whole
// edit). While the dropdown is open, Escape is the dropdown's: it closes it
// and nothing else, wherever the focus is.
//
// Props:
//   value      — current size (number) or null when the selection is mixed/unknown
//   presets    — number[] shown in the dropdown
//   onCommit   — (px:number) => void, called with the clamped integer size
//   className  — extra class for per-toolbar styling
//   min / max  — clamp bounds (default 6–200)
//   disabled   — boolean
//   dropUp     — open the preset list above the field (bottom-docked bars)
export function SizeInput({ value = null, presets = [], onCommit, className = '', min = 6, max = 200, disabled = false, dropUp = false }) {
  const [draft, setDraft] = useState(() => (value ? String(value) : ''));
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  // The preset list is portaled to <body> with fixed coordinates: the
  // bottom tool-options bar scrolls sideways (overflow-x) rather than wrap,
  // and an in-flow absolute list was clipped to nothing inside it. It follows
  // the field as the bar scrolls (hooks/useAnchoredPopover).
  const pop = useAnchoredPopover({
    open, onClose: () => setOpen(false), anchorRef: wrapRef,
    side: dropUp ? 'above' : 'below', gap: 4, matchWidth: true,
  });
  // Reflect the caret's current size unless the user is actively editing.
  useEffect(() => { if (!focused) setDraft(value ? String(value) : ''); }, [value, focused]);

  const clamp = (n) => Math.min(max, Math.max(min, n));
  const commitPx = (n) => {
    if (!Number.isFinite(n) || n <= 0) return;
    const clamped = clamp(Math.round(n));
    onCommit?.(clamped);
    setDraft(String(clamped));
  };
  // Escape blurs to revert, and that blur runs this same commit-on-blur — with
  // the TYPED draft still in its closure (the revert's setDraft hasn't
  // rendered yet), so Escape used to apply the value it meant to throw away.
  const cancelRef = useRef(false);
  const commitDraft = () => {
    setFocused(false);
    if (cancelRef.current) {
      cancelRef.current = false;
      setDraft(value ? String(value) : '');
      return;
    }
    const n = parseInt(draft, 10);
    // Only a size that was changed: arrowing through the bar passes through
    // this field, and setting the size it already shows marked the selection
    // with it and took the focus back into the editor.
    if (Number.isFinite(n) && n > 0 && n !== value) commitPx(n);
    else setDraft(value ? String(value) : '');
  };

  // preventDefault on press so the editor's focus/selection survives the
  // dropdown interaction (same trick as the toolbar format buttons).
  const pd = (e) => e.preventDefault();

  return (
    <span className={`size-combo-wrap ${dropUp ? 'is-drop-up' : ''}`.trim()} ref={wrapRef}>
      <input
        type="text"
        inputMode="numeric"
        className={`size-combo ${className}`.trim()}
        value={draft}
        placeholder="Size"
        title="Font size — type an exact px value or pick one"
        aria-label="Font size"
        disabled={disabled}
        onFocus={(e) => { setFocused(true); e.target.select(); }}
        onChange={(e) => { const v = e.target.value; if (/^\d{0,3}$/.test(v)) setDraft(v); }}
        onBlur={commitDraft}
        onKeyDown={(e) => {
          if (isComposingKey(e)) return;
          if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); e.currentTarget.blur(); }
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            e.stopPropagation();
            const base = parseInt(draft, 10);
            const cur = Number.isFinite(base) && base > 0 ? base : (value ?? 15);
            commitPx(cur + (e.key === 'ArrowUp' ? 1 : -1));
          } else if (e.key === 'Escape') {
            e.stopPropagation();
            cancelRef.current = true;
            e.currentTarget.blur();
          }
        }}
      />
      {presets.length > 0 && (
        <button type="button" className="size-combo-arrow" title="Preset sizes"
                aria-label="Preset sizes" aria-expanded={open}
                disabled={disabled}
                onMouseDown={pd} onPointerDown={pd}
                onClick={() => setOpen(o => !o)}>▾</button>
      )}
      {open && typeof document !== 'undefined' && createPortal(
        <span className="size-combo-pop is-portaled" role="listbox" ref={pop.popRef} style={pop.style}>
          {presets.map(s => (
            <button key={s} type="button" role="option"
                    className={`size-combo-item ${Number(draft) === s ? 'is-current' : ''}`.trim()}
                    aria-selected={Number(draft) === s}
                    onMouseDown={pd} onPointerDown={pd}
                    onClick={() => { commitPx(s); setOpen(false); }}>
              {s}
            </button>
          ))}
        </span>,
        document.body,
      )}
    </span>
  );
}
