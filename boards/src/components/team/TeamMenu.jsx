// TeamMenu — the Team page's small floating menu (role choices, a row's "…",
// the header's "…"). Its look is the sidebar's .sbf-upmenu / .sbf-upitem,
// copied into team.css as .tp-menu so the page never imports clusterSidebar.css.
// Rendered inside its trigger's position:relative wrapper.
import { useEffect, useRef } from 'react';
import { Icon } from '../Icon.jsx';
import { Check } from '../../lib/icons.js';

export function TeamMenu({ items, onPick, onClose, align = 'left' }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    const wrap = el?.parentElement;
    const trigger = wrap?.querySelector('button');
    const first = el?.querySelector('button:not(:disabled)');
    first?.focus();
    // Outside pointerdown closes; the trigger's own click toggles, so it is "inside".
    const down = (e) => { if (wrap && !wrap.contains(e.target)) onClose?.(); };
    // Esc closes the menu and goes no further, so the page stays open.
    const key = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose?.();
    };
    document.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
      const a = document.activeElement;
      if (trigger && trigger.isConnected && (!a || a === document.body || el?.contains(a))) trigger.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const btns = [...ref.current.querySelectorAll('button:not(:disabled)')];
    if (!btns.length) return;
    e.preventDefault();
    const i = btns.indexOf(document.activeElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % btns.length : (i <= 0 ? btns.length - 1 : i - 1);
    btns[next].focus();
  };

  return (
    <div ref={ref} className={`tp-menu${align === 'right' ? ' is-right' : ''}`} role="menu" onKeyDown={onKeyDown}>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          role="menuitem"
          className={`tp-menu-item${it.danger ? ' is-danger' : ''}`}
          disabled={it.disabled}
          onClick={() => { onPick?.(it.id); onClose?.(); }}
        >
          <span className="tp-menu-check" aria-hidden="true">
            {it.checked ? <Icon as={Check} size={12} weight="regular" /> : null}
          </span>
          {it.label}
        </button>
      ))}
    </div>
  );
}
