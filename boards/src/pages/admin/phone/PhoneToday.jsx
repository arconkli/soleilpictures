// PhoneToday.jsx — the panel's first tab: today's three numbers, this week vs
// last, the newest signups and what needs a look. Every figure is one the
// desktop admin already reads (see lib/phonePanel.js), under the Overview's
// defaults: team left out, verified only.
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase.js';
import {
  signupsToday, usualDay, measureRows, signupRow, formatCount,
} from '../../../lib/phonePanel.js';
import { channelLabel } from '../AdminUserDetailParts.jsx';

const FILTERS = { p_exclude_internal: true, p_verified_only: true };

async function loadToday() {
  const [kpi, weeks, active, stats, signups, approvals, boards, errors] = await Promise.allSettled([
    supabase.rpc('admin_kpi_summary', { p_days: 7, ...FILTERS }),
    supabase.rpc('admin_weekly_series', { p_weeks: 13, ...FILTERS }),
    supabase.rpc('admin_active_now', { p_window_minutes: 5, p_exclude_internal: true }),
    supabase.rpc('admin_stats', { p_verified_only: true }),
    supabase.rpc('admin_recent_signups', { p_limit: 50, ...FILTERS }),
    supabase.rpc('admin_public_board_submission_counts'),
    supabase.rpc('showcase_waiting'),
    supabase.rpc('admin_error_groups', { p_days: 2, p_lens: 'problems', p_status: 'open', p_env: 'prod', p_kind: null }),
  ]);
  const val = (r) => (r.status === 'fulfilled' && !r.value.error ? r.value.data : null);
  if (val(kpi) == null && val(signups) == null) {
    throw (kpi.status === 'rejected' ? kpi.reason : kpi.value?.error) || new Error('Couldn’t load the numbers');
  }
  return {
    kpi: val(kpi),
    weeks: val(weeks) || [],
    active: val(active),
    paying: val(stats)?.sub_counts?.active ?? null,
    signups: val(signups) || [],
    approvals: val(approvals)?.pending ?? null,
    boards: val(boards),
    newErrors: val(errors)?.totals?.new ?? null,
  };
}

function Spark({ spark }) {
  if (!spark) return <span />;
  return (
    <svg className="ap-spark" viewBox="0 0 70 24" aria-hidden="true">
      <polyline points={spark.points} />
      <circle cx={spark.last.x} cy={spark.last.y} r="2.4" />
    </svg>
  );
}

function MeasureSheet({ row, onClose }) {
  const max = Math.max(1, ...row.values.map((v) => Number(v) || 0));
  return (
    <div className="ap-sheet-bg" onClick={onClose} role="presentation">
      <div className="ap-sheet" role="dialog" aria-modal="true" aria-label={row.label} onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <h3>{row.label} · {row.value}</h3>
        <p>{row.about}{row.values.length ? ' Each bar is a week; the last is this week so far.' : ''}</p>
        {row.values.length > 0 && (
          <div className="ap-bars">
            {row.values.map((v, i) => (
              <div key={row.weeks[i] || i}>
                <i style={{ height: `${Math.round(((Number(v) || 0) / max) * 100)}%` }} />
                <small>{formatCount(v)}</small>
              </div>
            ))}
          </div>
        )}
        <a className="ap-btn" href="/admin?tab=overview&full=1" style={{ display: 'grid', placeItems: 'center', textDecoration: 'none' }}>
          Open full admin
        </a>
      </div>
    </div>
  );
}

export function PhoneToday({ refreshKey, onLoaded, onRetry, onBoards }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    let cancelled = false;
    loadToday().then(
      (d) => { if (!cancelled) { setData(d); setError(null); onLoaded?.(true); } },
      (e) => { if (!cancelled) { setError(e); onLoaded?.(false); } },
    );
    return () => { cancelled = true; };
  }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const now = new Date();
  const view = useMemo(() => {
    if (!data) return null;
    const today = signupsToday(data.signups, now);
    return {
      today,
      usual: usualDay(data.weeks),
      rows: measureRows(data.kpi, data.weeks),
      people: data.signups.slice(0, 5).map((r) => signupRow(r, now, channelLabel)),
    };
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !data) {
    return (
      <div className="ap-card ap-err" role="alert">
        Couldn’t load the numbers. {error.message || ''}
        <div><button type="button" className="ap-btn" onClick={onRetry}>Try again</button></div>
      </div>
    );
  }
  if (!view) return <div className="ap-card ap-err" aria-busy="true">Loading…</div>;

  const paying = data.paying;
  const look = [
    { key: 'boards', n: data.boards, one: 'Board waiting for your OK', many: 'Boards waiting for your OK', onClick: onBoards },
    { key: 'approvals', n: data.approvals, one: 'Public cluster to approve', many: 'Public clusters to approve', href: '/admin?tab=approvals&full=1' },
    { key: 'errors', n: data.newErrors, one: 'New problem in the last 2 days', many: 'New problems in the last 2 days', href: '/admin?tab=errors&full=1', warn: true },
  ].filter((x) => x.n != null);

  return (
    <>
      <div className="ap-big">
        <div className="ap-card" data-testid="ap-signups-today">
          <b>{formatCount(view.today.n)}{view.today.capped ? '+' : ''}</b>
          <span>Signups today</span>
          {view.usual != null && <em>a usual day: {formatCount(view.usual)}</em>}
        </div>
        <div className="ap-card" data-testid="ap-active-now">
          <b>{formatCount(data.active)}{Number(data.active) > 0 && <i className="ap-live" aria-hidden="true" />}</b>
          <span>In the app now</span>
          <em>last 5 minutes</em>
        </div>
        <div className="ap-card" data-testid="ap-paying">
          <b>{formatCount(paying)}</b>
          <span>Paying</span>
          <em>active subscriptions</em>
        </div>
      </div>

      <h2>This week vs last</h2>
      <div className="ap-card ap-rows">
        {view.rows.map((r) => (
          <button type="button" key={r.id} onClick={() => setOpen(r)} data-testid={`ap-row-${r.id}`}>
            <div className="ap-lab">{r.label}{r.sub && <small>{r.sub}</small>}</div>
            <Spark spark={r.spark} />
            <div className="ap-num">{r.value}<small className={r.delta.dir}>{r.delta.text}</small></div>
            <div className="ap-chev" aria-hidden="true">›</div>
          </button>
        ))}
      </div>

      {view.people.length > 0 && (
        <>
          <h2>Newest signups</h2>
          <div className="ap-card ap-who">
            {view.people.map((p) => (
              <div key={p.id}>
                <div className="ap-av" aria-hidden="true">{p.initials}</div>
                <div className="t"><b>{p.name}</b><small>from {p.from} · {p.made}</small></div>
                <div className="ap-when">{p.when}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {look.length > 0 && (
        <>
          <h2>Needs a look</h2>
          <div className="ap-card ap-look">
            {look.map((x) => {
              const inner = (
                <>
                  <span className={`n${x.warn && x.n > 0 ? ' warn' : ''}`}>{formatCount(x.n)}</span>
                  <span className="lbl">{x.n === 1 ? x.one : x.many}</span>
                  <span className="ap-chev" aria-hidden="true">›</span>
                </>
              );
              return x.href
                ? <a key={x.key} href={x.href}>{inner}</a>
                : <button key={x.key} type="button" onClick={x.onClick}>{inner}</button>;
            })}
          </div>
        </>
      )}

      <div className="ap-foot">Team left out · pull down to refresh · <a href="/admin?full=1">full admin</a></div>
      {open && <MeasureSheet row={open} onClose={() => setOpen(null)} />}
    </>
  );
}

