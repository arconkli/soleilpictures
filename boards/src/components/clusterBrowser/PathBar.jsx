// The path inside Files beside the board: where the panel is browsing, as
// clickable steps (root … parent / here), with Back for the panel's own
// history, a ▾ on the current step that lists the clusters inside it, and
// "Go to cluster…" to jump anywhere. Browsing here never moves the board —
// the topbar breadcrumb still says where the board is.

import { useMemo, useRef, useState } from 'react';
import { Icon } from '../Icon.jsx';
import { ChevronLeft, ChevronDown, Compass, Folder, Eye } from '../../lib/icons.js';
import { collapsePath, ELLIPSIS } from '../../lib/filesDock.js';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside.js';

const byName = (a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });

export function PathBar({ path = [], boards = {}, onNavigate, onBack, canBack = false, onGoTo = null, readOnly = false }) {
  const steps = collapsePath(path, 3);
  const last = path[path.length - 1];
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  useDismissOnOutside(menuRef, open, () => setOpen(false), { ignore: '[data-menu-trigger="path"]' });
  const inside = useMemo(
    () => Object.values(boards || {}).filter((b) => b && b.parent_board_id === last).sort(byName),
    [boards, last],
  );
  const hereName = boards[last]?.name || 'Untitled cluster';
  return (
    <nav className="pb" aria-label="Files path">
      {canBack && (
        <button type="button" className="cbt-iconbtn pb-back" onClick={onBack} aria-label="Back" title="Back">
          <Icon as={ChevronLeft} size={15} />
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
                <button type="button" className="pb-name pb-link" onClick={() => onNavigate?.(id)} title={name}>{name}</button>
              ) : inside.length ? (
                <button type="button" className="pb-name pb-here" data-menu-trigger="path"
                        aria-current="location" aria-haspopup="menu" aria-expanded={open}
                        title={`Clusters in ${name}`} onClick={() => setOpen((o) => !o)}>
                  <span className="pb-here-text">{name}</span>
                  <span className="pb-caret" aria-hidden="true"><Icon as={ChevronDown} size={11} /></span>
                </button>
              ) : (
                <span className="pb-name pb-here" aria-current="location" title={name}>{name}</span>
              )}
            </li>
          );
        })}
      </ol>
      {readOnly && (
        <span className="cbt-ro" title="Open this cluster to add or change files">
          <Icon as={Eye} size={11} />View only
        </span>
      )}
      {onGoTo && (
        <button type="button" className="cbt-iconbtn pb-goto" onClick={onGoTo} aria-label="Go to cluster" title="Go to cluster…">
          <Icon as={Compass} size={14} />
        </button>
      )}
      {open && (
        <div className="cbt-menu pb-menu" ref={menuRef} role="menu" aria-label={`Clusters in ${hereName}`}>
          <div className="cbt-menu-label">In {hereName}</div>
          {inside.map((b) => (
            <button key={b.id} type="button" role="menuitem" className="ctx-item pb-menu-item"
                    onClick={() => { setOpen(false); onNavigate?.(b.id); }}>
              <span className="pb-menu-ico" aria-hidden="true"><Icon as={Folder} size={14} /></span>
              <span className="pb-menu-name">{b.name || 'Untitled cluster'}</span>
              {Number.isFinite(b.card_count) && <span className="cbt-count">{b.card_count}</span>}
            </button>
          ))}
        </div>
      )}
    </nav>
  );
}
