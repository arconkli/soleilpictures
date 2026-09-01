// LeaksSummary — the biggest single step-to-step drop, plus the raw friction
// events (errors / abandons) that sit off the happy path. Extracted from the
// old AdminFunnelTab. Takes the full admin_signup_funnel `steps` array and
// derives the waitlist / pricing chains + the leak rows itself.

import { useMemo } from 'react';
import { formatCount, formatPct } from '../../../../lib/adminFormat.js';
import { Well } from '../../viz/Well.jsx';
import { BarRows } from '../../viz/BarRows.jsx';

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
