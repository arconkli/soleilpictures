// The path inside Files beside the board: where the panel is browsing, as
// clickable steps (root … parent / here), with Back for the panel's own
// history and "Go to cluster…" to jump anywhere. Browsing here never moves the
// board — the topbar breadcrumb still says where the board is.

import { Icon } from '../Icon.jsx';
import { ChevronLeft, Search } from '../../lib/icons.js';
import { collapsePath, ELLIPSIS } from '../../lib/filesDock.js';

export function PathBar({ path = [], boards = {}, onNavigate, onBack, canBack = false, onGoTo = null }) {
  const steps = collapsePath(path, 3);
  const last = path[path.length - 1];
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
              {here
                ? <span className="pb-name" aria-current="location" title={name}>{name}</span>
                : <button type="button" className="pb-name pb-link" onClick={() => onNavigate?.(id)} title={name}>{name}</button>}
            </li>
          );
        })}
      </ol>
      {onGoTo && (
        <button type="button" className="cbt-iconbtn pb-goto" onClick={onGoTo} aria-label="Go to cluster" title="Go to cluster…">
          <Icon as={Search} size={14} />
        </button>
      )}
    </nav>
  );
}
