// AdminUserRowMenu — per-user overflow (kebab) menu in the Users tab.
//
// Renders Ban/Unban (toggles on row.banned), Re-sync billing (only when the
// user has a subscription on file), and Delete. The parent owns the actual
// handlers (confirm dialogs + edge-fn calls + refresh); this just renders the
// menu, closes on outside-click / Escape, and shows a busy state.

import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/Icon.jsx';
import { DotsThreeVertical, Lock, Trash2, ArrowsClockwise } from '../../lib/icons.js';

export function AdminUserRowMenu({ row, disabled, busy, onBan, onUnban, onResync, onDelete }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const run = (fn) => () => { setOpen(false); fn?.(row); };
  const hasSub = !!row.subscription_status;

  return (
    <div className="admin-rowmenu" ref={ref}>
      <button
        type="button"
        className="admin-rowmenu-trigger"
        aria-label={`Actions for ${row.email}`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled || busy}
        onClick={() => setOpen((o) => !o)}
      >
        {busy ? '…' : <Icon as={DotsThreeVertical} size={18} />}
      </button>

      {open && (
        <div className="admin-rowmenu-pop" role="menu">
          {row.banned ? (
            <button type="button" className="admin-rowmenu-item" role="menuitem" onClick={run(onUnban)}>
              <Icon as={Lock} size={14} /> Unban account
            </button>
          ) : (
            <button type="button" className="admin-rowmenu-item" role="menuitem" onClick={run(onBan)}>
              <Icon as={Lock} size={14} /> Ban account
            </button>
          )}
          {hasSub && (
            <button type="button" className="admin-rowmenu-item" role="menuitem" onClick={run(onResync)}>
              <Icon as={ArrowsClockwise} size={14} /> Re-sync billing
            </button>
          )}
          <div className="admin-rowmenu-sep" />
          <button type="button" className="admin-rowmenu-item admin-rowmenu-item-danger" role="menuitem" onClick={run(onDelete)}>
            <Icon as={Trash2} size={14} /> Delete account
          </button>
        </div>
      )}
    </div>
  );
}
