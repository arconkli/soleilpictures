// ConversionFunnel.jsx — does the money funnel work, per upgrade surface?
// Reads admin_conversion_funnel (0326).
//
// The column that matters is EVALUATED, not shown. A pitch that appears and is
// dismissed in two seconds with nothing read is not an offer anyone turned
// down; it is an interruption they closed. Separating "shown" from "actually
// read or priced" is the difference between "the offer is being rejected" and
// "the offer is never being considered", and those two need opposite fixes.
//
// SHOWN is up_exposure_summary, one row per pitch actually rendered. It is the
// honest denominator: pricing_view is latched once per pageload, so a modal
// that re-mounts forty times logs a single view and any rate built on it is
// inflated. The old forced-pricing rows (the price-first ad screen, the
// waitlist routing, the pre-launch billing tests) are archived out of the live
// table by 0326, so nothing here counts a price somebody never chose to see.
import { RateCell, PanelNote, ChartPlaceholder } from '../../SmallN.jsx';
import { formatCount } from '../../../../lib/adminFormat.js';

const secs = (ms) => {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return n < 1000 ? `${Math.round(n)}ms` : `${(n / 1000).toFixed(1)}s`;
};

export function ConversionFunnel({ rows = [], since }) {
  const data = (rows || []).filter((r) =>
    Number(r.exposures) > 0 || Number(r.checkouts) > 0 || Number(r.trials) > 0);
  if (!data.length) return <ChartPlaceholder title="No upgrade pitches recorded in this window" />;

  const sum = (k) => data.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const shown = sum('exposures');
  const evaluated = sum('evaluated');
  const cta = sum('cta');
  const checkouts = sum('checkouts');
  const trials = sum('trials');
  const paid = sum('paid');
  const configErrors = sum('config_errors');

  return (
    <div>
      {/* The one-line truth, before the table. Each step names its own
          denominator so no rate here can be read against the wrong base. */}
      <p className="admin-section-sub">
        {formatCount(shown)} pitches shown · {formatCount(evaluated)} evaluated ·{' '}
        {formatCount(cta)} clicked · {formatCount(checkouts)} reached Stripe ·{' '}
        {formatCount(trials)} started a trial · {formatCount(paid)} paid
        {configErrors > 0 && (
          <strong> · {formatCount(configErrors)} checkout failures were CONFIGURATION, not the user</strong>
        )}
      </p>

      <div style={{ overflowX: 'auto' }}>
        <table className="admin-table">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Surface</th>
              <th className="num">Shown</th>
              <th className="num">People</th>
              <th className="num">Evaluated</th>
              <th className="num">Eval. rate</th>
              <th className="num">Median look</th>
              <th className="num">Clicked</th>
              <th className="num">Intent</th>
              <th className="num">Stripe</th>
              <th className="num">Errors</th>
              {/* A trial start is not a sale and never shares a column with one.
                  Both come from subscription_started; the flag on it is the only
                  thing that tells them apart, because amount_total is 0 for a
                  trial AND for a 100%-off promo. */}
              <th className="num" title="$0 trial starts — paid access, no revenue">Trials</th>
              <th className="num" title="a real first charge">Paid</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.surface}>
                <td style={{ textAlign: 'left' }}>{r.surface}</td>
                <td className="num">{formatCount(r.exposures)}</td>
                <td className="num">{Number(r.people) > 0 ? formatCount(r.people) : <span className="admin-muted" title="signed-out visitors">anon</span>}</td>
                <td className="num">{formatCount(r.evaluated)}</td>
                <td className="num"><RateCell numer={r.evaluated} denom={r.exposures} /></td>
                <td className="num">{secs(r.median_dwell_ms)}</td>
                <td className="num">{formatCount(r.cta)}</td>
                <td className="num">{formatCount(r.intents)}</td>
                <td className="num">{formatCount(r.checkouts)}</td>
                <td className="num">
                  {Number(r.config_errors) > 0
                    ? <strong title="misconfigured price or URL — ours to fix">{formatCount(r.checkout_errors)}</strong>
                    : formatCount(r.checkout_errors)}
                </td>
                <td className="num">{formatCount(r.trials)}</td>
                <td className="num">{formatCount(r.paid)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <PanelNote>
        Shown is one row per pitch actually rendered, which is the only honest denominator here.
        Evaluated means the reader opened a feature line or toggled the plan, so they engaged with
        the offer rather than the interruption. Median look excludes anything over ten minutes,
        which is a parked tab rather than a read. Errors in bold contain at least one configuration
        failure, which is ours and permanent, not an outage. Since {since || '2026-06-27'}; the
        forced-pricing era is archived out of this table.
      </PanelNote>
    </div>
  );
}
