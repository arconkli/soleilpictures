// OnboardingErrorCoverage — volume of the previously-SILENT onboarding/friction
// error events (seed/persist/first-source failures + blocked/stuck), so a broken
// onboarding leaves a signal instead of a dead-end. Reads
// admin_onboarding_error_coverage { event, sessions, users, total, top_reason }.
//
// Unlike EventCoverage (client-vs-server-truth reconciliation), these errors have
// no server truth to reconcile against — this is a pure client error-volume
// table, modeled on the admin event breakdown. Nonzero rows are amber (worth a
// look); the failure events go red because they mean a user's onboarding broke.

import { formatCount } from '../../../../lib/adminFormat.js';
import { PanelNote } from '../../SmallN.jsx';

const LABELS = {
  card_create_blocked: 'Card create blocked',
  card_create_stuck: 'Stuck placing first card',
  onboarding_seed_failed: 'Seed failed',
  onboarding_settings_persist_failed: 'Onboarding state didn’t save',
  onboarding_first_source_failed: 'Attribution stamp failed',
};
// The hard failures (a user's onboarding actually broke) go red; blocked/stuck are
// friction signals (amber) — expected to be nonzero, useful, not alarming.
const HARD_FAIL = new Set(['onboarding_seed_failed', 'onboarding_settings_persist_failed', 'onboarding_first_source_failed']);

export function OnboardingErrorCoverage({ rows = [] }) {
  if (!rows.length) return null;
  const anySignal = rows.some((r) => (Number(r.total) || 0) > 0);

  return (
    <section className="admin-chart-panel admin-chart-panel-wide">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">Onboarding errors &amp; friction</h3>
        <span className="admin-chart-sub t-meta">previously-silent failures, now instrumented — a broken seed/persist used to leave no trace</span>
      </header>
      <table className="admin-table">
        <thead>
          <tr><th>Event</th><th className="num">Sessions</th><th className="num">Users</th><th className="num">Total</th><th>Top reason</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const total = Number(r.total) || 0;
            const hard = HARD_FAIL.has(r.event);
            const color = total === 0 ? 'var(--ink-2)' : (hard ? 'var(--danger, #e5484d)' : 'var(--warn, #ffa500)');
            return (
              <tr key={r.event}>
                <td style={{ color }}>{LABELS[r.event] || r.event}{hard && total > 0 ? ' ⚠' : ''}</td>
                <td className="num">{formatCount(r.sessions)}</td>
                <td className="num">{formatCount(r.users)}</td>
                <td className="num" style={{ color }}>{formatCount(total)}</td>
                <td className="t-meta" style={{ color: 'var(--ink-2)' }}>{r.top_reason || '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <PanelNote>
        {anySignal
          ? 'Red rows are hard failures — a user’s seed, settings save, or attribution actually broke (fix these). Amber rows are friction signals (blocked attempts / stuck) — expected, and the input to the UX fixes.'
          : 'No onboarding errors or friction recorded in this window — either nothing broke, or the friction events haven’t shipped yet.'}
      </PanelNote>
    </section>
  );
}
