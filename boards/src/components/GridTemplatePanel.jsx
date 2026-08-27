import { useState, useRef } from 'react';
import { GridLayoutThumb } from './GridLayoutThumb.jsx';
import { filterSections, SOURCES } from '../lib/gridLayoutLibrary.js';
import { useDismissOnOutside } from '../hooks/useDismissOnOutside.js';
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
// Presentation only: it renders the rows it is handed, calls onPick, and asks
// the parent what a row's actions are. The catalogue lives in
// lib/gridLayoutLibrary.js, the mutation in App.applyGridLayout, and the
// persistence in lib/gridLayoutsApi.js — so this file still has no opinion about
// where a template came from or what saving one means.
//
// Anchored to the rail on desktop, exactly like .cnv-add-menu. On mobileShell it
// becomes a bottom Sheet: the rail already overflows on landscape phones and
// drives its own scroll with a pointer gesture, so it cannot host a tall flyout.

// Below this many rows a search field is noise; above it, scanning gets hard.
// Ten built-ins sit under the line, so the field appears once you have saved a
// few of your own — which is also the point at which names stop being scannable.
const SEARCH_THRESHOLD = 12;

function TemplateRow({ row, onPick, rowActions }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef(null);
  useDismissOnOutside(wrapRef, menuOpen, () => setMenuOpen(false));

  // Built-ins have no actions — you cannot rename or delete something that
  // ships in the bundle. gridLayoutLibrary's SOURCES comment says as much.
  const actions = row.source === SOURCES.BUILTIN ? [] : (rowActions?.(row) || []);

  return (
    <div className="tplt-row-wrap" ref={wrapRef}>
      <button
        type="button"
        role="menuitem"
        // Explicit label so the accessible name stays exactly the template name.
        // Without it Chromium folds any tooltip ::after content into the name and
        // breaks getByRole lookups — the same note as on the + menu in
        // CanvasSurface. The actions trigger below is a SIBLING, not a child,
        // because a <button> may not contain a <button>.
        aria-label={row.name}
        className="tplt-row"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => onPick(row)}
      >
        <GridLayoutThumb tree={row.tree} title={row.name} />
        <span className="tplt-name">{row.name}</span>
      </button>

      {actions.length > 0 && (
        <button
          type="button"
          className="tplt-row-more"
          aria-label={`Actions for ${row.name}`}
          aria-expanded={menuOpen}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setMenuOpen((o) => !o)}
        >
          <span aria-hidden="true">···</span>
        </button>
      )}

      {menuOpen && (
        <div className="tplt-row-menu" role="menu" aria-label={`${row.name} actions`}>
          {actions.map((a) => (
            <button
              key={a.id}
              type="button"
              role="menuitem"
              aria-label={a.label}
              className={a.danger ? 'is-danger' : undefined}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => { setMenuOpen(false); a.run(); }}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TemplateGrid({ sections, onPick, rowActions }) {
  return sections.map((section) => (
    <div className="tplt-section" key={section.id}>
      <div className="tplt-section-head" aria-hidden="true">{section.title}</div>
      <div className="tplt-rows">
        {section.rows.map((row) => (
          <TemplateRow key={row.key} row={row} onPick={onPick} rowActions={rowActions} />
        ))}
      </div>
    </div>
  ));
}

export function GridTemplatePanel({
  open, onClose, sections, onPick, applyTargetId, mobileShell,
  rowActions = null, onSaveCurrent = null,
}) {
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
        : <TemplateGrid sections={shown} onPick={pick} rowActions={rowActions} />}
      {/* Saving is offered only when there is something to save — the shape of
          the grid you have selected. Offering it with nothing selected would be
          a button that can only ever explain why it doesn't work. */}
      {applying && onSaveCurrent && (
        <button
          type="button"
          className="tplt-save"
          aria-label="Save this grid as a template"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => { onClose?.(); onSaveCurrent(); }}
        >
          Save this grid as a template…
        </button>
      )}
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
