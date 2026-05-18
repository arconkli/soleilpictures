// AdminFunnel — visual + tabular conversion funnel.
// Reads admin_event_funnel(p_days) which returns rows
//   { event, sessions, users, ord }
// in stage order. Computes drop-off relative to (a) the first stage and
// (b) the previous stage so the table shows both top-of-funnel and
// step-by-step conversion.

import { ResponsiveContainer, Funnel, FunnelChart, LabelList, Tooltip } from 'recharts';

const LABELS = {
  landing_view:        'Landing view',
  email_submit:        'Email submitted',
  otp_verify:          'OTP verified',
  welcome_view:        'Welcome page',
  submit_socials_open: 'Opened waitlist form',
  submit_socials_done: 'Submitted waitlist',
  pricing_view:        'Viewed pricing',
  checkout_open:       'Opened checkout',
  checkout_success:    'Completed payment',
  app_open:            'Opened the app',
};

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

  const first = rows[0]?.sessions || 0;
  const data = rows.map((r, i) => {
    const sessions = Number(r.sessions) || 0;
    const prev = i > 0 ? (Number(rows[i - 1].sessions) || 0) : null;
    const fromTopPct = first > 0 ? (sessions / first) * 100 : 0;
    const stepPct    = prev && prev > 0 ? (sessions / prev) * 100 : null;
    return {
      name: LABELS[r.event] || r.event,
      value: sessions,
      fromTopPct,
      stepPct,
      dropFromPrev: prev != null ? prev - sessions : 0,
    };
  });

  return (
    <section className="admin-chart-panel admin-chart-panel-wide">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">Conversion funnel · last 30 days</h3>
        <span className="admin-chart-sub t-meta">
          {first.toLocaleString()} sessions at top
        </span>
      </header>

      <div className="admin-funnel-grid">

        {/* Visual funnel */}
        <div className="admin-funnel-chart">
          <ResponsiveContainer width="100%" height={Math.max(220, data.length * 38)}>
            <FunnelChart>
              <Tooltip
                contentStyle={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: 'var(--ink-1)' }}
                itemStyle={{ color: 'var(--soleil)' }}
              />
              <Funnel
                dataKey="value"
                data={data}
                fill="#ffa500"
                stroke="var(--bg-1)"
                isAnimationActive={false}
              >
                <LabelList position="right" dataKey="name" stroke="none" fill="var(--ink-1)" fontSize={11} />
                <LabelList position="left"  dataKey="value" stroke="none" fill="var(--ink-2)" fontSize={11} />
              </Funnel>
            </FunnelChart>
          </ResponsiveContainer>
        </div>

        {/* Stage-by-stage table */}
        <div className="admin-funnel-table">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Stage</th>
                <th style={{ textAlign: 'right' }}>Sessions</th>
                <th style={{ textAlign: 'right' }}>From top</th>
                <th style={{ textAlign: 'right' }}>Step</th>
                <th style={{ textAlign: 'right' }}>Drop</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d, i) => (
                <tr key={d.name}>
                  <td>{d.name}</td>
                  <td style={{ textAlign: 'right' }} className="admin-funnel-num">
                    {d.value.toLocaleString()}
                  </td>
                  <td style={{ textAlign: 'right' }} className="admin-funnel-pct">
                    {(d.fromTopPct ?? 0).toFixed(0)}%
                  </td>
                  <td style={{ textAlign: 'right' }} className="admin-funnel-pct">
                    {i === 0 || d.stepPct == null ? '—' : `${d.stepPct.toFixed(0)}%`}
                  </td>
                  <td style={{ textAlign: 'right' }} className={`admin-funnel-drop ${i > 0 && d.dropFromPrev > 0 ? 'is-loss' : ''}`}>
                    {i === 0 ? '—' : (d.dropFromPrev > 0 ? `-${d.dropFromPrev.toLocaleString()}` : '0')}
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
