// The path inside Files beside the board: where the panel is browsing, as
// clickable steps (root … parent / here), with Back for the panel's own
// history and a ▾ on the current step that lists the clusters inside it, then
// "Go to cluster…" to jump anywhere. Browsing here never moves the board —
// the topbar breadcrumb still says where the board is.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../Icon.jsx';
import { ChevronLeft, ChevronDown } from '../../lib/icons.js';
import { COVER_TINTS } from '../primitives.jsx';
import { collapsePath, ELLIPSIS } from '../../lib/filesDock.js';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside.js';

const byName = (a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });

export function PathBar({ path = [], boards = {}, onNavigate, onBack, canBack = false, onGoTo = null, readOnly = false }) {
  const steps = collapsePath(path, 3);
  const last = path[path.length - 1];
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  const triggerRef = useRef(null);
  useDismissOnOutside(menuRef, open, () => setOpen(false), { ignore: '[data-menu-trigger="path"]' });
  // Somewhere else now (Back, a step, Go to cluster): the old list is stale.
  useEffect(() => { setOpen(false); }, [last]);
  // Opened, focus goes into the list, so ↑ ↓ and Enter work straight away.
  useEffect(() => {
    if (open) menuRef.current?.querySelector('[role="menuitem"]')?.focus();
  }, [open]);
  const onMenuKey = (e) => {
    const items = [...(menuRef.current?.querySelectorAll('[role="menuitem"]') || [])];
    const i = items.indexOf(document.activeElement);
    const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 }[e.key];
    if (to !== undefined && items.length) {
      e.preventDefault();
      items[(to + items.length) % items.length].focus();
    } else if (e.key === 'Escape') {
      triggerRef.current?.focus();
      setOpen(false);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };
  const inside = useMemo(
    () => Object.values(boards || {}).filter((b) => b && b.parent_board_id === last).sort(byName),
    [boards, last],
  );
  const hereName = boards[last]?.name || 'Untitled cluster';
  return (
    <nav className="pb" aria-label="Files path">
      {canBack && (
        <button type="button" className="cbt-iconbtn pb-back" onClick={onBack} aria-label="Back" title="Back">
          <Icon as={ChevronLeft} size={16} weight="light" />
        </button>
      )}
      <ol className="pb-list">
        {steps.map((id, i) => {
          if (id === ELLIPSIS) return <li key={`gap-${i}`} className="pb-gap" aria-hidden="true">…</li>;
          const name = boards[id]?.name || 'Untitled cluster';
          const here = id === last;
          return (
            <li key={id} className={`pb-step${here ? ' is-here' : ''}`}>
              {!here ? (
                <button type="button" className="pb-name pb-link" onClick={() => onNavigate?.(id)} title={name}><span className="pb-text">{name}</span></button>
              ) : inside.length || onGoTo ? (
                <button type="button" className="pb-name pb-here" data-menu-trigger="path" ref={triggerRef}
                        aria-current="location" aria-haspopup="menu" aria-expanded={open}
                        title={inside.length ? `Clusters in ${name}` : 'Go to cluster…'} onClick={() => setOpen((o) => !o)}>
                  <span className="pb-here-text">{name}</span>
                  <span className="pb-caret" aria-hidden="true"><Icon as={ChevronDown} size={12} weight="light" /></span>
                </button>
              ) : (
                <span className="pb-name pb-here" aria-current="location" title={name}><span className="pb-text">{name}</span></span>
              )}
            </li>
          );
        })}
      </ol>
      {/* Straight after the path, so it's next in reading order to its ▾. */}
      {open && (
        <div className="cbt-menu pb-menu" ref={menuRef} role="menu" aria-label={inside.length ? `Clusters in ${hereName}` : 'Go to cluster'}
             onKeyDown={onMenuKey}>
          {inside.length > 0 && <div className="cbt-menu-label">In {hereName}</div>}
          {inside.map((b) => (
            <button key={b.id} type="button" role="menuitem" tabIndex={-1} className="ctx-item pb-menu-item"
                    onClick={() => { setOpen(false); onNavigate?.(b.id); }}>
              <span className="pb-menu-ico" aria-hidden="true">
                <span className="pb-menu-dot" style={{ background: COVER_TINTS[b.cover === 'sun' ? 'sand' : b.cover] || COVER_TINTS.neutral }} />
              </span>
              <span className="pb-menu-name">{b.name || 'Untitled cluster'}</span>
              {Number.isFinite(b.card_count) && <span className="cbt-count">{b.card_count}</span>}
            </button>
          ))}
          {onGoTo && (
            <>
              {inside.length > 0 && <div className="ctx-divider" role="separator" />}
              <button type="button" role="menuitem" tabIndex={-1} className="ctx-item pb-menu-item pb-menu-goto"
                      onClick={() => { setOpen(false); onGoTo(); }}>
                <span className="pb-menu-name">Go to cluster…</span>
              </button>
            </>
          )}
        </div>
      )}
      {readOnly && (
        <span className="cbt-ro" title="Open this cluster to add or change files">View only</span>
      )}
    </nav>
  );
}
