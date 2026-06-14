// ActivationByExperiment — the bandit's scoreboard for one experiment. Reads
// admin_activation_by_experiment { arm, enrolled, first_card(_pct), populated(_pct),
// returned(_pct), paid(_pct), mean_reward } + the live bandit state from
// admin_get_experiment_state (weights/phase/updated_at/reward_weights).
//
// mean_reward is the COMPOSITE, payment-weighted target the optimizer maximizes —
// NOT a single shallow metric — so a variant that wins more first-cards but whose
// users never return/pay does not win here. Rates use the locked small-N honesty
// (RateCell suppresses <5, flags 5–19), and the strip shows current traffic
// allocation so you can watch the bandit tilt.

import { formatCount, formatPct, relativeTime } from '../../../../lib/adminFormat.js';
import { RateCell, PanelNote, ChartPlaceholder } from '../../SmallN.jsx';

const SOLEIL = '#ffa500';

function pct(weights, arm, arms) {
  const total = (arms || []).reduce((s, a) => s + (Number(weights?.[a]) || 0), 0) || 1;
  return (Number(weights?.[arm]) || 0) / total;
}

export function ActivationByExperiment({ expKey = '', rows = [], state = null }) {
  const arms = state?.arms || [...new Set(rows.map((r) => r.arm))].sort();
  const weights = state?.weights || {};
  const phase = state?.phase || null;
  const K = Number(state?.min_trials_per_arm) || 20;
  const rw = state?.reward_weights || { first_card: 1, populated: 2, returned: 3, paid: 14 };
  const byArm = new Map(rows.map((r) => [r.arm, r]));
  // Highlight the arm with the highest mean reward (the current leader).
  const leader = rows.reduce((best, r) => (Number(r.mean_reward) > Number(best?.mean_reward ?? -1) ? r : best), null);

  return (
    <section className="admin-chart-panel admin-chart-panel-wide">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">Experiment: {expKey}</h3>
        <span className="admin-chart-sub t-meta">
          composite reward = card·{rw.first_card} + populated·{rw.populated} + returned·{rw.returned} + paid·{rw.paid}
          {state?.updated_at ? ` · tuned ${relativeTime(state.updated_at)}` : ''}
        </span>
      </header>
      <div className="admin-chart-body">
        {/* Live allocation strip */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          <span className="t-meta" style={{
            padding: '2px 8px', borderRadius: 999, fontWeight: 600,
            background: phase === 'active' ? 'rgba(80,200,120,.15)' : 'rgba(255,165,0,.15)',
            color: phase === 'active' ? 'var(--ok, #50c878)' : 'var(--warn, #ffa500)',
          }}>
            {phase === 'active' ? 'optimizing' : `warming up — needs ≥${K}/arm`}
          </span>
          {arms.map((a) => (
            <span key={a} className="t-meta" style={{ color: 'var(--ink-2)' }}>
              arm {a}: <strong style={{ color: 'var(--ink-0)' }}>{formatPct(pct(weights, a, arms))}</strong> traffic
            </span>
          ))}
        </div>

        {rows.length === 0 ? (
          <ChartPlaceholder title="No enrollees yet"
            sub="Fills in as brand-new users get bucketed into an arm." />
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Arm</th><th className="num">Enrolled</th>
                <th className="num">First card</th><th className="num">Populated</th>
                <th className="num">Returned</th><th className="num">Paid</th>
                <th className="num">Mean reward</th>
              </tr>
            </thead>
            <tbody>
              {arms.map((a) => {
                const r = byArm.get(a) || {};
                const n = Number(r.enrolled) || 0;
                const isLeader = leader && leader.arm === a && n > 0;
                return (
                  <tr key={a}>
                    <td style={{ fontWeight: 600 }}>{a}{isLeader ? ' ★' : ''}</td>
                    <td className="num">{formatCount(n)}</td>
                    <td className="num"><RateCell numer={r.first_card} denom={n} /></td>
                    <td className="num"><RateCell numer={r.populated} denom={n} /></td>
                    <td className="num"><RateCell numer={r.returned} denom={n} /></td>
                    <td className="num"><RateCell numer={r.paid} denom={n} /></td>
                    <td className="num" style={{ color: isLeader ? SOLEIL : 'var(--ink-1)', fontWeight: isLeader ? 600 : 400 }}>
                      {r.mean_reward == null ? '—' : Number(r.mean_reward).toFixed(3)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <PanelNote>
          ★ = current leader by mean reward (the bandit's target). Paid is the real goal and weighted heaviest,
          so it dominates once it appears — at low payment volume the score leans on the card/return/populated
          proxies. Rates are directional below {20} enrollees per arm; the bandit holds traffic near-even until then.
        </PanelNote>
      </div>
    </section>
  );
}
