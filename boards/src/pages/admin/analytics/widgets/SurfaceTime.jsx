// SurfaceTime — where the time actually goes.
//
// profiles.seconds_in_app is a single undimensioned integer: it can say someone
// spent forty minutes here and nothing about where. This reads usage_session
// (migration 0248), which banks active seconds against the surface that was on
// screen for them.
//
// It necessarily starts empty and fills from the deploy. The empty state says
// that in words, because an empty chart that looks like a zero is exactly how a
// measurement gap gets mistaken for a finding.

import { formatCount, formatPct } from '../../../../lib/adminFormat.js';
import { PanelNote } from '../../SmallN.jsx';

export function SurfaceTime({ rows = [], days = 28 }) {
  const total = rows.reduce((a, r) => a + (Number(r.minutes) || 0), 0);

  return (
    <section className="admin-chart-panel">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">Where the time goes</h3>
        <span className="admin-chart-sub t-meta">
          last {days}d · active seconds per surface, not tab-open time
        </span>
      </header>

      <div className="admin-chart-body">
        {rows.length === 0 ? (
          <PanelNote>
            Still collecting. Per-surface time is written by the heartbeat from the deploy of
            migration 0248 onward and cannot be backfilled — an empty panel here means
            &ldquo;not yet measured&rdquo;, not that nobody used the app.
          </PanelNote>
        ) : (
          <>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Surface</th>
                  <th style={{ textAlign: 'right' }}>Users</th>
                  <th style={{ textAlign: 'right' }}>Sessions</th>
                  <th style={{ textAlign: 'right' }}>Minutes</th>
                  <th style={{ textAlign: 'right' }}>Share</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.surface}>
                    <td>{r.surface}</td>
                    <td style={{ textAlign: 'right' }}>{formatCount(Number(r.users) || 0)}</td>
                    <td style={{ textAlign: 'right' }}>{formatCount(Number(r.sessions) || 0)}</td>
                    <td style={{ textAlign: 'right' }}>{formatCount(Math.round(Number(r.minutes) || 0))}</td>
                    <td style={{ textAlign: 'right' }}>{formatPct(Number(r.pct) || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <PanelNote>
              {formatCount(Math.round(total))} active minutes across {rows.length} surfaces. Schedule
              cards live on the canvas and count as canvas time; docked panels are excluded on
              purpose, since a pinned panel would otherwise absorb every subsequent second.
            </PanelNote>
          </>
        )}
      </div>
    </section>
  );
}
