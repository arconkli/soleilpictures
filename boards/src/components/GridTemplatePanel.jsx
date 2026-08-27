import { useState, useRef, useMemo, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
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
// PORTALED to <body> and positioned in JS, rather than absolutely placed inside
// the rail the way .cnv-add-menu is. That is not a style preference — the rail
// version was broken in two ways that no CSS could reach:
//
//   • The panel opened at the grid BUTTON's y, roughly 60% down the rail, and
//     its max-height was measured against the VIEWPORT. Measured at three normal
//     window sizes it hung 114–205px below the bottom of the screen, and because
//     the content still fit inside max-height the scroll container never
//     activated — so the last rows were both invisible and unreachable.
//   • .cnv-tools carries `transform: translateY(-50%)`, which creates a stacking
//     context, so any z-index here was scoped inside the rail and lost to
//     .cnv-depth-dock.
//
// Positioning in JS fixes both: the panel is clamped to the space that actually
// exists, so max-height is real and the list scrolls exactly when it should.
// This is the same portal-and-clamp approach .cnv-quick-add and the card context
// menus already use.
//
// On mobileShell it becomes a bottom Sheet instead: the rail already overflows on
// landscape phones and drives its own scroll with a pointer gesture, so it
// cannot host a tall flyout at all.

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

// Keep clear of the viewport edges, and never render a panel so short that the
// list inside it is useless — below this we reposition rather than shrink.
const EDGE = 12;
const MIN_H = 260;
const MAX_H = 600;

export function GridTemplatePanel({
  open, onClose, sections, onPick, applyTargetId, mobileShell,
  rowActions = null, onSaveCurrent = null, anchorRef = null,
}) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(-1);
  const [box, setBox] = useState(null);
  const scrollRef = useRef(null);

  // Place against the live rail button. useLayoutEffect so the panel is never
  // painted at a stale position, and re-run on resize because the rail is
  // vertically centred — every window change moves the anchor.
  useLayoutEffect(() => {
    if (!open || mobileShell) return undefined;
    const place = () => {
      const a = anchorRef?.current?.getBoundingClientRect();
      if (!a) return;
      const vh = window.innerHeight;
      const below = vh - a.top - EDGE;
      // Prefer aligning with the button. When there isn't room for a usable
      // list below it, sit the panel against the bottom edge instead of
      // squeezing it into a sliver.
      const maxHeight = below >= MIN_H
        ? Math.min(MAX_H, below)
        : Math.min(MAX_H, vh - EDGE * 2);
      const top = below >= MIN_H
        ? a.top
        : Math.max(EDGE, vh - EDGE - maxHeight);
      setBox({ left: Math.round(a.right + 8), top: Math.round(top), maxHeight: Math.round(maxHeight) });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, mobileShell, anchorRef]);

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

  // Nothing to render until the anchor has been measured — one frame, and it
  // avoids a flash at the top-left corner.
  if (!box) return null;

  return createPortal(
    <div
      className="cnv-tpl-panel"
      role="menu"
      aria-label="Templates"
      style={{ left: box.left, top: box.top, maxHeight: box.maxHeight }}
    >
      {body}
    </div>,
    document.body,
  );
}
