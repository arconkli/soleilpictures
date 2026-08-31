// GeoBreakdown — where our traffic and our signups come from. Reads
// admin_geo_breakdown jsonb { by_country, signups }.
//
// Two ranked tables rather than a chart: the country tail is long and the
// per-country signup counts are small, so a pie or a per-country time series
// would be mostly noise. Ranked rows with a share column read better at this
// size — move the window slider to see growth.
//
// Forward-looking, permanently: events and accounts predating country capture
// bucket as "unknown" and can never be backfilled (no IPs were ever retained),
// so we label that share instead of quietly dropping it.

import { formatCount, formatPct } from '../../../../lib/adminFormat.js';
import { countryName } from '../../../../lib/countries.js';
import { PanelNote } from '../../SmallN.jsx';

const TOP_N = 12;
const OTHER = '__other__';

// Split into the leading rows plus a summed "Other" remainder, so a long tail
// never pushes this panel taller than the widgets around it.
function topRows(rows, valueKey) {
  const sorted = [...rows].sort((a, b) => (Number(b[valueKey]) || 0) - (Number(a[valueKey]) || 0));
  if (sorted.length <= TOP_N + 1) return sorted;
  const head = sorted.slice(0, TOP_N);
  const other = sorted.slice(TOP_N).reduce((acc, r) => {
    for (const k in r) if (k !== 'country') acc[k] = (Number(acc[k]) || 0) + (Number(r[k]) || 0);
    return acc;
  }, { country: OTHER });
  return [...head, other];
}

function CountryCell({ code }) {
  if (code === OTHER) return <span className="admin-muted">Other countries</span>;
  const known = code && code !== 'unknown';
  return (
    <>
      <span className={known ? '' : 'admin-muted'}>{countryName(code)}</span>
    </>
  );
}

function GeoTable({ title, rows, valueKey, valueLabel, extra }) {
  const total = rows.reduce((s, r) => s + (Number(r[valueKey]) || 0), 0);
  return (
    <div style={{ flex: 1, minWidth: 260 }}>
      <table className="admin-table">
        <thead>
          <tr>
            <th>{title}</th>
            <th className="num">{valueLabel}</th>
            <th className="num">{extra ? extra.label : 'Share'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.country}>
              <td><CountryCell code={r.country} /></td>
              <td className="num">{formatCount(r[valueKey])}</td>
              <td className="num admin-muted">
                {extra
                  ? extra.render(r)
                  : (total ? formatPct((Number(r[valueKey]) || 0) / total) : '—')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function GeoBreakdown({ data, days = 30 }) {
  const traffic = topRows(data?.by_country || [], 'sessions');
  const signups = topRows(data?.signups || [], 'signups');
  // "Real" = at least one identified country. Until country capture has been
  // live a while everything is 'unknown', and pretending otherwise misleads.
  const hasReal = traffic.some((r) => r.country !== 'unknown' && (Number(r.sessions) || 0) > 0);

  return (
    <section className="admin-chart-panel admin-chart-panel-wide">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">Country</h3>
        <span className="admin-chart-sub t-meta">traffic · signups · last {days}d</span>
      </header>
      <div className="admin-chart-body">
        {!hasReal ? (
          <div className="admin-empty">
            No country data yet — events started carrying country recently; this fills in as new traffic arrives.
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              <GeoTable title="Traffic" rows={traffic} valueKey="sessions" valueLabel="Sessions" />
              <GeoTable
                title="Signups" rows={signups} valueKey="signups" valueLabel="Signups"
                extra={{
                  label: 'Activated',
                  render: (r) => (Number(r.signups)
                    ? formatPct((Number(r.activated) || 0) / Number(r.signups))
                    : '—'),
                }}
              />
            </div>
            <PanelNote>
              Country comes from the network edge, not the browser — VPN and proxy users read as their exit country.
              “Unknown” is traffic from before country capture shipped, which can’t be backfilled.
              Activated = signups from that country that created a card.
            </PanelNote>
          </>
        )}
      </div>
    </section>
  );
}
