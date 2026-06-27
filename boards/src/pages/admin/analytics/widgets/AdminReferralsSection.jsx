// AdminReferralsSection — the "invite a friend → earn 25 cards" growth loop,
// as seen by an operator. Funnel KPIs (joined → activated → cards granted),
// the link-vs-collab source split, and a top-referrers leaderboard. Pure
// presentational: AcquisitionView fetches admin_referral_stats and passes the
// jsonb payload as `data` (graceful — a failed RPC just renders the empty
// state without blocking the rest of the view).
//
// `data` shape (from admin_referral_stats):
//   { total, pending, activated, activation_rate, cards_granted,
//     referring_users, paid_conversions, months_granted, k_factor,
//     median_days_to_activate,
//     by_source: { link:{total,activated}, collab:{total,activated} },
//     top_referrers: [{ user_id, email, friends_joined, friends_activated, friends_paid, cards_earned }] }

import { CopyableText } from '../../../../components/CopyableText.jsx';
import { formatCount } from '../../../../lib/adminFormat.js';
import { AdminStatCard } from '../../AdminStatCard.jsx';
import { RateCell } from '../../SmallN.jsx';

const SOURCE_LABELS = { link: 'Personal link', collab: 'Collab invite' };

export function AdminReferralsSection({ data, days = 30 }) {
  const d = data || null;
  const windowLabel = days > 0 ? `last ${days}d` : 'all time';

  // No payload, or zero referrals → a single honest empty panel. The loop just
  // shipped, so this is the expected state until invites start converting.
  if (!d || !Number(d.total)) {
    return (
      <section className="admin-chart-panel admin-chart-panel-wide">
        <header className="admin-chart-head">
          <h3 className="admin-chart-title">Referrals</h3>
          <span className="admin-chart-sub t-meta">invite a friend → earn 25 cards · {windowLabel}</span>
        </header>
        <div className="admin-empty">No referrals in this window yet.</div>
      </section>
    );
  }

  const bySource = d.by_source || {};
  const top = Array.isArray(d.top_referrers) ? d.top_referrers : [];

  return (
    <>
      <section className="admin-chart-panel admin-chart-panel-wide">
        <header className="admin-chart-head">
          <h3 className="admin-chart-title">Referrals</h3>
          <span className="admin-chart-sub t-meta">invite a friend → earn 25 cards · {windowLabel}</span>
        </header>

        <div className="admin-stat-grid">
          <AdminStatCard
            label="Friends joined"
            value={formatCount(d.total)}
            sub={`${formatCount(d.pending)} not yet activated`} />
          <AdminStatCard
            label="Activated"
            value={formatCount(d.activated)}
            sub="made a first card"
            accent />
          <AdminStatCard
            label="Activation rate"
            value={<RateCell numer={d.activated} denom={d.total} />}
            title="Share of referred friends who created their first genuine card" />
          <AdminStatCard
            label="Cards granted"
            value={formatCount(d.cards_granted)}
            sub="to referrers" />
          <AdminStatCard
            label="Paid upgrades"
            value={formatCount(d.paid_conversions || 0)}
            sub="referred friends who paid"
            title="Referred friends who became paying customers (each earns the referrer a free month)"
            accent />
          <AdminStatCard
            label="Free months granted"
            value={formatCount(d.months_granted || 0)}
            sub="to referrers" />
          <AdminStatCard
            label="Viral coefficient"
            value={d.k_factor != null ? d.k_factor : '—'}
            sub={d.median_days_to_activate != null ? `${d.median_days_to_activate}d median to activate` : 'activations ÷ referrers'}
            title="k-factor: activated referrals per referring user. >1 = self-sustaining growth." />
        </div>
      </section>

      <section className="admin-chart-panel admin-chart-panel-wide">
        <header className="admin-chart-head">
          <h3 className="admin-chart-title">Referrals by source</h3>
          <span className="admin-chart-sub t-meta">personal ?ref link vs. board collaboration invites</span>
        </header>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Source</th>
              <th className="num">Joined</th>
              <th className="num">Activated</th>
              <th className="num">Rate</th>
            </tr>
          </thead>
          <tbody>
            {['link', 'collab'].map((k) => {
              const s = bySource[k] || { total: 0, activated: 0 };
              return (
                <tr key={k}>
                  <td>{SOURCE_LABELS[k] || k}</td>
                  <td className="num">{formatCount(s.total)}</td>
                  <td className="num">{formatCount(s.activated)}</td>
                  <td className="num"><RateCell numer={s.activated} denom={s.total} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="admin-chart-panel admin-chart-panel-wide">
        <header className="admin-chart-head">
          <h3 className="admin-chart-title">Top referrers</h3>
          <span className="admin-chart-sub t-meta">most friends activated · {windowLabel}</span>
        </header>
        {top.length === 0 ? (
          <div className="admin-empty">No referrers yet.</div>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ width: 32 }}>#</th>
                <th>Email</th>
                <th className="num">Joined</th>
                <th className="num">Activated</th>
                <th className="num">Paid</th>
                <th className="num">Cards earned</th>
              </tr>
            </thead>
            <tbody>
              {top.map((r, i) => (
                <tr key={r.user_id || i}>
                  <td className="admin-top-rank">{i + 1}</td>
                  <td className="admin-email">
                    {r.email ? <CopyableText value={r.email} className="admin-email" /> : <span className="admin-muted">unknown</span>}
                  </td>
                  <td className="num">{formatCount(r.friends_joined)}</td>
                  <td className="num">{formatCount(r.friends_activated)}</td>
                  <td className="num">{formatCount(r.friends_paid || 0)}</td>
                  <td className="num admin-funnel-num">{formatCount(r.cards_earned)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
