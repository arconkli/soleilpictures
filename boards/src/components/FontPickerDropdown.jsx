import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.jsx';
import { ChevronDown } from '../lib/icons.js';
import { ensureGoogleFontLoaded } from '../lib/googleFonts.js';
import { useAnchoredPopover } from '../hooks/useAnchoredPopover.js';

const POP_WIDTH = 280;

// Custom font dropdown with hover-preview.
//
// Each row renders its label in its own font face so the list itself
// previews. Hovering a row also fires `onPreview(css)` — the parent
// applies that font to the actual editor selection so the user sees
// what the doc would look like before committing. Click commits via
// `onCommit(entry)`. Closing without a click triggers `onCancel()`
// (parent uses it to revert preview to the original font).
//
// Props:
//   currentLabel  — string shown on the trigger button
//   recentFonts   — [{ name, css, gfName? }, …]
//   allFonts      — [{ key, label, css, gfName? }, …]
//   onPreview     — (css | null) => void
//   onCommit      — (entry) => void
//   onCancel      — () => void
//   onManage      — () => void  (clicking "Add custom font…")
//   disabled      — boolean
//   align         — 'left' | 'right' (popover anchor side, default 'left')
export function FontPickerDropdown({
  currentLabel = 'Font',
  recentFonts = [],
  allFonts = [],
  onPreview,
  onCommit,
  onCancel,
  onManage,
  disabled = false,
  align = 'left',
}) {
  const [open, setOpen] = useState(false);
  const committedRef = useRef(false);
  const buttonRef = useRef(null);

  // Under the trigger, or over it when that has more room (the note bar sits
  // at the bottom of the canvas), capped to the room it gets so the list
  // scrolls inside instead of falling off-screen. A press outside or Escape
  // cancels, reverting the preview (hooks/useAnchoredPopover).
  const pop = useAnchoredPopover({
    open, onClose: () => close(false), anchorRef: buttonRef,
    align: align === 'right' ? 'end' : 'start', fitHeight: true,
  });

  function close(committed) {
    setOpen(false);
    if (!committed) onCancel?.();
    committedRef.current = false;
  }

  function handleHover(entry) {
    if (entry?.gfName) ensureGoogleFontLoaded(entry.gfName);
    onPreview?.(entry?.css ?? null);
  }

  function handlePick(entry) {
    if (entry?.gfName) ensureGoogleFontLoaded(entry.gfName);
    committedRef.current = true;
    onCommit?.(entry);
    setOpen(false);
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="doc-tb-pill"
        title="Font family"
        // The font it shows is in its name: "Font: Inter", not "Inter".
        aria-label={currentLabel && currentLabel !== 'Font' ? `Font: ${currentLabel}` : 'Font'}
        aria-expanded={open}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen(o => !o)}
      >
        <span className="doc-tb-pill-label">{currentLabel}</span>
        <Icon as={ChevronDown} size={12} />
      </button>

      {open && createPortal(
        <div
          ref={pop.popRef}
          className="font-pop surface-frosted"
          style={{ ...pop.style, width: POP_WIDTH }}
          onMouseLeave={() => onPreview?.(null)}
          // Rows already keep the editor's focus; a press on a section label
          // or a divider would hand it to <body> instead, which ends a note
          // edit and takes this list down with the toolbar (NOTES-14).
          onMouseDown={(e) => e.preventDefault()}
        >
          {recentFonts.length > 0 && (
            <>
              <div className="font-pop-label t-eyebrow">RECENT</div>
              {recentFonts.map(f => (
                <FontRow
                  key={'r:' + f.css}
                  entry={{ ...f, label: f.name }}
                  onHover={handleHover}
                  onPick={handlePick}
                />
              ))}
              <div className="font-pop-divider" />
            </>
          )}
          <div className="font-pop-label t-eyebrow">FONTS</div>
          {allFonts.map(f => (
            <FontRow
              key={f.key}
              entry={f}
              onHover={handleHover}
              onPick={handlePick}
            />
          ))}
          {onManage && (
            <>
              <div className="font-pop-divider" />
              <button
                type="button"
                className="font-pop-row font-pop-manage"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { committedRef.current = true; setOpen(false); onManage(); }}
              >
                + Add custom font…
              </button>
            </>
          )}
        </div>,
        document.body
      )}
    </>
  );
}

function FontRow({ entry, onHover, onPick }) {
  return (
    <button
      type="button"
      className="font-pop-row"
      style={{ fontFamily: entry.css }}
      onMouseEnter={() => onHover(entry)}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onPick(entry)}
    >
      {entry.label}
    </button>
  );
}
