import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Anchored popover for short-text input (comments, link rename, etc).
// Positioning is viewport-aware: prefer below the anchor, flip above when
// there's no room below, clamp to the viewport horizontally.
//
// Props:
//   anchor       — DOMRect-like { left, top, right, bottom } of the source element
//   placeholder
//   multiline    — boolean
//   initialValue
//   commitLabel  — text on the post button (default 'Post')
//   busy         — disable inputs while a parent async commit is in flight
//   onCommit(text)
//   onCancel()
const PAD = 8;
const WIDTH = 320;

export function InlineComposer({
  anchor,
  placeholder = '',
  multiline = false,
  initialValue = '',
  commitLabel = 'Post',
  busy = false,
  onCommit,
  onCancel,
}) {
  const [value, setValue] = useState(initialValue);
  const [pos, setPos] = useState({ top: 0, left: 0, maxHeight: 240 });
  const popRef = useRef(null);
  const inputRef = useRef(null);

  useLayoutEffect(() => {
    if (!anchor) return;
    const measure = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const popH = popRef.current?.scrollHeight || 120;
      const spaceBelow = vh - anchor.bottom - PAD;
      const spaceAbove = anchor.top - PAD;
      const placeAbove = spaceBelow < 140 && spaceAbove > spaceBelow;
      const top = placeAbove
        ? Math.max(PAD, anchor.top - popH - PAD)
        : Math.min(vh - popH - PAD, anchor.bottom + PAD);
      const left = Math.min(
        Math.max(PAD, anchor.left),
        vw - WIDTH - PAD,
      );
      setPos({ top, left, maxHeight: Math.min(spaceBelow, vh - 2 * PAD) });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [anchor]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const submit = () => {
    const v = value.trim();
    if (!v) return;
    onCommit?.(v);
  };

  const InputEl = multiline ? 'textarea' : 'input';

  return createPortal(
    <div
      ref={popRef}
      className="inline-composer surface-frosted"
      style={{ top: pos.top, left: pos.left, width: WIDTH }}
    >
      <InputEl
        ref={inputRef}
        className="inline-composer-input"
        placeholder={placeholder}
        value={value}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !(multiline && e.shiftKey)) {
            e.preventDefault();
            submit();
          }
        }}
        rows={multiline ? 3 : undefined}
      />
      <div className="inline-composer-foot">
        <span className="inline-composer-hint t-meta">
          {multiline ? 'Shift+⏎ for newline · ⏎ to post' : '⏎ to post · Esc to cancel'}
        </span>
        <button
          className="btn-primary"
          disabled={busy || !value.trim()}
          onClick={submit}
        >
          {busy ? '…' : commitLabel}
        </button>
      </div>
    </div>,
    document.body,
  );
}
