// TimeToFirstCard — how long from signup to the first GENUINE card. Reads the
// admin_time_to_first_card jsonb { total_signed_up, with_card, never, pending,
// p50_sec, p90_sec, p95_sec, buckets:[{label,ord,users}], by_source[], by_device[] }
// and renders a median headline + a time-bucket histogram with a source/device
// segment toggle (mirrors LifespanDistribution + RetentionBySource conventions).
//
// Honesty: right-censored — a user who signed up minutes ago and hasn't placed a
// card isn't a failure, just un-elapsed. The 'never' bucket counts only signups
// older than the largest finite bucket (>30m); the rest are 'pending' and sit
// outside the histogram. Gated below MIN_RATE_SHOW.

import { useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LabelList } from 'recharts';
import { formatCount, MIN_RATE_SHOW } from '../../../../lib/adminFormat.js';
import { CHART } from '../../chartTheme.js';
import { PanelNote, ChartPlaceholder } from '../../SmallN.jsx';

const SOLEIL = '#ffa500';
// Canonical order so a missing bucket still shows a 0-height bar, left→right by time.
const BUCKETS = ['<30s', '30-60s', '1-5m', '5-30m', '>30m', 'never'];

function fmtSec(n) {
  const s = Number(n) || 0;
  if (s <= 0) return '—';
  if (s < 1) return '<1s';
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${(s / 60).toFixed(1)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}

function Panel({ children }) {
  return (
    <section className="admin-chart-panel admin-chart-panel-wide">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">Time to first card</h3>
        <span className="admin-chart-sub t-meta">signup → first genuine card — where activation actually happens (or stalls)</span>
      </header>
      <div className="admin-chart-body">{children}</div>
    </section>
  );
}

function Histogram({ buckets }) {
  const counts = new Map((buckets || []).map((b) => [b.label, Number(b.users) || 0]));
  const chartData = BUCKETS.map((label) => ({ label, users: counts.get(label) || 0 }));
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={chartData} margin={{ top: 12, right: 12, bottom: 0, left: -12 }}>
        <CartesianGrid {...CHART.grid} />
        <XAxis dataKey="label" {...CHART.axis} />
        <YAxis {...CHART.axis} allowDecimals={false} />
        <Tooltip {...CHART.tooltip} cursor={{ fill: 'rgba(255,165,0,.08)' }}
          formatter={(v) => [`${formatCount(v)} user${Number(v) === 1 ? '' : 's'}`, 'users']}
          labelFormatter={(l) => (l === 'never' ? 'never (no card after >30m)' : l)} />
        <Bar dataKey="users" fill={SOLEIL} radius={[3, 3, 0, 0]} {...CHART.noAnim}>
          <LabelList dataKey="users" position="top" formatter={(v) => (v > 0 ? formatCount(v) : '')} fill="var(--ink-2)" fontSize={11} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function TimeToFirstCard({ data }) {
  const total = Number(data?.total_signed_up) || 0;
  const [seg, setSeg] = useState('overall');

  if (total < MIN_RATE_SHOW) {
    return (
      <Panel>
        <ChartPlaceholder title="Time-to-first-card is still collecting"
          sub={`Needs ≥${MIN_RATE_SHOW} signed-up users. So far: ${total}.`} />
      </Panel>
    );
  }

  // Build the segment chip list: Overall + each acquisition source + each device.
  const sources = (data?.by_source || []).filter((s) => (Number(s.total) || 0) > 0);
  const devices = (data?.by_device || []).filter((d) => (Number(d.total) || 0) > 0);
  const segments = [
    { key: 'overall', label: 'Overall', buckets: data?.buckets || [], total },
    ...sources.map((s) => ({ key: `src:${s.source}`, label: s.source, buckets: s.buckets || [], total: Number(s.total) || 0 })),
    ...devices.map((d) => ({ key: `dev:${d.device}`, label: d.device, buckets: d.buckets || [], total: Number(d.total) || 0 })),
  ];
  const active = segments.find((s) => s.key === seg) || segments[0];

  return (
    <Panel>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
        <span style={{ font: '700 26px/1 var(--font-display, inherit)', color: 'var(--ink-0)' }}>{fmtSec(data?.p50_sec)}</span>
        <span className="t-meta" style={{ color: 'var(--ink-3)' }}>
          median · p90 {fmtSec(data?.p90_sec)} · p95 {fmtSec(data?.p95_sec)} · {formatCount(data?.with_card)} of {formatCount(total)} placed a card
        </span>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        {segments.map((s) => (
          <button key={s.key} type="button" onClick={() => setSeg(s.key)}
            className={`admin-chip${s.key === active.key ? ' is-active' : ''}`}
            style={{
              padding: '3px 10px', fontSize: 12, borderRadius: 999, cursor: 'pointer',
              border: '1px solid var(--line-2)',
              background: s.key === active.key ? 'var(--bg-3, rgba(255,165,0,.12))' : 'transparent',
              color: s.key === active.key ? 'var(--ink-0)' : 'var(--ink-2)',
            }}>
            {s.label}{s.key !== 'overall' ? ` · ${formatCount(s.total)}` : ''}
          </button>
        ))}
      </div>

      {active.total < MIN_RATE_SHOW
        ? <ChartPlaceholder title={`“${active.label}” is too small to split`} sub={`Needs ≥${MIN_RATE_SHOW} users in this segment; has ${formatCount(active.total)}.`} />
        : <Histogram buckets={active.buckets} />}

      <PanelNote>
        Right-censored: recent signups who haven’t placed a card yet are “pending”
        ({formatCount(data?.pending)}), not failures, and fill in as cohorts age — only signups older than
        30m with no card count as “never” ({formatCount(data?.never)}). Percentiles are over users who DID
        place a card. Compare to your own past snapshots.
      </PanelNote>
    </Panel>
  );
}
