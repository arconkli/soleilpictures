// HabitCurve — how many of the last 28 days does each person actually show up?
//
// A single retention percentage collapses "everyone visits once" and "a few
// people live here" into the same number. The distribution keeps them apart,
// and it is the honest shape of a retention problem: a tall bar at 1 day with a
// thin tail means the product is being tried, not adopted.
//
// The Work/Presence toggle is the point of migration 0248. Until then
// user_active_day was written purely from the presence heartbeat, so more than
// half of all "active days" contained no work at all. Work is the stricter,
// truer track — and it necessarily starts at the deploy date, which the empty
// state says out loud rather than rendering a demoralising flat zero.

import { useState } from 'react';
import { formatCount, formatPct, MIN_RATE_SHOW } from '../../../../lib/adminFormat.js';
import { PanelNote } from '../../SmallN.jsx';

export function HabitCurve({ presence = [], work = [], windowDays = 28 }) {
  const [mode, setMode] = useState('presence');
  const rows = mode === 'work' ? work : presence;

  const total = rows.reduce((a, r) => a + (Number(r.users) || 0), 0);
  const max = rows.reduce((a, r) => Math.max(a, Number(r.users) || 0), 0);
  // A long tail of near-empty buckets is noise; bucket everything past 14 days.
  const CAP = 14;
  const shown = [];
  let tail = 0;
  for (const r of rows) {
    const d = Number(r.active_days) || 0;
    if (d > CAP) tail += Number(r.users) || 0;
    else shown.push({ d, n: Number(r.users) || 0 });
  }
  if (tail > 0) shown.push({ d: `${CAP}+`, n: tail, isTail: true });

  const oneDay = rows.find((r) => Number(r.active_days) === 1);
  const oneDayPct = total ? (Number(oneDay?.users) || 0) / total : 0;

  return (
    <section className="admin-chart-panel">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">Habit curve (L{windowDays})</h3>
        <span className="admin-chart-sub t-meta">
          days active in the last {windowDays}, per user · a tall 1-day bar means tried, not adopted
        </span>
        <button
          type="button"
          className={`admin-toggle ${mode === 'work' ? 'is-on' : ''}`}
          role="switch"
          aria-checked={mode === 'work'}
          onClick={() => setMode(mode === 'work' ? 'presence' : 'work')}
          title="Work counts only days containing a real card, doc or comment write. Presence counts any day the app was open — the definition every retention number used before migration 0248, and more than half of those days contained no work at all."
          style={{ marginLeft: 'auto' }}
        >
          <span className="admin-toggle-dot" aria-hidden="true" />
          {mode === 'work' ? 'Work days' : 'Presence days'}
        </button>
      </header>

      <div className="admin-chart-body">
        {total < MIN_RATE_SHOW ? (
          <PanelNote>
            {mode === 'work'
              ? 'Still collecting. did_work is written from the deploy of migration 0248 onward and cannot be backfilled — an empty curve here means "not yet measured", not zero. Switch to Presence for the historical shape.'
              : 'Not enough active users in this window to draw a distribution.'}
          </PanelNote>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 140 }}>
              {shown.map((b) => (
                <div key={b.d} style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
                  <div className="t-meta" style={{ color: 'var(--ink-2)', fontSize: 11 }}>
                    {b.n > 0 ? formatCount(b.n) : ''}
                  </div>
                  <div
                    title={`${b.n} users active on ${b.d} day(s)`}
                    style={{
                      height: `${max ? Math.round((b.n / max) * 96) : 0}px`,
                      minHeight: b.n > 0 ? 2 : 0,
                      background: b.isTail ? 'var(--ink-3)' : 'var(--ink-2)',
                      borderRadius: '3px 3px 0 0',
                    }}
                  />
                  <div className="t-meta" style={{ color: 'var(--ink-2)', fontSize: 11 }}>{b.d}</div>
                </div>
              ))}
            </div>
            <div className="t-meta" style={{ color: 'var(--ink-2)', marginTop: 10 }}>
              {formatPct(oneDayPct)} of {formatCount(total)} active users showed up on exactly one day
              {mode === 'work' ? ' with real work in it' : ''}.
            </div>
          </>
        )}
      </div>
    </section>
  );
}
