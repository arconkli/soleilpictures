// LeaksSummary — the biggest single step-to-step drop, plus the raw friction
// events (errors / abandons) that sit off the happy path. Extracted from the
// old AdminFunnelTab. Takes the full admin_signup_funnel `steps` array and
// derives the pricing chain + the leak rows itself.

import { useMemo } from 'react';
import { formatCount, formatPct } from '../../../../lib/adminFormat.js';
import { Well } from '../../viz/Well.jsx';
import { BarRows } from '../../viz/BarRows.jsx';
import { buildFunnelRows } from '../../viz/funnelRows.js';

// The pricing branch only, because it is the only branch the funnel beside
// this draws: the waitlist chain is all zeros since the waitlist came off, and
// scanning it alongside is how this panel used to disagree with the ⚠.
const BRANCHES = ['pricing'];

export function LeaksSummary({ steps = [] }) {
  const leaks = steps.filter((s) => s.branch === 'leak');

  // Same rows, same rule as FunnelSteps (funnelRows.js): retired steps dropped,
  // the fork into a branch never counted as a leak.
  const biggest = useMemo(() => {
    const b = buildFunnelRows(steps, BRANCHES).biggest;
    return b ? { from: b.from, to: b.label, drop: b.drop, dropPct: b.dropPct } : null;
  }, [steps]);

  const frictionRows = leaks
    .filter((l) => Number(l.sessions) > 0)
    .map((l) => ({ key: l.step, label: l.label, value: Number(l.sessions) || 0 }));

  // Was a full-page-width titled panel whose entire body was one sentence —
  // roughly 1,800px of horizontal rule around eleven words. It is a sidebar to
  // the funnel now, and the friction events are bars rather than a two-column
  // table, so the shape of the problem is visible without reading.
  return (
    <Well
      span={4}
      title="Biggest leak"
      meta="worst step, plus error and abandon signals"
      foot={frictionRows.length === 0
        ? 'No error or abandon events recorded off the happy path in this window.'
        : 'Friction events sit off the funnel — they are not a step, they are what happens instead of one.'}
    >
      {biggest ? (
        <div className="adm-leak">
          <div className="adm-leak-step">{biggest.from} → {biggest.to}</div>
          <div className="adm-leak-figure">
            <span className="adm-leak-pct">{formatPct(biggest.dropPct)}</span>
            <span className="adm-leak-abs">{formatCount(biggest.drop)} browsers lost</span>
          </div>
        </div>
      ) : (
        <div className="admin-empty">No step-to-step drops in this window.</div>
      )}

      {frictionRows.length > 0 && (
        <BarRows
          rows={frictionRows}
          ramp
          limit={6}
          formatValue={(v) => formatCount(v)}
          emptyLabel="No friction events."
        />
      )}
    </Well>
  );
}
