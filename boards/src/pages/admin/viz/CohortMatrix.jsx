// CohortMatrix — signup week x weeks-since-signup, as a grid.
//
// A cohort table was deleted from this dashboard once already, and correctly:
// at daily granularity the cohorts were 5-30 people and its own header called
// it the worst small-N offender on the page. What changed is the denominator.
// Weekly cohorts now run 25-51 for thirteen consecutive weeks, which is enough
// to read, and weekly offsets stop treating "was busy Tuesday, not Wednesday"
// as churn.
//
// THREE CELL STATES, because there are three, and collapsing any two of them
// into one is how cohort charts lie:
//
//   absent   the cohort has not lived that long yet. Nothing is drawn. Filling
//            the upper triangle with 0% invents a churn cliff out of the
//            future — the single most common cohort-chart mistake.
//
//   zero     measured, and nobody came back. A real, dark, drawn cell.
//
//   unknown  the week began before did_work instrumentation existed
//            (2026-08-17; see the header of migration 0248, which decided not
//            to backfill it and said why). Hatched, never coloured. Without
//            this, eleven of thirteen rows read 0% in WEEK ZERO — which is
//            impossible, since you cannot sign up and be absent from your own
//            first week. Finding that is what put this state here.
//
// Colour is the sequential ramp scaled to the largest measured cell, not to
// 100%. Retention lives between 0 and ~0.8 and an absolute scale would paint
// the whole grid the bottom step. The percentage is printed in every cell
// anyway, so the ramp is a second, redundant encoding of a number you can read
// — which is exactly what a heatmap's colour should be.

import { useState } from 'react';
import { VAR } from './palette.js';

const num = (x) => (x == null || Number.isNaN(Number(x)) ? null : Number(x));

const weekLabel = (iso) => {
  try {
    return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch { return String(iso); }
};

/** Light ramp steps need dark text on them; dark steps need light. */
const INK_FOR_STEP = ['#dce8fb', '#dce8fb', '#e8f0fd', '#0d1b33', '#0d1b33'];

export function CohortMatrix({
  /** rows from admin_retention_cohort_matrix */
  rows = [],
  emptyLabel = 'No cohorts in this window yet.',
}) {
  const [hover, setHover] = useState(null);

  if (!rows.length) return <div className="admin-empty">{emptyLabel}</div>;

  const weeks = [...new Set(rows.map((r) => r.cohort_week))]
    .sort((a, b) => (a < b ? 1 : -1));                    // newest cohort first
  const maxOffset = Math.max(...rows.map((r) => num(r.week_offset) ?? 0));
  const cols = Array.from({ length: maxOffset + 1 }, (_, i) => i);

  const byKey = new Map(rows.map((r) => [`${r.cohort_week}|${r.week_offset}`, r]));
  const sizeOf = new Map(rows.map((r) => [r.cohort_week, num(r.cohort_size) ?? 0]));

  const measured = rows.filter((r) => r.measurable && num(r.active_pct) != null);
  const peak = Math.max(0.0001, ...measured.map((r) => num(r.active_pct) || 0));
  const workFloor = rows.find((r) => r.work_floor)?.work_floor || null;

  // Column averages, over measurable cells only. This is the retention curve,
  // read along the bottom of the matrix it came from — and weighting by cohort
  // size rather than averaging the percentages keeps a 10-person week from
  // counting as much as a 41-person one.
  const columnAvg = cols.map((c) => {
    const cells = measured.filter((r) => num(r.week_offset) === c);
    const denom = cells.reduce((a, r) => a + (num(r.cohort_size) || 0), 0);
    const numer = cells.reduce((a, r) => a + (num(r.active_n) || 0), 0);
    return denom > 0 ? { pct: numer / denom, denom } : null;
  });

  const step = (pct) => Math.min(4, Math.max(0, Math.round((pct / peak) * 4)));

  return (
    <div className="adm-cohort">
      <div
        className="adm-cohort-grid"
        style={{ '--adm-cohort-cols': cols.length }}
        onPointerLeave={() => setHover(null)}
      >
        <div className="adm-cohort-row is-head">
          <div className="adm-cohort-corner" />
          {cols.map((c) => (
            <div className="adm-cohort-col-head" key={`h${c}`}>W{c}</div>
          ))}
        </div>

        {weeks.map((wk) => (
          <div className="adm-cohort-row" key={wk}>
            <div className="adm-cohort-row-head">
              <span className="adm-cohort-week">{weekLabel(wk)}</span>
              <span className="adm-cohort-n">n={sizeOf.get(wk) ?? 0}</span>
            </div>
            {cols.map((c) => {
              const r = byKey.get(`${wk}|${c}`);
              if (!r) return <div className="adm-cohort-cell is-future" key={c} />;
              if (!r.measurable) {
                return (
                  <div
                    className="adm-cohort-cell is-unknown"
                    key={c}
                    title={`${weekLabel(wk)} · W${c} — before work tracking began${workFloor ? ` (${weekLabel(workFloor)})` : ''}`}
                    onPointerEnter={() => setHover({ wk, c, unknown: true })}
                  />
                );
              }
              const pct = num(r.active_pct) || 0;
              const si = step(pct);
              return (
                <div
                  className="adm-cohort-cell"
                  key={c}
                  style={{ background: VAR.seq[si], color: INK_FOR_STEP[si] }}
                  onPointerEnter={() => setHover({
                    wk, c, pct, n: num(r.active_n) || 0, size: num(r.cohort_size) || 0,
                  })}
                >
                  {Math.round(pct * 100)}
                </div>
              );
            })}
          </div>
        ))}

        {/* The blended curve, along the bottom. */}
        <div className="adm-cohort-row is-avg">
          <div className="adm-cohort-row-head">
            <span className="adm-cohort-week">All</span>
            <span className="adm-cohort-n">weighted</span>
          </div>
          {cols.map((c) => {
            const a = columnAvg[c];
            return (
              <div className="adm-cohort-cell is-avg" key={c}
                title={a ? `W${c}: ${Math.round(a.pct * 100)}% across ${a.denom} people` : `W${c}: nothing measurable yet`}>
                {a ? `${Math.round(a.pct * 100)}` : '·'}
              </div>
            );
          })}
        </div>
      </div>

      <div className="adm-cohort-read">
        {hover?.unknown
          ? <span className="adm-cohort-hint">
              {weekLabel(hover.wk)} · W{hover.c} — not measured
              {workFloor ? `; work tracking begins ${weekLabel(workFloor)}` : ''}
            </span>
          : hover
            ? <>
                <b>{weekLabel(hover.wk)} · W{hover.c}</b>
                {' · '}{Math.round(hover.pct * 100)}%
                {' · '}{hover.n} of {hover.size} did work that week
              </>
            : <span className="adm-cohort-hint">
                hatched = before work tracking{workFloor ? ` (${weekLabel(workFloor)})` : ''};
                blank = that week has not happened yet
              </span>}
      </div>
    </div>
  );
}
