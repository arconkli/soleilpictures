// DeviceBreakdown — what devices our traffic is on: device type, OS and
// browser, by unique session. Reads admin_device_breakdown jsonb
// { by_device_type, by_os, by_browser } each [{value, sessions, users}].
//
// The device split was a donut. Four categories, so the reader compared four
// angles and then hunted a legend to find out which was which — while the OS
// and browser tables sitting beside it, showing the same kind of data, were
// perfectly legible ranked rows. It is rows now, in the same shape as its
// neighbours.
//
// Forward-looking: events predating device tracking carry no device props and
// bucket as "unknown", so we say so rather than implying the early window is
// representative. Internal traffic is excluded by the RPC per the toolbar toggle.

import { formatCount, formatPct } from '../../../../lib/adminFormat.js';
import { BarRows } from '../../viz/BarRows.jsx';
import { DEVICE_COLOR } from '../../viz/palette.js';
import { PanelNote } from '../../SmallN.jsx';

function MiniTable({ title, rows }) {
  const total = rows.reduce((s, r) => s + (Number(r.sessions) || 0), 0);
  return (
    <div style={{ flex: 1, minWidth: 190 }}>
      <table className="admin-table">
        <thead>
          <tr><th>{title}</th><th className="num">Sessions</th><th className="num">Share</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.value}>
              <td style={{ textTransform: 'capitalize' }}>{r.value}</td>
              <td className="num">{formatCount(r.sessions)}</td>
              <td className="num admin-muted">{total ? formatPct((Number(r.sessions) || 0) / total) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DeviceBreakdown({ data, days = 30 }) {
  const byType = data?.by_device_type || [];
  const byOs = data?.by_os || [];
  const byBrowser = data?.by_browser || [];
  // "Real" = at least one non-unknown bucket; otherwise device props haven't accrued.
  const hasReal = byType.some((r) => r.value !== 'unknown' && (Number(r.sessions) || 0) > 0);

  const typeTotal = byType.reduce((s, r) => s + (Number(r.sessions) || 0), 0);
  const typeRows = [...byType]
    .map((r) => ({ key: r.value, label: r.value, value: Number(r.sessions) || 0 }))
    .sort((a, b) => b.value - a.value);

  return (
    <section className="admin-chart-panel admin-chart-panel-wide">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">Device breakdown</h3>
        <span className="admin-chart-sub t-meta">type · OS · browser, by unique session · last {days}d</span>
      </header>
      <div className="admin-chart-body">
        {!hasReal ? (
          <div className="admin-empty">
            No device data yet — events started carrying device info recently; this fills in as new traffic arrives.
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 280px', minWidth: 260 }}>
                <BarRows
                  rows={typeRows}
                  formatValue={(v) => formatCount(v)}
                  secondary={(r) => (typeTotal ? formatPct(r.value / typeTotal) : '—')}
                  colors={(r) => DEVICE_COLOR[r.key] || DEVICE_COLOR.unknown}
                  isMuted={(r) => r.key === 'unknown'}
                />
              </div>
              <div style={{ display: 'flex', gap: 20, flex: '2 1 380px', flexWrap: 'wrap' }}>
                <MiniTable title="OS" rows={byOs} />
                <MiniTable title="Browser" rows={byBrowser} />
              </div>
            </div>
            <PanelNote>
              A session here is one browser/device, not one visit — session_id is minted once into
              localStorage and never rotated. Forward-looking: events from before device tracking
              shipped show as “unknown”.
            </PanelNote>
          </>
        )}
      </div>
    </section>
  );
}
