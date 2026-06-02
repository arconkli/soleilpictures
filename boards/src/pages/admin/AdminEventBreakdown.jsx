// AdminEventBreakdown — the branch / error / abandon signals that don't fit
// the linear conversion funnel, plus a checkout-reliability summary. Backed by
// admin_event_breakdown() + admin_checkout_reliability() (migration 0103).
// Mirrors AdminFunnel's chart+table layout; reuses existing admin classes.

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from 'recharts';
import { formatCount, formatPct } from '../../lib/adminFormat.js';

const SOLEIL = '#ffa500';

const LABELS = {
  email_submit_error:      'Email send failed',
  otp_verify_error:        'OTP verify failed',
  landing_callback_error:  'Magic-link failed',
  landing_edit_email:      'Edited email',
  landing_explore_click:   'Explore-board click',
  welcome_cta:             'Welcome path chosen',
  waitlist_abandon:        'Waitlist abandoned',
  waitlist_plan_toggle:    'Waitlist plan toggle',
  waitlist_subscribe_cta:  'Waitlist subscribe',
  pricing_plan_toggle:     'Pricing plan toggle',
  pricing_demo_cta:        'Demo CTA',
  pricing_creator_intent:  'Creator CTA intent',
  pricing_abandon:         'Pricing abandoned',
  checkout_error:          'Checkout error',
  billing_portal_error:    'Portal error',
  checkout_stalled:        'Checkout stalled',
  checkout_verify_retry:   'Verify retry',
  checkout_missing_session:'Missing session',
  checkout_support_click:  'Support click',
};

export function AdminEventBreakdown({ rows = [], reliability, days = 30 }) {
  const data = (rows || []).map((r) => ({
    name:     LABELS[r.event] || r.event,
    sessions: Number(r.sessions) || 0,
    users:    Number(r.users) || 0,
    total:    Number(r.total) || 0,
  }));
  const hasRows = data.length > 0;
  const rel = reliability || null;
  const activationRate = rel && Number(rel.success_views) > 0
    ? Number(rel.activated) / Number(rel.success_views)
    : null;

  if (!hasRows && !rel) return null;   // RPCs not deployed yet → render nothing

  return (
    <>
      {rel && (
        <section className="admin-chart-panel admin-chart-panel-wide">
          <header className="admin-chart-head">
            <h3 className="admin-chart-title">Checkout reliability · last {days} days</h3>
            <span className="admin-chart-sub t-meta">how completed checkouts resolve (distinct sessions)</span>
          </header>
          <div className="admin-chart-body">
            <table className="admin-table">
              <tbody>
                <tr><td>Success-page views</td><td className="num">{formatCount(rel.success_views)}</td></tr>
                <tr>
                  <td>Activated{activationRate != null ? ` (${formatPct(activationRate)})` : ''}</td>
                  <td className="num">{formatCount(rel.activated)}</td>
                </tr>
                <tr><td>Stalled (&gt;30s)</td><td className="num">{formatCount(rel.stalled)}</td></tr>
                <tr><td>Verify retries</td><td className="num">{formatCount(rel.verify_retry)}</td></tr>
                <tr><td>Missing session</td><td className="num">{formatCount(rel.missing_session)}</td></tr>
                <tr><td>Verify failed</td><td className="num">{formatCount(rel.verify_failed)}</td></tr>
                <tr><td>Support clicks</td><td className="num">{formatCount(rel.support_clicks)}</td></tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      {hasRows && (
        <section className="admin-chart-panel admin-chart-panel-wide">
          <header className="admin-chart-head">
            <h3 className="admin-chart-title">Branch &amp; failure signals · last {days} days</h3>
            <span className="admin-chart-sub t-meta">errors, abandons &amp; path choices — distinct sessions</span>
          </header>
          <div className="admin-funnel-grid">
            <div className="admin-funnel-chart">
              <ResponsiveContainer width="100%" height={Math.max(260, data.length * 26)}>
                <BarChart data={data} layout="vertical" margin={{ top: 6, right: 24, bottom: 6, left: 8 }}>
                  <XAxis type="number" stroke="var(--ink-3)" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis dataKey="name" type="category" stroke="var(--ink-3)" fontSize={10} tickLine={false} axisLine={false} width={150} />
                  <Tooltip
                    contentStyle={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: 'var(--ink-1)' }}
                    formatter={(v) => [formatCount(v), 'sessions']}
                  />
                  <Bar dataKey="sessions" radius={[0, 3, 3, 0]} isAnimationActive={false}>
                    {data.map((_, i) => <Cell key={i} fill={SOLEIL} fillOpacity={0.85} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="admin-funnel-table">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Signal</th>
                    <th className="num">Sessions</th>
                    <th className="num">Users</th>
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((d, i) => (
                    <tr key={`${d.name}-${i}`}>
                      <td>{d.name}</td>
                      <td className="num admin-funnel-num">{formatCount(d.sessions)}</td>
                      <td className="num admin-funnel-num">{formatCount(d.users)}</td>
                      <td className="num admin-funnel-num">{formatCount(d.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
