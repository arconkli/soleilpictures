// AdminErrorsTab — the Issues view: every problem people run into, in one place.
//
// The owner decided on 2026-10-24 that nothing routine is emailed: 0581 sends
// an email only when something is super breaking, and everything else waits
// here. So this tab answers, at a glance, what is failing, for how many people,
// since when, whether it is getting worse, and what they were doing.
//
//   Problems        client_errors by group (0580's fingerprint), from
//                   admin_error_groups (0582): people, a 14-day spark, badges
//                   (breaking now, new, returned), resolve and mute. A row opens
//                   its trend, releases, browsers, paths and latest occurrences
//                   with the steps before each, and one browser's trail.
//   Failed actions  what failed without throwing, from analytics
//                   (admin_failure_events): sign-in, checkout, imports, moves...
//   Clicks          clicks that did nothing and rage clicks (admin_click_friction).
//
// Staff accounts and their browsers are left out of every count (0582).

import { useCallback, useState, Fragment } from 'react';
import { supabase } from '../../lib/supabase.js';
import { useFeedback } from '../../components/AppFeedback.jsx';
import { Icon } from '../../components/Icon.jsx';
import { relativeTime, fmtDateTime, formatCount } from '../../lib/adminFormat.js';
import {
  ISSUE_LENSES, ISSUE_STATUSES, ISSUE_ENVS, kindLabel, sourceLabel, ruleLabel, breakingOutcome,
  failureLabel, issueText,
} from '../../lib/adminIssues.js';
import { useAdminData } from './useAdminData.js';
import { AdminToolbar, AdminAsync, AdminSkeleton } from './AdminStates.jsx';
import { AdminStatCard } from './AdminStatCard.jsx';
import { AdminTimeRange } from './AdminTimeRange.jsx';
import { Spark } from './viz/TrendLine.jsx';
import { AdminIssueDetail } from './AdminIssueDetail.jsx';
import { CopyButton, SeverityBadge } from './AdminIssueBits.jsx';
import { Warning, Eye, EyeOff, CheckCircle, RotateCcw } from '../../lib/icons.js';
import './adminIssues.css';

const VIEWS = [
  { id: 'problems', label: 'Problems' },
  { id: 'actions', label: 'Failed actions' },
  { id: 'clicks', label: 'Clicks' },
];

function Segmented({ label, options, value, onChange }) {
  return (
    <div className="tob-segmented admin-range" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" title={o.title}
                className={value === o.id ? 'is-active' : ''} aria-pressed={value === o.id}
                onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function GroupBadges({ g }) {
  return (
    <>
      {g.breaking && <span className="iss-badge iss-badge-breaking" title="Widespread right now: the breaking check counts it, and emails it at most every 6 hours">Breaking</span>}
      {g.returned && <span className="iss-badge iss-badge-returned" title="Resolved, then seen again on a new release">Returned</span>}
      {g.is_new && <span className="iss-badge iss-badge-new" title="First seen in the last 48 hours">New</span>}
      {g.status === 'resolved' && <span className="iss-badge iss-badge-resolved">Resolved</span>}
      {g.status === 'muted' && <span className="iss-badge iss-badge-muted">Muted</span>}
    </>
  );
}

// What 0581 would email this minute, and what it emailed this week.
function BreakingPanel({ breaking, alerts }) {
  if (!breaking.length && !alerts.length) return null;
  return (
    <section className={`iss-breaking ${breaking.length ? 'is-live' : ''}`} aria-label="Breaking problems">
      {breaking.length > 0 && (
        <>
          <h3 className="iss-breaking-title">
            <Icon as={Warning} size={15} /> Breaking now
          </h3>
          <ul className="iss-breaking-list">
            {breaking.map((b, i) => (
              <li key={`${b.rule}:${b.problem || i}`}>
                <span className="iss-breaking-rule">{ruleLabel(b.rule)}</span>
                <span className="iss-breaking-what">{b.title}</span>
                {b.outcome && <span className="iss-breaking-outcome t-meta">{breakingOutcome(b.outcome)}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
      {alerts.length > 0 && (
        <div className="iss-breaking-sent t-meta">
          Emailed this week:{' '}
          {alerts.slice(0, 5).map((a, i) => (
            <span key={a.id} title={fmtDateTime(a.at)}>
              {i > 0 && ' · '}{a.title} ({relativeTime(a.at)})
            </span>
          ))}
          {alerts.length > 5 && ` · ${alerts.length - 5} more`}
        </div>
      )}
    </section>
  );
}

function ProblemsView({ days, controls }) {
  const feedback = useFeedback();
  const [lens, setLens] = useState('problems');
  const [status, setStatus] = useState('open');
  const [env, setEnv] = useState('prod');
  const [kind, setKind] = useState('');
  const [open, setOpen] = useState(() => new Set());
  const [busy, setBusy] = useState(null);

  const fetchGroups = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_error_groups', {
      p_days: days, p_lens: lens, p_status: status, p_env: env, p_kind: kind || null,
    });
    if (error) throw error;
    return data;
  }, [days, lens, status, env, kind]);
  const q = useAdminData(fetchGroups, [days, lens, status, env, kind]);
  const groups = q.data?.groups || [];
  const totals = q.data?.totals || {};
  const kinds = q.data?.kinds || [];
  const breaking = q.data?.breaking || [];
  const alerts = q.data?.alerts || [];

  const toggle = (fp) => setOpen((prev) => {
    const n = new Set(prev);
    if (n.has(fp)) n.delete(fp); else n.add(fp);
    return n;
  });

  const setGroupStatus = async (g, next, { undo = true } = {}) => {
    setBusy(g.fingerprint);
    try {
      const { error } = await supabase.rpc('admin_set_error_group_status', { p_fingerprint: g.fingerprint, p_status: next });
      if (error) throw error;
      const was = g.status || 'open';
      const words = { resolved: 'Resolved', muted: 'Muted', open: 'Reopened' };
      feedback.toast({
        type: 'success',
        message: `${words[next]}: ${kindLabel(g.kind)}`,
        action: undo ? { label: 'Undo', onClick: () => setGroupStatus({ ...g, status: next }, was, { undo: false }) } : null,
      });
      await q.refresh();
    } catch (ex) {
      feedback.toast({ type: 'error', code: 'admin_issue_status_failed', message: `Couldn't change it: ${ex?.message || ex}` });
    } finally {
      setBusy(null);
    }
  };

  const actions = (g) => (
    <span className="admin-actions">
      <CopyButton getText={() => issueText(g)} title="Copy problem" />
      {g.status === 'open' && (
        <button type="button" className="admin-iconbtn" disabled={busy === g.fingerprint}
                onClick={(e) => { e.stopPropagation(); setGroupStatus(g, 'resolved'); }}
                onKeyDown={(e) => e.stopPropagation()}
                title="Resolve: it reopens if a new release brings it back" aria-label="Resolve">
          <Icon as={CheckCircle} size={14} />
        </button>
      )}
      {g.status !== 'open' && (
        <button type="button" className="admin-iconbtn" disabled={busy === g.fingerprint}
                onClick={(e) => { e.stopPropagation(); setGroupStatus(g, 'open'); }}
                onKeyDown={(e) => e.stopPropagation()}
                title={g.status === 'muted' ? 'Unmute' : 'Reopen'} aria-label={g.status === 'muted' ? 'Unmute' : 'Reopen'}>
          <Icon as={g.status === 'muted' ? Eye : RotateCcw} size={14} />
        </button>
      )}
      {g.status !== 'muted' && (
        <button type="button" className="admin-iconbtn" disabled={busy === g.fingerprint}
                onClick={(e) => { e.stopPropagation(); setGroupStatus(g, 'muted'); }}
                onKeyDown={(e) => e.stopPropagation()}
                title="Mute: hide it and keep it out of the breaking emails" aria-label="Mute">
          <Icon as={EyeOff} size={14} />
        </button>
      )}
    </span>
  );

  const emptyBody = status === 'open'
    ? `Nothing open in the last ${days} days${lens === 'problems' ? '' : ' through this lens'}.`
    : `Nothing ${status === 'all' ? '' : `${status} `}in the last ${days} days.`;

  return (
    <>
      <AdminToolbar onRefresh={q.refresh} refreshing={q.refreshing} lastUpdated={q.lastUpdated}>
        {controls}
      </AdminToolbar>
      <div className="iss-filters">
        <Segmented label="Lens" options={ISSUE_LENSES} value={lens} onChange={(v) => { setLens(v); setKind(''); }} />
        <Segmented label="Status" options={ISSUE_STATUSES} value={status} onChange={setStatus} />
        <Segmented label="Environment" options={ISSUE_ENVS} value={env} onChange={setEnv} />
        <label className="iss-kind">
          <span className="t-meta">Kind</span>
          <select className="auth-input admin-filter-select" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All kinds</option>
            {kinds.map((k) => (
              <option key={k.kind} value={k.kind}>{kindLabel(k.kind)} ({formatCount(k.groups)})</option>
            ))}
            {kind && !kinds.some((k) => k.kind === kind) && <option value={kind}>{kindLabel(kind)}</option>}
          </select>
        </label>
      </div>

      <AdminAsync
        loading={q.loading}
        error={q.error}
        hasData={q.hasData}
        onRetry={q.refresh}
        skeleton={<><AdminSkeleton variant="cards" rows={4} /><AdminSkeleton variant="table" /></>}
        isEmpty={false}
      >
        <div className={q.refreshing ? 'is-refreshing' : ''}>
          <BreakingPanel breaking={breaking} alerts={alerts} />

          <div className="admin-stat-grid">
            <AdminStatCard label="Problems" value={formatCount(totals.problems)}
                           sub={`${formatCount(totals.new)} new · ${formatCount(totals.returned)} returned · last ${days}d`} />
            <AdminStatCard label="People affected" value={formatCount(totals.people)}
                           sub="distinct browsers, staff left out"
                           title="Each browser counts once across every problem shown, as 0581 counts people." />
            <AdminStatCard label="Saw a crash screen" value={formatCount(totals.crash_people)} sub="people" />
            <AdminStatCard label="Breaking now" value={formatCount(breaking.filter((b) => b.rule !== 'check_failed').length)}
                           sub={breaking.length ? 'see above' : 'nothing would email'} />
          </div>

          {groups.length === 0 ? (
            <div className="iss-empty">
              <Icon as={Warning} size={18} />
              <div>
                <div className="iss-empty-title">No problems here</div>
                <div className="t-meta">{emptyBody}</div>
              </div>
            </div>
          ) : (
            <section className="admin-chart-panel admin-chart-panel-wide">
              <header className="admin-chart-head">
                <h3 className="admin-chart-title">
                  {formatCount(groups.length)}{groups.length >= 200 ? '+' : ''} problem{groups.length === 1 ? '' : 's'} · last {days} days
                </h3>
                <span className="admin-chart-sub t-meta">most people first · open a row for its trend, occurrences and steps</span>
              </header>
              <div className="admin-chart-body">
                <table className="admin-table iss-table">
                  <thead>
                    <tr>
                      <th>Problem</th>
                      <th className="num">People</th>
                      <th className="num">Times</th>
                      <th className="iss-spark-col">14 days</th>
                      <th className="num">Last seen</th>
                      <th className="num" aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((g) => {
                      const isOpen = open.has(g.fingerprint);
                      return (
                        <Fragment key={g.fingerprint}>
                          <tr role="button" tabIndex={0} aria-expanded={isOpen}
                              className={`admin-error-grouprow iss-row${g.status === 'muted' ? ' admin-row-muted' : ''}${isOpen ? ' is-open' : ''}`}
                              onClick={() => toggle(g.fingerprint)}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(g.fingerprint); } }}>
                            <td className="iss-problem">
                              <div className="iss-problem-head">
                                <SeverityBadge severity={g.severity} />
                                <span className="admin-error-kind t-meta">{kindLabel(g.kind)}</span>
                                <GroupBadges g={g} />
                              </div>
                              <div className="iss-problem-msg">{g.message || '(no message)'}</div>
                              <div className="iss-problem-sub t-meta">
                                {sourceLabel(g.source)}
                                {g.path && <> · {g.path}</>}
                                {g.first_seen && <> · first seen <span title={fmtDateTime(g.first_seen)}>{relativeTime(g.first_seen)}</span></>}
                                {g.last_release && <> · {g.last_release}</>}
                              </div>
                            </td>
                            <td className="num">{formatCount(g.people)}</td>
                            <td className="num">{formatCount(g.n)}</td>
                            <td className="iss-spark-col"><div className="iss-spark"><Spark values={g.spark || []} height={22} /></div></td>
                            <td className="num" title={fmtDateTime(g.last_at)}>{relativeTime(g.last_at)}</td>
                            <td className="num" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                              {actions(g)}
                            </td>
                          </tr>
                          {isOpen && (
                            <tr className="iss-detail-row">
                              <td colSpan={6}><AdminIssueDetail group={g} days={days} stamp={q.lastUpdated} /></td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </AdminAsync>
    </>
  );
}

function ReasonChips({ reasons }) {
  if (!reasons?.length) return <span className="t-meta">—</span>;
  return (
    <span className="iss-chips">
      {reasons.map((r) => <span key={r.why} className="iss-chip">{r.why} <b>{formatCount(r.n)}</b></span>)}
    </span>
  );
}

function ActionsView({ days, controls }) {
  const fetchActions = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_failure_events', { p_days: days });
    if (error) throw error;
    return data;
  }, [days]);
  const q = useAdminData(fetchActions, [days]);
  const rows = q.data?.actions || [];
  const totals = q.data?.totals || {};
  return (
    <>
      <AdminToolbar onRefresh={q.refresh} refreshing={q.refreshing} lastUpdated={q.lastUpdated}>
        {controls}
      </AdminToolbar>
      <AdminAsync loading={q.loading} error={q.error} hasData={q.hasData} onRetry={q.refresh}
                  skeleton={<><AdminSkeleton variant="cards" rows={3} /><AdminSkeleton variant="table" /></>}
                  isEmpty={rows.length === 0}
                  empty={{ icon: Warning, title: 'No failed actions', body: `Nothing people tried failed in the last ${days} days.` }}>
        <div className={q.refreshing ? 'is-refreshing' : ''}>
          <div className="admin-stat-grid">
            <AdminStatCard label="Failed actions" value={formatCount(totals.n)} sub={`last ${days}d`} />
            <AdminStatCard label="People" value={formatCount(totals.people)} sub="distinct browsers, staff left out" />
            <AdminStatCard label="Kinds of action" value={formatCount(totals.actions)} />
          </div>
          <section className="admin-chart-panel admin-chart-panel-wide">
            <header className="admin-chart-head">
              <h3 className="admin-chart-title">What people tried that failed · last {days} days</h3>
              <span className="admin-chart-sub t-meta">recorded by analytics: these never throw, so Problems doesn't see them</span>
            </header>
            <div className="admin-chart-body">
              <table className="admin-table iss-table">
                <thead>
                  <tr>
                    <th>Action</th>
                    <th className="num">People</th>
                    <th className="num">Times</th>
                    <th className="iss-spark-col">14 days</th>
                    <th className="num">Last</th>
                    <th>Why</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.event}>
                      <td>
                        <div className="iss-problem-msg">{failureLabel(r.event)}</div>
                        <div className="iss-problem-sub t-meta">{r.event}</div>
                      </td>
                      <td className="num">{formatCount(r.people)}</td>
                      <td className="num">{formatCount(r.n)}</td>
                      <td className="iss-spark-col"><div className="iss-spark"><Spark values={r.spark || []} height={22} /></div></td>
                      <td className="num" title={fmtDateTime(r.last_at)}>{relativeTime(r.last_at)}</td>
                      <td><ReasonChips reasons={r.reasons} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </AdminAsync>
    </>
  );
}

const SURFACE_LABELS = { app: 'App', landing: 'Sign-in', upsell: 'Upgrade', pricing: 'Pricing' };

function ClicksView({ days, controls }) {
  const fetchClicks = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_click_friction', { p_days: days });
    if (error) throw error;
    return data;
  }, [days]);
  const q = useAdminData(fetchClicks, [days]);
  const rows = q.data?.targets || [];
  const totals = q.data?.totals || {};
  return (
    <>
      <AdminToolbar onRefresh={q.refresh} refreshing={q.refreshing} lastUpdated={q.lastUpdated}>
        {controls}
      </AdminToolbar>
      <AdminAsync loading={q.loading} error={q.error} hasData={q.hasData} onRetry={q.refresh}
                  skeleton={<><AdminSkeleton variant="cards" rows={3} /><AdminSkeleton variant="table" /></>}
                  isEmpty={rows.length === 0}
                  empty={{ icon: Warning, title: 'No dead or rage clicks', body: `None recorded in the last ${days} days.` }}>
        <div className={q.refreshing ? 'is-refreshing' : ''}>
          <div className="admin-stat-grid">
            <AdminStatCard label="Clicks that did nothing" value={formatCount(totals.dead)} sub={`last ${days}d`} />
            <AdminStatCard label="Rage clicks" value={formatCount(totals.rage)} sub="several fast clicks on one spot" />
            <AdminStatCard label="People" value={formatCount(totals.people)} sub="distinct browsers, staff left out" />
          </div>
          <section className="admin-chart-panel admin-chart-panel-wide">
            <header className="admin-chart-head">
              <h3 className="admin-chart-title">Where clicks went nowhere · last {days} days</h3>
              <span className="admin-chart-sub t-meta">by what was clicked, most people first</span>
            </header>
            <div className="admin-chart-body">
              <table className="admin-table iss-table">
                <thead>
                  <tr>
                    <th>Clicked</th>
                    <th>Where</th>
                    <th>Kind</th>
                    <th className="num">People</th>
                    <th className="num">Times</th>
                    <th className="num">Last</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.surface}|${r.k}|${r.tgt}`}>
                      <td className="iss-mono">{r.tgt}</td>
                      <td>{SURFACE_LABELS[r.surface] || r.surface}</td>
                      <td>{r.k === 'rage' ? <span className="iss-badge iss-badge-returned">Rage</span> : <span className="iss-badge iss-sev-warning">Dead</span>}</td>
                      <td className="num">{formatCount(r.people)}</td>
                      <td className="num">{formatCount(r.n)}</td>
                      <td className="num" title={fmtDateTime(r.last_at)}>{relativeTime(r.last_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </AdminAsync>
    </>
  );
}

export function AdminErrorsTab() {
  const [days, setDays] = useState(7);
  const [view, setView] = useState('problems');
  // Each view draws the toolbar with its own refresh, so a refresh re-reads in
  // place: an opened problem stays open, with its group, across it.
  const controls = (
    <>
      <AdminTimeRange value={days} onChange={setDays} />
      <Segmented label="View" options={VIEWS} value={view} onChange={setView} />
      <span className="admin-filter-meta t-meta">staff left out · only what is super breaking is emailed</span>
    </>
  );
  return (
    <div className="admin-section iss-tab">
      {view === 'problems' && <ProblemsView days={days} controls={controls} />}
      {view === 'actions' && <ActionsView days={days} controls={controls} />}
      {view === 'clicks' && <ClicksView days={days} controls={controls} />}
    </div>
  );
}
