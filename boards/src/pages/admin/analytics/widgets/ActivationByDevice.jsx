// ActivationByDevice — the activation funnel split by each user's modal device.
// The headline "did the mobile first-use fixes move mobile activation?" readout:
// mobile vs desktop signup → first board → first card. Powered by the
// admin_activation_funnel(...,p_device) overload (migration 0156). First-card %
// is gated by safeRate (suppressed below the trust floor) since mobile N is small.

import { formatCount, formatPct, safeRate } from '../../../../lib/adminFormat.js';
import { PanelNote } from '../../SmallN.jsx';

// Mirrors DeviceBreakdown.jsx (not exported there — re-declared per convention).
const DEVICE_COLORS = { desktop: '#5b8def', mobile: '#ffa500', tablet: '#43c59e', unknown: '#6b7280' };

export function ActivationByDevice({ rows = [], days = 30 }) {
  const data = (rows || []).filter((r) => r?.data && (Number(r.data.signed_up) || 0) > 0);
  if (!data.length) return null;

  return (
    <section className="admin-chart-panel admin-chart-panel-wide">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">Activation by device</h3>
        <span className="admin-chart-sub t-meta">signup → first card, by device · last {days}d</span>
      </header>
      <div className="admin-chart-body">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Device</th>
              <th className="num">Signed up</th>
              <th className="num">First board</th>
              <th className="num">First card</th>
              <th className="num">First card %</th>
              <th className="num">Paid</th>
            </tr>
          </thead>
          <tbody>
            {data.map(({ device, data: d }) => {
              const r = safeRate(d.first_card, d.signed_up);
              return (
                <tr key={device}>
                  <td style={{ textTransform: 'capitalize' }}>
                    <span aria-hidden="true" style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2,
                      background: DEVICE_COLORS[device] || DEVICE_COLORS.unknown, marginRight: 6 }} />
                    {device}
                  </td>
                  <td className="num">{formatCount(d.signed_up)}</td>
                  <td className="num">{formatCount(d.first_board)}</td>
                  <td className="num">{formatCount(d.first_card)}</td>
                  <td className="num">{r.hide ? '—' : `${formatPct(r.rate)}${r.flag ? ' ⚠' : ''}`}</td>
                  <td className="num">{formatCount(d.first_paid)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <PanelNote>
          Device is each user’s most-frequent device_type from events; users from before device tracking
          (~Jun 6) show as “unknown”. First-card % is suppressed below the trust floor on small N.
        </PanelNote>
      </div>
    </section>
  );
}
