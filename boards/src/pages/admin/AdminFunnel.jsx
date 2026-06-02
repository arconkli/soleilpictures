// AdminFunnel — visual + tabular conversion funnel.
// Reads admin_event_funnel(p_days) → { event, sessions, users, ord } in
// stage order. Shows drop-off relative to the first stage and the
// previous stage. Percentages use the shared formatPct (1 decimal, with a
// "<1%" floor) so a real-but-small conversion never rounds to "0%".

import { ResponsiveContainer, Funnel, FunnelChart, LabelList, Tooltip } from 'recharts';
import { formatPct, formatCount } from '../../lib/adminFormat.js';

const LABELS = {
  landing_view:         'Landing view',
  landing_scroll:       'Scrolled the reveal',
  email_submit:         'Email submitted',
  otp_verify:           'OTP verified',
  welcome_view:         'Welcome page',
  submit_socials_open:  'Opened waitlist form',
  submit_socials_done:  'Submitted waitlist',
  submit_socials_error: 'Waitlist submit failed',
  pricing_view:         'Viewed pricing',
  checkout_open:        'Opened checkout',
  checkout_error:       'Checkout failed',
  checkout_success:     'Completed payment',
  app_open:             'Opened the app',
};
// Note: these labels only render for events the admin_event_funnel RPC returns
// as stages. landing_scroll / checkout_error / submit_socials_error are side
// signals — query analytics_events directly, or add them to the RPC's stage
// list later to slot them into the chart.

export function AdminFunnel({ rows }) {
  if (!rows || rows.length === 0) {
    return (
      <section className="admin-chart-panel">
        <header className="admin-chart-head">
          <h3 className="admin-chart-title">Conversion funnel</h3>
        </header>
        <div className="admin-empty">No events yet. Browse the app once and refresh.</div>
      </section>
    );
  }

  // Defensive: render in declared stage order regardless of row order.
  const ordered = [...rows].sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0));
  const first = ordered[0]?.sessions || 0;
  const data = ordered.map((r, i) => {
    const sessions = Number(r.sessions) || 0;
    const prev = i > 0 ? (Number(ordered[i - 1].sessions) || 0) : null;
    return {
      name: LABELS[r.event] || r.event,
      value: sessions,
      fromTop: first > 0 ? sessions / first : 0,
      step: prev && prev > 0 ? sessions / prev : null,
      dropFromPrev: prev != null ? prev - sessions : 0,
    };
  });

  return (
    <section className="admin-chart-panel admin-chart-panel-wide">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">Conversion funnel · last 30 days</h3>
        <span className="admin-chart-sub t-meta">{formatCount(first)} sessions at top</span>
      </header>

      <div className="admin-funnel-grid">
        <div className="admin-funnel-chart">
          <ResponsiveContainer width="100%" height={Math.max(220, data.length * 38)}>
            <FunnelChart>
              <Tooltip
                contentStyle={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: 'var(--ink-1)' }}
                itemStyle={{ color: 'var(--soleil)' }}
              />
              <Funnel dataKey="value" data={data} fill="#ffa500" stroke="var(--bg-1)" isAnimationActive={false}>
                <LabelList position="right" dataKey="name" stroke="none" fill="var(--ink-1)" fontSize={11} />
                <LabelList position="left"  dataKey="value" stroke="none" fill="var(--ink-2)" fontSize={11} />
              </Funnel>
            </FunnelChart>
          </ResponsiveContainer>
        </div>

        <div className="admin-funnel-table">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Stage</th>
                <th className="num">Sessions</th>
                <th className="num">From top</th>
                <th className="num">Step</th>
                <th className="num">Drop</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d, i) => (
                <tr key={`${d.name}-${i}`}>
                  <td>{d.name}</td>
                  <td className="num admin-funnel-num">{formatCount(d.value)}</td>
                  <td className="num admin-funnel-pct">{formatPct(d.fromTop)}</td>
                  <td className="num admin-funnel-pct">{i === 0 || d.step == null ? '—' : formatPct(d.step)}</td>
                  <td className={`num admin-funnel-drop ${i > 0 && d.dropFromPrev > 0 ? 'is-loss' : ''}`}>
                    {i === 0 ? '—' : (d.dropFromPrev > 0 ? `-${formatCount(d.dropFromPrev)}` : '0')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
