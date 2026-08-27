import { useState, useRef, useMemo, useEffect } from 'react';
import { GridLayoutThumb } from './GridLayoutThumb.jsx';
import { filterSections, SOURCES } from '../lib/gridLayoutLibrary.js';
import { useDismissOnOutside } from '../hooks/useDismissOnOutside.js';
import { Sheet } from './shell/Sheet.jsx';
import './gridTemplatePanel.css';

// The Templates panel — the grid tool's flyout.
//
// The tool ARMS the placer and opens this at the same time, so the panel refines
// what gets placed rather than gating it: click straight through for the default
// storyboard, or pick a shape first and that shape lands instead. What clicking
// a template does then depends on what is selected:
//   • a grid is selected → re-cut THAT grid (and its linked family) in place
//   • nothing is selected → the armed placer drops a new grid with this shape
// The header says which is about to happen, because "apply" and "place" are very
// different outcomes and the panel looks identical either way.
//
// Layout is a FIXED HEADER over a SCROLLING BODY. That is not cosmetic: the
// search field and the "what will this do" hint are the two things you need
// while scrolling a long list, so they must not scroll away — and the body being
// its own container is what .tplt-scroll hooks in touchScroll.js attaches to.
//
// Presentation only: it renders the rows it is handed, calls onPick, and asks
// the parent what a row's actions are.
//
// Anchored to the rail on desktop, exactly like .cnv-add-menu. On mobileShell it
// becomes a bottom Sheet: the rail already overflows on landscape phones and
// drives its own scroll with a pointer gesture, so it cannot host a tall flyout.

function TemplateRow({ row, onPick, rowActions, active, onHover }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef(null);
  useDismissOnOutside(wrapRef, menuOpen, () => setMenuOpen(false));

  // Built-ins have no actions — you cannot rename or delete something that
  // ships in the bundle. gridLayoutLibrary's SOURCES comment says as much.
  const actions = row.source === SOURCES.BUILTIN ? [] : (rowActions?.(row) || []);

  return (
    <div className={`tplt-row-wrap${active ? ' is-active' : ''}`} ref={wrapRef}>
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
        onMouseEnter={onHover}
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

export function GridTemplatePanel({
  open, onClose, sections, onPick, applyTargetId, mobileShell,
  rowActions = null, onSaveCurrent = null,
}) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(-1);
  const scrollRef = useRef(null);

  const shown = useMemo(() => filterSections(sections, query), [sections, query]);
  // One flat list of every visible row, so arrow keys can cross section
  // boundaries the way a person expects — the headings are labels, not walls.
  const flat = useMemo(() => shown.flatMap((s) => s.rows), [shown]);

  // A stale cursor after filtering would highlight nothing and Enter would pick
  // nothing; reset to the first match so typing-then-Enter always works.
  useEffect(() => { setCursor(flat.length ? 0 : -1); }, [query, flat.length]);
  useEffect(() => { if (!open) { setQuery(''); setCursor(-1); } }, [open]);

  // Keep the highlighted row in view when it moved by keyboard rather than mouse.
  useEffect(() => {
    if (cursor < 0 || !scrollRef.current) return;
    const el = scrollRef.current.querySelector(`[data-row-index="${cursor}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  if (!open) return null;

  const applying = !!applyTargetId;
  const hint = applying
    ? 'Replaces the selected grid’s layout.'
    : 'Click the canvas to place, or pick a shape first.';

  const pick = (row) => { onClose?.(); onPick?.(row); };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!flat.length) return;
      const d = e.key === 'ArrowDown' ? 1 : -1;
      setCursor((c) => (c + d + flat.length) % flat.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (flat[cursor]) pick(flat[cursor]);
    }
    // Escape is deliberately not handled: the window-level dismissal ladder owns
    // it, and a local handler double-steps (keydown is a discrete event, so the
    // ladder re-registers mid-press and the same press hits the next rung too).
  };

  let i = -1; // running index across sections, matching `flat`

  const body = (
    <>
      <div className="tplt-head">
        <div className="tplt-hint">{hint}</div>
        <input
          className="tplt-search"
          type="search"
          value={query}
          placeholder="Search templates"
          aria-label="Search templates"
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={onKeyDown}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="tplt-scroll" ref={scrollRef} onKeyDown={onKeyDown}>
        {shown.length === 0
          ? <div className="tplt-empty">No templates match “{query}”.</div>
          : shown.map((section) => (
            <div className="tplt-section" key={section.id}>
              <div className="tplt-section-head" aria-hidden="true">{section.title}</div>
              <div className="tplt-rows">
                {section.rows.map((row) => {
                  i += 1;
                  const idx = i;
                  return (
                    <div data-row-index={idx} key={row.key}>
                      <TemplateRow
                        row={row}
                        onPick={pick}
                        rowActions={rowActions}
                        active={idx === cursor}
                        onHover={() => setCursor(idx)}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
      </div>

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
