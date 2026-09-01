// FirstSessionCompare — what the first visit looked like for people who came
// back, next to what it looked like for people who did not.
//
// Every number in this panel was already in the database. Both populations have
// fully traced first sessions recorded, and nothing had ever put them side by
// side: the drop-off RPC pools everyone, and the journey reader shows one
// person at a time. So the most obvious question about the one broken step —
// what actually happens in the session before nobody comes back — had never
// been asked of data we already had.
//
// TWO HONESTY RULES, both learned the hard way here:
//
//   * A metric whose signal is younger than the cohort is shown as NOT YET
//     MEASURABLE with the date it began, never as 0%. Reading a missing
//     instrument as an absent behaviour has already cost one analysis.
//   * The comparison is UNADJUSTED. These two groups differ in depth as well as
//     in outcome, so a gap here is a place to look, not a finding. The panel
//     says so, and points at the stratified table for verdicts.

import { formatCount } from '../../../../lib/adminFormat.js';

const num = (x) => (x == null || Number.isNaN(Number(x)) ? 0 : Number(x));

function fmt(v, kind) {
  if (v == null) return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return kind === 'share' ? `${n.toFixed(0)}%` : (Number.isInteger(n) ? String(n) : n.toFixed(1));
}

function Row({ row }) {
  const kind = row.kind;
  const rv = row.returned_val;
  const sv = row.oneshot_val;
  const rn = num(row.returned_n);
  const sn = num(row.oneshot_n);

  // Nobody old enough to be counted has ever been able to trigger this signal.
  // Not a zero — a gap in the record, with the date it closes.
  if (rn === 0 && sn === 0) {
    return (
      <tr className="adm-fsc-row is-unmeasurable">
        <th scope="row" className="adm-fsc-label">{row.metric}</th>
        <td className="adm-fsc-pair" colSpan={3}>
          not measurable yet — only recorded since {row.measured_from || 'recently'}
        </td>
      </tr>
    );
  }

  const a = Number(rv);
  const b = Number(sv);
  const both = Number.isFinite(a) && Number.isFinite(b);
  // A ratio reads better than a difference for medians (minutes are 4x, not
  // "+10"), and a difference reads better for shares.
  const gap = !both ? null
    : kind === 'share' ? `${a - b > 0 ? '+' : ''}${(a - b).toFixed(0)} pts`
    : (b > 0 ? `${(a / b).toFixed(1)}×` : '—');

  const strong = both && (kind === 'share' ? Math.abs(a - b) >= 10 : b > 0 && (a / b >= 1.5 || a / b <= 0.67));

  return (
    <tr className={`adm-fsc-row ${strong ? 'is-strong' : ''}`}>
      <th scope="row" className="adm-fsc-label">
        {row.metric}
        {row.measured_from && (
          <span className="adm-fsc-since">since {row.measured_from}</span>
        )}
      </th>
      <td className="adm-fsc-val is-ret">{fmt(rv, kind)}</td>
      <td className="adm-fsc-val is-one">{fmt(sv, kind)}</td>
      <td className="adm-fsc-gap">{gap || '—'}</td>
    </tr>
  );
}

export function FirstSessionCompare({ rows = [] }) {
  const list = (rows || []).slice().sort((a, b) => num(a.ord) - num(b.ord));
  if (!list.length) return <div className="admin-empty">Nothing measured yet.</div>;

  const sample = list.find((r) => num(r.returned_n) > 0) || {};

  return (
    <section className="admin-chart-panel admin-chart-panel-wide adm-fsc-wrap">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">The first session, compared</h3>
        <span className="admin-chart-sub t-meta">
          everyone below booted at least once — unadjusted for depth
        </span>
      </header>
      <table className="adm-fsc">
        <thead>
          <tr>
            <th scope="col" className="adm-fsc-label">In their first session</th>
            <th scope="col" className="adm-fsc-val">
              came back
              <span className="adm-fsc-n">n={formatCount(num(sample.returned_n))}</span>
            </th>
            <th scope="col" className="adm-fsc-val">
              never did
              <span className="adm-fsc-n">n={formatCount(num(sample.oneshot_n))}</span>
            </th>
            <th scope="col" className="adm-fsc-gap">gap</th>
          </tr>
        </thead>
        <tbody>
          {list.map((r) => <Row key={r.metric} row={r} />)}
        </tbody>
      </table>

      <div className="admin-panel-note">
        Medians, not means — one tab left open overnight moves an average by minutes. Users who
        verified and never booted are excluded; they have no session to read.
        <strong> These comparisons are unadjusted:</strong> the two groups differ in how much they
        made as well as in whether they returned, so treat a gap here as somewhere to look and take
        the verdict from the stratified table above. The error row in particular reads backwards
        for exactly that reason.
      </div>
    </section>
  );
}

/**
 * SessionOutcomes — sessions by length, against whether that person came back.
 *
 * The read side of the session_summary event. It ships with the emitter on
 * purpose: an event nothing queries is the same failure as a panel nothing
 * feeds, and this dashboard has already shipped one of those to production.
 *
 * It has NO history — the event begins the day it deploys and cannot be
 * backfilled — so the empty state names the date rather than drawing a zero.
 * Reading "nobody has any sessions" off an instrument that started yesterday is
 * precisely the mistake 0277 had to write into two table comments.
 */
export function SessionOutcomes({ rows = [] }) {
  const list = (rows || []).slice().sort((a, b) => num(a.ord) - num(b.ord));
  const total = list.reduce((acc, r) => acc + num(r.sessions), 0);
  const since = list.find((r) => r.since)?.since;

  if (!total) {
    return (
      <section className="admin-chart-panel admin-chart-panel-wide">
        <header className="admin-chart-head">
          <h3 className="admin-chart-title">Session length vs coming back</h3>
        </header>
        <div className="admin-empty">
          {since
            ? `Collecting since ${since} — not enough sessions to read yet.`
            : 'Collecting from this deploy onward. There is no history to backfill.'}
        </div>
      </section>
    );
  }

  const max = Math.max(...list.map((r) => num(r.sessions)), 1);

  return (
    <section className="admin-chart-panel admin-chart-panel-wide adm-fsc-wrap">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">Session length vs coming back</h3>
        <span className="admin-chart-sub t-meta">
          {since ? `collecting since ${since}` : 'newly collecting'}
        </span>
      </header>
      <div className="adm-gap">
        {list.map((r) => {
          const n = num(r.sessions);
          const back = num(r.returned_after);
          const pct = n > 0 ? (back / n) * 100 : 0;
          return (
            <div className="adm-gap-row" key={r.bucket}>
              <span className="adm-gap-label">{r.bucket}</span>
              <span className="adm-bar-track">
                <span className="adm-bar-fill" style={{ width: `${(n / max) * 100}%` }} />
              </span>
              <span className="adm-gap-val">{n < 5 ? '—' : `${pct.toFixed(0)}%`}</span>
              <span className="adm-gap-cum">{formatCount(n)} sessions</span>
            </div>
          );
        })}
      </div>
      <div className="admin-panel-note">
        The bar is how many sessions of that length there were; the figure is the share of them
        after which that person was active again on a later day. Suppressed under five sessions.
        One row per session — a session hidden and resumed reports once, at its fullest.
      </div>
    </section>
  );
}
