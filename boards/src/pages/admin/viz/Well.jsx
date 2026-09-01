// Well — a plot is a screen set into a console, not a region of the page.
//
// This replaces the `.admin-chart-panel` + `.admin-chart-head` pairing for
// anything that draws marks. Three things change, and each is deliberate:
//
//   1. THE GROUND IS THE SAME IN BOTH THEMES. A near-black plot surface
//      (`--adm-plot`) with its own graph-paper ruling. Marks inside it use the
//      dark palette steps regardless of theme, because the surface under them
//      is dark regardless of theme — `.adm-well` in admin.css re-declares those
//      steps locally, so no drawing code here or anywhere else knows about it.
//      It also retires a whole bug class: the palette now only has to clear its
//      floors against ONE chart surface instead of two, and the failure that
//      started all of this (every hue at 1.7-2.3:1 in light mode) cannot recur.
//
//   2. THE TITLE MOVES INSIDE THE PLOT, as a 10px micro-cap instrument label.
//      Denser than a bordered header row above the chart, and it is most of
//      what makes the thing read as a readout.
//
//   3. IT IS THE GRID CHILD. `span` places it on the 12-column deck directly,
//      so there is no wrapper element between the grid and the plot. The old
//      `.admin-chart-panel-wide` tried to do this and silently did nothing on
//      almost every panel that used it, because those panels were not grid
//      children at all.
//
// Panels that are prose, tables or lists do NOT belong in a well — see the
// scope warning on the `.adm-well` rule. They stay on the themed page.

import { AdminAsync } from '../AdminStates.jsx';

/**
 * @param {number}  span    columns on the 12-wide deck (default full width)
 * @param {string}  title   instrument label, top-left inside the plot
 * @param {node}    meta    right-aligned readout — population, window, units
 * @param {node}    foot    a line under the plot: legend, caption, sample size
 * @param {boolean} flush   drop the internal padding (the heatmap rules its own)
 */
export function Well({
  span, title, meta, foot, flush = false, className = '', children, ...rest
}) {
  const cls = [
    'adm-well',
    span ? `adm-c${span}` : '',
    flush ? 'is-flush' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <section className={cls} {...rest}>
      {(title || meta) && (
        <div className="adm-well-head">
          {title ? <span className="adm-well-title">{title}</span> : <span />}
          {meta ? <span className="adm-well-meta">{meta}</span> : null}
        </div>
      )}
      <div className="adm-well-body">{children}</div>
      {foot ? <div className="adm-well-foot">{foot}</div> : null}
    </section>
  );
}

/**
 * Plate — the well's themed sibling, for panels that are not plots.
 *
 * People lists, tables, the honesty bullets. Same radius, same corner ticks,
 * same head/meta/foot, same mono numerals — on the page's own surface instead
 * of a plot ground. Reversing a twelve-row table or six paragraphs onto
 * near-black is heavy and none of it needs graph paper underneath; what makes
 * the page cohere is the geometry, not painting everything black.
 *
 * Identical API to Well, deliberately: swapping one for the other is a one-word
 * edit when a panel turns out to be the other kind of thing.
 */
export function Plate({
  span, title, meta, foot, className = '', children, ...rest
}) {
  const cls = ['adm-plate', span ? `adm-c${span}` : '', className].filter(Boolean).join(' ');
  return (
    <section className={cls} {...rest}>
      {(title || meta) && (
        <div className="adm-well-head">
          {title ? <span className="adm-well-title">{title}</span> : <span />}
          {meta ? <span className="adm-well-meta">{meta}</span> : null}
        </div>
      )}
      <div className="adm-well-body">{children}</div>
      {foot ? <div className="adm-well-foot">{foot}</div> : null}
    </section>
  );
}

/**
 * A well whose contents are still loading.
 *
 * Worth having rather than wrapping AdminAsync by hand at every call site: the
 * skeleton has to be INSIDE the well, or a deck of eight instruments reflows
 * every time one of them resolves, and the whole page jumps for two seconds on
 * every 30-second poll.
 */
export function AsyncWell({ query, span, title, meta, foot, children, ...rest }) {
  return (
    <Well span={span} title={title} meta={meta} foot={foot} {...rest}>
      <AdminAsync
        loading={query.loading}
        error={query.error}
        onRetry={query.refresh}
        skeleton={<div className="adm-well-skeleton" />}
      >
        {children}
      </AdminAsync>
    </Well>
  );
}

/** The 12-column deck itself. Children carry their own `adm-c*` span. */
export function Deck({ className = '', children }) {
  return <div className={`adm-deck ${className}`.trim()}>{children}</div>;
}
