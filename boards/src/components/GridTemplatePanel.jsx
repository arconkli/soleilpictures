import { useState } from 'react';
import { GridLayoutThumb } from './GridLayoutThumb.jsx';
import { filterSections } from '../lib/gridLayoutLibrary.js';
import { Sheet } from './shell/Sheet.jsx';
import './gridTemplatePanel.css';

// The Templates panel — the grid tool's flyout.
//
// Clicking a template does one of two things, and which one is decided by what
// is already selected, not by a mode the user has to set:
//   • a grid is selected → re-cut THAT grid (and its linked family) in place
//   • nothing is selected → arm the placer; the next canvas click drops a new
//     grid with this shape
// The header says which is about to happen, because "apply" and "place" are very
// different outcomes and the panel looks identical either way.
//
// Presentation only: it renders the rows it is handed and calls onPick. The
// catalogue lives in lib/gridLayoutLibrary.js and the mutation in
// App.applyGridLayout, so this file has no opinion about where a template came
// from — built-in today, database rows in the next phase.
//
// Anchored to the rail on desktop, exactly like .cnv-add-menu. On mobileShell it
// becomes a bottom Sheet: the rail already overflows on landscape phones and
// drives its own scroll with a pointer gesture, so it cannot host a tall flyout.

// Below this many rows a search field is noise; above it, scanning gets hard.
const SEARCH_THRESHOLD = 12;

function TemplateGrid({ sections, onPick }) {
  return sections.map((section) => (
    <div className="tplt-section" key={section.id}>
      <div className="tplt-section-head" aria-hidden="true">{section.title}</div>
      <div className="tplt-rows">
        {section.rows.map((row) => (
          <button
            key={row.key}
            type="button"
            role="menuitem"
            // Explicit label so the accessible name stays exactly the template
            // name. Without it Chromium folds any tooltip ::after content into
            // the name and breaks getByRole lookups — see the same note on the
            // + menu in CanvasSurface.
            aria-label={row.name}
            className="tplt-row"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onPick(row)}
          >
            <GridLayoutThumb tree={row.tree} title={row.name} />
            <span className="tplt-name">{row.name}</span>
          </button>
        ))}
      </div>
    </div>
  ));
}

export function GridTemplatePanel({ open, onClose, sections, onPick, applyTargetId, mobileShell }) {
  const [query, setQuery] = useState('');
  if (!open) return null;

  const total = sections.reduce((n, s) => n + s.rows.length, 0);
  const shown = filterSections(sections, query);
  const applying = !!applyTargetId;
  const hint = applying
    ? 'Replaces the selected grid’s layout.'
    : 'Pick a layout, then click the canvas.';

  const pick = (row) => { onClose?.(); onPick?.(row); };

  const body = (
    <>
      <div className="tplt-hint">{hint}</div>
      {total > SEARCH_THRESHOLD && (
        <input
          className="tplt-search"
          type="search"
          value={query}
          placeholder="Search templates"
          aria-label="Search templates"
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      {shown.length === 0
        ? <div className="tplt-empty">No templates match “{query}”.</div>
        : <TemplateGrid sections={shown} onPick={pick} />}
    </>
  );

  if (mobileShell) {
    return <Sheet open={open} onClose={onClose} title="Templates" snap="half">{body}</Sheet>;
  }

  return (
    <div className="cnv-tpl-panel" role="menu" aria-label="Templates">
      {body}
    </div>
  );
}
