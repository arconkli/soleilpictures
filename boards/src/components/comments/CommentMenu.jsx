import { useEffect, useRef } from 'react';
import { Icon } from '../Icon.jsx';
import { CommentPop } from './CommentPop.jsx';
import { t as tr } from '@lingui/core/macro';
import './commentsLook.css';

// The menu under a row's or a card's ⋯ button.
//   anchor   the button it opened from (focus goes back there on close)
//   label    what the menu is, for a screen reader
//   items    [{ key, label, icon, danger, onSelect } | { sep: true }]
//   onClose  called on Esc, a press outside, or after a pick
// ↑ ↓ Home End move; Esc closes the menu and nothing else.
export function CommentMenu({ anchor, label, items, onClose }) {
  const menuLabel = label || tr`Comment actions`;
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const first = ref.current?.querySelector('[role="menuitem"]');
    first?.focus({ preventScroll: true });
    const out = (e) => {
      if (ref.current?.contains(e.target) || anchor?.contains(e.target)) return;
      closeRef.current?.();
    };
    document.addEventListener('pointerdown', out, true);
    return () => document.removeEventListener('pointerdown', out, true);
  }, [anchor]);

  const close = (refocus = true) => {
    onClose?.();
    if (refocus) anchor?.focus?.({ preventScroll: true });
  };
  const onKeyDown = (e) => {
    const rows = [...(ref.current?.querySelectorAll('[role="menuitem"]') || [])];
    const at = rows.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'Tab') { e.preventDefault(); close(); return; }
    let next = -1;
    if (e.key === 'ArrowDown') next = (at + 1) % rows.length;
    else if (e.key === 'ArrowUp') next = (at - 1 + rows.length) % rows.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = rows.length - 1;
    if (next >= 0) { e.preventDefault(); e.stopPropagation(); rows[next]?.focus({ preventScroll: true }); }
  };

  return (
    <CommentPop anchor={anchor} place="below-end" gap={6} popRef={ref} className="cmt-menu" role="menu" aria-label={menuLabel} onKeyDown={onKeyDown}>
      {items.map((it, i) => (it.sep
        ? <div key={`sep${i}`} className="cmt-msep" role="separator" />
        : (
          <button
            key={it.key}
            type="button"
            role="menuitem"
            className={`cmt-mi${it.danger ? ' is-danger' : ''}`}
            data-cmt-item={it.key}
            onClick={() => { close(it.refocus !== false); it.onSelect?.(); }}
          >
            {it.icon && <Icon as={it.icon} size={16} weight="regular" />}
            {it.label}
          </button>
        )))}
    </CommentPop>
  );
}
