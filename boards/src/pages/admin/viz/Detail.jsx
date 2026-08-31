// Detail — a collapsed section for the long tail of a view.
//
// This is the answer to the widget wall. EngagementView rendered nineteen
// panels in a flat vertical stack, all at identical visual weight, so the view
// had no opinion about what mattered and you scrolled past the important thing
// to reach the thing you were looking for.
//
// Cutting all nineteen would have lost real measurements. Ranking them costs
// nothing: three or four panels answer the view's question and stay open, the
// rest live in here. Nothing is deleted, and the default screen is quiet.
//
// Open state persists per key, because someone who keeps a section open is
// telling you it belongs above the fold — and that is worth knowing before the
// next round of cuts.

import { useCallback, useState } from 'react';

const LS_PREFIX = 'admin.detail.';

function readOpen(key, fallback) {
  try {
    const v = window.localStorage.getItem(LS_PREFIX + key);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch { /* ignore */ }
  return fallback;
}

export function Detail({ id, label = 'More detail', count, defaultOpen = false, children }) {
  const [open, setOpen] = useState(() => readOpen(id, defaultOpen));

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      try { window.localStorage.setItem(LS_PREFIX + id, next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  }, [id]);

  return (
    <section className="adm-detail">
      <button
        type="button"
        className={`adm-detail-trigger ${open ? 'is-open' : ''}`}
        aria-expanded={open}
        onClick={toggle}
      >
        <span className="adm-detail-caret" aria-hidden="true">▸</span>
        <span>{label}</span>
        {count != null && <span className="adm-detail-count">{count}</span>}
      </button>
      {/* Unmounted, not hidden — these panels each run their own RPCs, and a
          display:none section that still fetches is the firehose again. */}
      {open && <div className="adm-detail-body">{children}</div>}
    </section>
  );
}
