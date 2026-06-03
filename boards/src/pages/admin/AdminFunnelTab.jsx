// AdminFunnelTab — where users drop off in the signup flow.
//
// Reads admin_signup_funnel(p_days, p_source, p_campaign, p_content) →
// ordered { ord, step, label, branch, sessions, users } rows and renders the
// funnel as two branch panels that share the top steps:
//   Waitlist intent:  landing → email → otp → welcome → open form → joined
//   Pricing intent:   landing → email → otp → welcome → pricing → checkout → paid
// plus a "Biggest leaks" summary (largest step-to-step drop + friction events).
//
// Unit = distinct session_id (one funnel attempt). Segmentable by ad
// source / campaign / creative (utm_content) and the standard 7/30/90d range,
// so you can see WHICH campaign/creative produces a given drop-off. Reuses the
// Analytics tab's infra (useAdminData, AdminTimeRange, AdminAsync, adminFormat).

import { useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { formatPct, formatCount } from '../../lib/adminFormat.js';
import { useAdminData } from './useAdminData.js';
import { AdminToolbar, AdminAsync, AdminSkeleton } from './AdminStates.jsx';
import { AdminTimeRange } from './AdminTimeRange.jsx';

export function AdminFunnelTab() {
  const [days, setDays]         = useState(30);
  const [source, setSource]     = useState('');
  const [campaign, setCampaign] = useState('');
  const [content, setContent]   = useState('');

  const { data, loading, error, refreshing, lastUpdated, refresh } = useAdminData(async () => {
    const results = await Promise.allSettled([
      supabase.rpc('admin_signup_funnel', {
        p_days: days,
        p_source: source || null,
        p_campaign: campaign || null,
        p_content: content || null,
      }),
      supabase.rpc('admin_funnel_segments', { p_days: days }),
    ]);
    const [fn, sg] = results;
    const val = (r) => (r.status === 'fulfilled' && !r.value.error ? r.value.data : null);
    const errOf = (r) => (r.status === 'rejected' ? r.reason : r.value?.error) || null;
    if (fn.status !== 'fulfilled' || fn.value.error) {
      throw errOf(fn) || new Error('Failed to load funnel');
    }
    return { steps: val(fn) || [], segments: val(sg) || [] };
  }, [days, source, campaign, content]);

  const steps = data?.steps || [];
  const branch = (b) => steps.filter((s) => s.branch === b);
  const core = branch('core');
  const waitlist = [...core, ...branch('waitlist')];
  const pricing = [...core, ...branch('pricing')];
  const leaks = branch('leak');

  const segments = data?.segments || [];
  const opts = (dim) => segments.filter((s) => s.dim === dim);

  return (
    <div className="admin-analytics">
      <AdminToolbar onRefresh={refresh} refreshing={refreshing} lastUpdated={lastUpdated}>
        <AdminTimeRange value={days} onChange={setDays} />
        <SegmentSelect label="Source"   value={source}   onChange={setSource}   options={opts('source')} />
        <SegmentSelect label="Campaign" value={campaign} onChange={setCampaign} options={opts('campaign')} />
        <SegmentSelect label="Creative" value={content}  onChange={setContent}  options={opts('content')} />
      </AdminToolbar>

      <AdminAsync loading={loading} error={error} onRetry={refresh} skeleton={<AdminSkeleton variant="chart" />}>
        <div className={refreshing ? 'is-refreshing' : ''}>
          <h2 className="admin-section-title">Signup funnel drop-off</h2>
          <div className="admin-section-sub">
            Where sessions fall off in the signup flow{filterLabel(source, campaign, content)} · last {days}d.
            Unit = sessions (one funnel attempt); the flow forks at the welcome screen into the waitlist and pricing paths.
          </div>

          <LeaksSummary waitlist={waitlist} pricing={pricing} leaks={leaks} />
          <FunnelPanel title="Waitlist intent" sub="shared top → waitlist path" rows={waitlist} days={days} />
          <FunnelPanel title="Pricing intent"  sub="shared top → checkout path" rows={pricing}  days={days} />
        </div>
      </AdminAsync>
    </div>
  );
}

// ── Segment dropdown ────────────────────────────────────────────────
function SegmentSelect({ label, value, onChange, options }) {
  return (
    <select
      className="auth-input admin-filter-select"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title={label}
    >
      <option value="">{label}: all</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.value} ({formatCount(o.sessions)})</option>
      ))}
    </select>
  );
}

// ── One branch funnel as a table with per-step drop-off ─────────────
function toSteps(rows) {
  const top = Number(rows[0]?.sessions) || 0;
  return rows.map((r, i) => {
    const sessions = Number(r.sessions) || 0;
    const prev = i > 0 ? (Number(rows[i - 1].sessions) || 0) : null;
    return {
      label: r.label,
      sessions,
      fromTop: top > 0 ? sessions / top : 0,
      step: prev && prev > 0 ? sessions / prev : null,
      drop: prev != null ? prev - sessions : 0,
      dropPct: prev && prev > 0 ? (prev - sessions) / prev : 0,
    };
  });
}

function FunnelPanel({ title, sub, rows, days }) {
  const data = toSteps(rows);
  const top = data[0]?.sessions || 0;
  return (
    <section className="admin-chart-panel admin-chart-panel-wide">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">{title}</h3>
        <span className="admin-chart-sub t-meta">{sub} · {formatCount(top)} at top · last {days}d</span>
      </header>
      <div className="admin-chart-body">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Step</th>
              <th className="num">Sessions</th>
              <th className="num">From top</th>
              <th className="num">Step</th>
              <th className="num">Drop</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d, i) => (
              <tr key={`${d.label}-${i}`}>
                <td>
                  <div className="admin-funnel-step">
                    <span>{d.label}</span>
                    <span className="admin-funnel-bar">
                      <span className="admin-funnel-bar-fill" style={{ width: `${Math.round(d.fromTop * 100)}%` }} />
                    </span>
                  </div>
                </td>
                <td className="num admin-funnel-num">{formatCount(d.sessions)}</td>
                <td className="num admin-funnel-pct">{formatPct(d.fromTop)}</td>
                <td className="num admin-funnel-pct">{i === 0 || d.step == null ? '—' : formatPct(d.step)}</td>
                <td className={`num admin-funnel-drop ${i > 0 && d.drop > 0 ? 'is-loss' : ''}`}>
                  {i === 0 ? '—' : (d.drop > 0 ? `-${formatCount(d.drop)} (${formatPct(d.dropPct)})` : '0')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── Biggest leaks: largest step-to-step drop + friction-event counts ─
function LeaksSummary({ waitlist, pricing, leaks }) {
  const biggest = useMemo(() => {
    const scan = (rows, name) => toSteps(rows)
      .map((d, i) => (i === 0 ? null : { branch: name, to: d.label, from: rows[i - 1].label, drop: d.drop, dropPct: d.dropPct }))
      .filter((x) => x && x.drop > 0);
    const all = [...scan(waitlist, 'Waitlist'), ...scan(pricing, 'Pricing')];
    all.sort((a, b) => b.dropPct - a.dropPct);
    return all[0] || null;
  }, [waitlist, pricing]);

  return (
    <section className="admin-chart-panel admin-chart-panel-wide">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">Biggest leaks</h3>
        <span className="admin-chart-sub t-meta">where the most sessions drop, plus friction signals</span>
      </header>
      <div className="admin-chart-body">
        {biggest && (
          <p className="admin-section-sub">
            Largest single drop: <strong>{biggest.from} → {biggest.to}</strong> ({biggest.branch} path) —
            lost {formatCount(biggest.drop)} sessions ({formatPct(biggest.dropPct)}).
          </p>
        )}
        <table className="admin-table">
          <thead>
            <tr><th>Friction event</th><th className="num">Sessions</th></tr>
          </thead>
          <tbody>
            {leaks.map((l) => (
              <tr key={l.step}>
                <td>{l.label}</td>
                <td className="num admin-funnel-num">{formatCount(l.sessions)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function filterLabel(source, campaign, content) {
  const parts = [];
  if (source) parts.push(source);
  if (campaign) parts.push(campaign);
  if (content) parts.push(`creative ${content}`);
  return parts.length ? ` · ${parts.join(' / ')}` : '';
}
