// EventCoverage — reconciles client analytics events against server-side
// activation truth, so a lossy/dead event reads as a COVERAGE gap, not a real
// collapse. Reads admin_event_coverage { milestone, server_truth, client_event,
// coverage_pct }. This is the guard that would have caught the dead
// onboarding_first_card north-star (0% coverage vs a non-zero first_card_at).

import { formatCount, formatPct } from '../../../../lib/adminFormat.js';
import { PanelNote } from '../../SmallN.jsx';

const LABELS = {
  first_card: 'First card',
  populated_board: 'Populated board',
  first_share: 'First share',
  first_paid: 'First paid',
};

export function EventCoverage({ rows = [] }) {
  if (!rows.length) return null;
  return (
    <section className="admin-chart-panel admin-chart-panel-wide">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">Instrumentation coverage</h3>
        <span className="admin-chart-sub t-meta">client event vs server truth — low coverage = a lossy/dead event, not a real drop</span>
      </header>
      <table className="admin-table">
        <thead>
          <tr><th>Milestone</th><th className="num">Server truth</th><th className="num">Client event</th><th className="num">Coverage</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const cov = r.coverage_pct == null ? null : Number(r.coverage_pct);
            const server = Number(r.server_truth) || 0;
            const client = Number(r.client_event) || 0;
            const dead = server > 0 && client === 0;
            const color = dead ? 'var(--danger, #e5484d)' : (cov != null && cov < 1 ? 'var(--warn, #ffa500)' : 'var(--ink-1)');
            return (
              <tr key={r.milestone}>
                <td>{LABELS[r.milestone] || r.milestone}</td>
                <td className="num">{formatCount(server)}</td>
                <td className="num">{formatCount(client)}</td>
                <td className="num" style={{ color }}>{cov == null ? '—' : formatPct(cov)}{dead ? ' ⚠' : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <PanelNote>
        Coverage = distinct users with the client event ÷ users with the server-side milestone. Below 100%
        means the event is lossy or mis-wired — a coverage gap to fix, not an activation collapse.
      </PanelNote>
    </section>
  );
}
