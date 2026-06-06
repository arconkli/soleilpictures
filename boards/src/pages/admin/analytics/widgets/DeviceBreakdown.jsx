// DeviceBreakdown — what devices our traffic is on: device type (pie) + OS and
// browser (tables), by unique session. Reads admin_device_breakdown jsonb
// { by_device_type, by_os, by_browser } each [{value, sessions, users}].
//
// Forward-looking: events predating device tracking carry no device props and
// bucket as "unknown" — so we note that and don't pretend the early window is
// representative. Internal traffic is excluded by the RPC per the toolbar toggle.

import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';
import { formatCount, formatPct } from '../../../../lib/adminFormat.js';
import { CHART } from '../../chartTheme.js';
import { PanelNote } from '../../SmallN.jsx';

const DEVICE_COLORS = { desktop: '#5b8def', mobile: '#ffa500', tablet: '#43c59e', unknown: '#6b7280' };

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
            <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
              <ResponsiveContainer width={220} height={200}>
                <PieChart>
                  <Pie data={byType} dataKey="sessions" nameKey="value" innerRadius={50} outerRadius={80}
                    paddingAngle={2} stroke="var(--bg-1)" {...CHART.noAnim}>
                    {byType.map((d) => <Cell key={d.value} fill={DEVICE_COLORS[d.value] || '#888'} />)}
                  </Pie>
                  <Tooltip {...CHART.tooltip} formatter={(v, n) => [`${formatCount(v)} sessions`, n]} />
                  <Legend wrapperStyle={{ fontSize: 11, color: 'var(--ink-2)' }} iconType="circle" iconSize={9} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: 'flex', gap: 20, flex: 1, flexWrap: 'wrap' }}>
                <MiniTable title="OS" rows={byOs} />
                <MiniTable title="Browser" rows={byBrowser} />
              </div>
            </div>
            <PanelNote>
              A session ≈ one browser/device. Forward-looking — events before device tracking shipped show as “unknown”.
            </PanelNote>
          </>
        )}
      </div>
    </section>
  );
}
