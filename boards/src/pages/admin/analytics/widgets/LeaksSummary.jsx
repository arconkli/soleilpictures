// LeaksSummary — the biggest single step-to-step drop, plus the raw friction
// events (errors / abandons) that sit off the happy path. Extracted from the
// old AdminFunnelTab. Takes the full admin_signup_funnel `steps` array and
// derives the waitlist / pricing chains + the leak rows itself.

import { useMemo } from 'react';
import { formatCount, formatPct } from '../../../../lib/adminFormat.js';

function toSteps(rows) {
  return rows.map((r, i) => {
    const sessions = Number(r.sessions) || 0;
    const prev = i > 0 ? (Number(rows[i - 1].sessions) || 0) : null;
    return {
      label: r.label,
      drop: prev != null ? prev - sessions : 0,
      dropPct: prev && prev > 0 ? (prev - sessions) / prev : 0,
    };
  });
}

export function LeaksSummary({ steps = [] }) {
  const core = steps.filter((s) => s.branch === 'core');
  const waitlist = [...core, ...steps.filter((s) => s.branch === 'waitlist')];
  const pricing  = [...core, ...steps.filter((s) => s.branch === 'pricing')];
  const leaks    = steps.filter((s) => s.branch === 'leak');

  const biggest = useMemo(() => {
    const scan = (rows, name) => toSteps(rows)
      .map((d, i) => (i === 0 ? null : { branch: name, to: d.label, from: rows[i - 1].label, drop: d.drop, dropPct: d.dropPct }))
      .filter((x) => x && x.drop > 0);
    const all = [...scan(waitlist, 'waitlist'), ...scan(pricing, 'pricing')];
    all.sort((a, b) => b.dropPct - a.dropPct);
    return all[0] || null;
  }, [waitlist, pricing]);

  const hasFriction = leaks.some((l) => Number(l.sessions) > 0);

  return (
    <section className="admin-chart-panel admin-chart-panel-wide">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">Biggest leaks &amp; friction</h3>
        <span className="admin-chart-sub t-meta">where the most sessions drop, plus error / abandon signals</span>
      </header>
      <div className="admin-chart-body">
        {biggest ? (
          <p className="admin-section-sub">
            Largest single drop: <strong>{biggest.from} → {biggest.to}</strong>{' '}
            — lost <span className="admin-funnel-drop is-loss">{formatCount(biggest.drop)} sessions ({formatPct(biggest.dropPct)})</span>.
          </p>
        ) : (
          <p className="admin-section-sub">No step-to-step drops detected in this window.</p>
        )}
        {hasFriction && (
          <table className="admin-table">
            <thead>
              <tr><th>Friction event</th><th className="num">Sessions</th></tr>
            </thead>
            <tbody>
              {leaks.map((l) => (
                <tr key={l.step}>
                  <td>{l.label}</td>
                  <td className="num admin-funnel-num">{formatCount(l.sessions)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
