// FixedHorizonTable.jsx — "did they come back within N days", split by what we
// knew about them on day one. Reads admin_return_fixed_horizon (0322).
//
// This is the panel to grade a deploy on. The survival curve above it is an
// unbounded conditional step pooled over the whole post-waitlist history; a real
// change in behaviour moves it by a fraction of a point a week. A fixed horizon
// asks one question of every first visit old enough to answer it — did the
// second visit begin within the window — and can therefore move inside a
// fortnight, week by week, band by band.
//
// Rendered with the deck's own bar classes (same as ReturnGap) rather than a
// second chart idiom, and every row prints its Wilson interval and n, because
// the cells this splits into are small and a bar on eight people must not read
// like a bar on eighty.
import { groupFixedHorizon } from '../../../../lib/fixedHorizonRows.js';
import { VAR } from '../../viz/palette.js';
import { ChartPlaceholder } from '../../SmallN.jsx';

const TITLES = {
  device: 'By device',
  source: 'By first source',
  band: 'By day-one cards',
  week: 'By signup week',
};

const pct = (x) => `${Math.round((Number(x) || 0) * 100)}%`;

function Row({ label, n, ci, bold = false, faded = false }) {
  return (
    <div className="adm-gap-row">
      <span className="adm-gap-label">{bold ? <b>{label}</b> : label}</span>
      <span className="adm-bar-track">
        <span
          className="adm-bar-fill"
          style={{ width: pct(ci.p), background: VAR.cat[0], opacity: faded ? 0.45 : 1 }}
        />
      </span>
      <span className="adm-gap-val">{n ? pct(ci.p) : '—'}</span>
      <span className="adm-gap-cum">{n ? `${pct(ci.lo)}–${pct(ci.hi)} · n=${n}` : ''}</span>
    </div>
  );
}

export function FixedHorizonTable({ rows = [], horizonDays = 7 }) {
  const g = groupFixedHorizon(rows);
  if (!g.all || !g.all.n) return <ChartPlaceholder title="No first visits old enough to grade yet" />;
  return (
    <div className="adm-gap">
      <Row label="All" n={g.all.n} ci={g.all.ci} bold />
      {g.groups.map((grp) => (
        <div key={grp.key}>
          <div className="admin-panel-note" style={{ marginTop: 10 }}>{TITLES[grp.key] || grp.key}</div>
          {grp.rows.map((r) => (
            <Row key={r.label} label={r.label} n={r.n} ci={r.ci} faded={r.n < 20} />
          ))}
        </div>
      ))}
      <div className="admin-panel-note">
        Returned = the second visit began within {horizonDays} days of the first. Faded bars rest on
        fewer than twenty people. A visit merges across UTC midnight, and a day that held only a
        heartbeat is not a visit.
      </div>
    </div>
  );
}
