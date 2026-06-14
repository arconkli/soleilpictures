// AdminMoreMenu — the "More ▾" overflow in the admin top nav.
//
// Folds the long tail of rarely-touched admin sections into one dropdown so the
// header shows only the daily/frequent tabs as pills. Structurally a sibling of
// AdminUserRowMenu (same popup CSS), but it lives INSIDE the role="tablist" as
// the last roving control and reuses the canonical outside-tap/Escape dismiss.
//
// When the active section is one of the buried items, the trigger relabels to
// that section's name + takes .is-active, so the active indicator is never lost.

import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/Icon.jsx';
import { ChevronDown, ChevronUp, Check } from '../../lib/icons.js';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside.js';

export function AdminMoreMenu({
  items,              // [{ id, label, heavy?, sepAfter? }] in display order
  activeId,           // current admin tab id
  isActive,           // true when activeId is one of `items` (buried-active)
  activeLabel,        // label to show on the trigger when isActive
  onSelect,           // = selectTab(id)
  rovingTabIndex,     // 0 when the More trigger owns roving focus, else -1
  onTriggerKeyDown,   // bar-level roving handler (ArrowLeft/Right/Home/End)
  triggerRef,         // ref the parent uses to focus the trigger during roving
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const rowRefs = useRef([]);

  const close = (refocus = false) => {
    setOpen(false);
    if (refocus) triggerRef?.current?.focus();
  };

  // Outside pointer/tap dismiss only (no refocus — the user is acting
  // elsewhere). Escape is handled on the focused control instead, so it can
  // return focus to the trigger rather than dropping it to <body>.
  useDismissOnOutside(wrapRef, open, () => close(false), { escape: false });

  // On open, land focus on the active row if one is buried here, else the first.
  useEffect(() => {
    if (!open) return;
    const activeIdx = items.findIndex((it) => it.id === activeId);
    const idx = activeIdx >= 0 ? activeIdx : 0;
    rowRefs.current[idx]?.focus();
  }, [open, items, activeId]);

  const onTriggerKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);              // effect moves focus into the menu
    } else if (e.key === 'Escape') {
      if (open) { e.preventDefault(); close(true); }
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
      onTriggerKeyDown?.(e);      // hand back to the bar's roving handler
    }
    // Enter / Space fall through to the button's native click → toggle.
  };

  const onRowKey = (e, idx) => {
    if (e.key === 'Escape') { e.preventDefault(); close(true); return; }
    const last = items.length - 1;
    let next = null;
    if (e.key === 'ArrowDown') next = idx >= last ? 0 : idx + 1;
    else if (e.key === 'ArrowUp') next = idx <= 0 ? last : idx - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    if (next == null) return;
    e.preventDefault();
    rowRefs.current[next]?.focus();
  };

  // Close + return focus to the trigger (which now represents the active
  // section), then switch tabs. Keyboard Enter keeps a visible focus ring;
  // a mouse click suppresses it via :focus-visible heuristics.
  const pick = (id) => () => { close(true); onSelect(id); };

  return (
    <div className="admin-rowmenu admin-moremenu" ref={wrapRef}>
      <button
        type="button"
        ref={triggerRef}
        role="tab"
        aria-selected={isActive}
        aria-haspopup="menu"
        aria-expanded={open}
        tabIndex={rovingTabIndex}
        className={`admin-tab admin-tab-more ${isActive ? 'is-active' : ''}`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onTriggerKey}
      >
        {isActive ? activeLabel : 'More'}
        <Icon as={open ? ChevronUp : ChevronDown} size={12} />
      </button>

      {open && (
        <div className="admin-rowmenu-pop" role="menu">
          {items.map((it, i) => {
            const rowActive = it.id === activeId;
            return (
              <div key={it.id} className="admin-moremenu-row-wrap">
                <button
                  type="button"
                  ref={(el) => { rowRefs.current[i] = el; }}
                  className={`admin-rowmenu-item ${rowActive ? 'is-active' : ''}`}
                  role="menuitem"
                  aria-current={rowActive ? 'true' : undefined}
                  onClick={pick(it.id)}
                  onKeyDown={(e) => onRowKey(e, i)}
                >
                  <span className="admin-moremenu-label">{it.label}</span>
                  {it.heavy && <span className="admin-rowmenu-hint">heavy</span>}
                  {rowActive && <Icon as={Check} size={13} />}
                </button>
                {it.sepAfter && <div className="admin-rowmenu-sep" />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
