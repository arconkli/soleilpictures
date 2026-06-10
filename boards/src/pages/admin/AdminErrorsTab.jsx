// AdminErrorsTab — first-party client-side error logs (public.client_errors,
// written by lib/errorReporting.js). Two views over a 7/30/90d window:
//   • Top errors  — grouped by message (occurrences / users / sessions / last seen)
//   • Recent      — raw stream, each row expands to its stack + component stack
// Errors can be MUTED (admin_mute_error / admin_unmute_error, migration 0133):
// muting hides the message — including future occurrences — behind the
// Active/All toggle. Mutes match on a normalized key (URLs stripped), so
// chunk-load errors stay muted across deploys despite per-build asset URLs.
// Backed by admin_error_summary() + admin_recent_errors() (0108, reshaped in 0133).

import { useCallback, useState, Fragment } from 'react';
import { supabase } from '../../lib/supabase.js';
import { CopyableText } from '../../components/CopyableText.jsx';
import { useFeedback } from '../../components/AppFeedback.jsx';
import { Icon } from '../../components/Icon.jsx';
import { relativeTime, fmtDateTime, formatCount } from '../../lib/adminFormat.js';
import { useAdminData } from './useAdminData.js';
import { AdminToolbar, AdminAsync, AdminSkeleton } from './AdminStates.jsx';
import { AdminStatCard } from './AdminStatCard.jsx';
import { AdminTimeRange } from './AdminTimeRange.jsx';
import { Warning, Eye, EyeOff, Copy, Check } from '../../lib/icons.js';

const RECENT_LIMIT = 200;

const iso = (t) => (t ? new Date(t).toISOString() : '');

// Full plaintext dump of one recent-stream row — every column, for pasting
// into an issue / a debugging session.
const errorRowText = (r) => [
  `occurred_at: ${iso(r.occurred_at)}`,
  `kind: ${r.kind || ''}`,
  `name: ${r.name || ''}`,
  `message: ${r.message || ''}`,
  `path: ${r.path || ''}`,
  `release: ${r.release || ''}`,
  `user_agent: ${r.user_agent || ''}`,
  `user_id: ${r.user_id || ''}`,
  `session_id: ${r.session_id || ''}`,
  `id: ${r.id || ''}`,
  '',
  'stack:',
  r.stack || '(none)',
  '',
  'component_stack:',
  r.component_stack || '(none)',
].join('\n');

const errorGroupText = (g) => [
  `message: ${g.message || ''}`,
  `kind: ${g.kind || ''}`,
  `muted: ${g.muted ? 'yes' : 'no'}`,
  `occurrences: ${g.occurrences} · users: ${g.users} · sessions: ${g.sessions}`,
  `first_seen: ${iso(g.first_seen)}`,
  `last_seen: ${iso(g.last_seen)}`,
  '',
  'sample_stack:',
  g.sample_stack || '(none)',
].join('\n');

// Icon-only "copy everything" button (CopyableText renders its value as the
// label, which doesn't fit a whole-error dump). stopPropagation on keydown
// too — the host rows treat Enter/Space as expand.
function CopyAllButton({ getText, title = 'Copy full error' }) {
  const feedback = useFeedback();
  const [copied, setCopied] = useState(false);
  const copy = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(getText());
      setCopied(true);
      feedback.toast({ type: 'success', message: 'Copied' });
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      feedback.toast({ type: 'error', message: 'Copy failed' });
    }
  };
  return (
    <button
      type="button"
      className="admin-iconbtn"
      onClick={copy}
      onKeyDown={(e) => e.stopPropagation()}
      title={title}
      aria-label={title}
    >
      <Icon as={copied ? Check : Copy} size={14} />
    </button>
  );
}

export function AdminErrorsTab() {
  const [days, setDays] = useState(7);
  const [showMuted, setShowMuted] = useState(false);
  const [muteBusy, setMuteBusy] = useState(null);
  const [openGroup, setOpenGroup] = useState(new Set());
  const [openRow, setOpenRow] = useState(new Set());
  const feedback = useFeedback();

  const fetchErrors = useCallback(async () => {
    const results = await Promise.allSettled([
      supabase.rpc('admin_error_summary',  { p_days: days }),
      supabase.rpc('admin_recent_errors',  { p_days: days, p_limit: RECENT_LIMIT, p_include_muted: showMuted }),
    ]);
    const [sum, rec] = results;
    const val = (r) => (r.status === 'fulfilled' && !r.value.error ? r.value.data : null);
    const errOf = (r) => (r.status === 'rejected' ? r.reason : r.value?.error) || null;
    // Fail the tab only if BOTH queries failed; otherwise render what we have.
    if (!val(sum) && !val(rec)) throw errOf(sum) || errOf(rec) || new Error('Failed to load errors');
    return { summary: val(sum) || [], recent: val(rec) || [] };
  }, [days, showMuted]);

  const { data, loading, error, refreshing, lastUpdated, refresh } = useAdminData(fetchErrors, [days, showMuted]);
  const summary = data?.summary || [];
  const recent = data?.recent || [];

  // The summary RPC always returns muted groups (so the muted count is known
  // without a second query); Active mode filters them out here. The recent
  // stream is filtered server-side so muted rows don't eat the row limit.
  const mutedCount = summary.reduce((a, g) => a + (g.muted ? 1 : 0), 0);
  const visibleSummary = showMuted ? summary : summary.filter((g) => !g.muted);

  // Window totals derived from the visible grouped rows (no extra RPC) — in
  // Active mode muted noise is excluded, consistent with what's on screen.
  // Users/sessions are summed across groups, so they're an upper bound (the
  // same person can hit more than one error) — labelled as such.
  const totalOccurrences = visibleSummary.reduce((a, g) => a + (Number(g.occurrences) || 0), 0);
  const totalUsers = visibleSummary.reduce((a, g) => a + (Number(g.users) || 0), 0);
  const totalSessions = visibleSummary.reduce((a, g) => a + (Number(g.sessions) || 0), 0);

  const toggle = (set, setter, key) => {
    setter((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key); else n.add(key);
      return n;
    });
  };

  const setMuted = async (message, mute) => {
    setMuteBusy(message);
    try {
      const { error: err } = await supabase.rpc(
        mute ? 'admin_mute_error' : 'admin_unmute_error', { p_message: message });
      if (err) throw err;
      feedback.toast({ type: 'success', message: mute ? 'Error muted' : 'Error unmuted' });
      await refresh();
    } catch (ex) {
      feedback.toast({ type: 'error', message: `${mute ? 'Mute' : 'Unmute'} failed: ${ex?.message || ex}` });
    } finally {
      setMuteBusy(null);
    }
  };

  const muteButton = (row) => (
    <button
      type="button"
      className="admin-iconbtn"
      disabled={!row.message || muteBusy === row.message}
      onClick={(e) => { e.stopPropagation(); setMuted(row.message, !row.muted); }}
      onKeyDown={(e) => e.stopPropagation()}
      title={row.muted ? 'Unmute — show this error again' : 'Mute — hide this and future identical errors'}
      aria-label={row.muted ? 'Unmute error' : 'Mute error'}
    >
      <Icon as={row.muted ? Eye : EyeOff} size={14} />
    </button>
  );

  const mutedPill = <span className="admin-status admin-status-canceled">muted</span>;

  return (
    <div className="admin-section">
      <AdminToolbar onRefresh={refresh} refreshing={refreshing} lastUpdated={lastUpdated}>
        <AdminTimeRange value={days} onChange={setDays} />
        <div className="tob-segmented admin-range" role="group" aria-label="Muted filter">
          <button type="button" className={!showMuted ? 'is-active' : ''} aria-pressed={!showMuted}
                  onClick={() => setShowMuted(false)}>Active</button>
          <button type="button" className={showMuted ? 'is-active' : ''} aria-pressed={showMuted}
                  onClick={() => setShowMuted(true)}>All</button>
        </div>
        <span className="admin-filter-meta t-meta">
          {loading
            ? 'Loading…'
            : `${formatCount(visibleSummary.length)} distinct · ${formatCount(recent.length)}${recent.length >= RECENT_LIMIT ? '+' : ''} recent`
              + (mutedCount > 0 ? ` · ${formatCount(mutedCount)} muted${showMuted ? '' : ' hidden'}` : '')}
        </span>
      </AdminToolbar>

      <AdminAsync
        loading={loading}
        error={error}
        onRetry={refresh}
        skeleton={<><AdminSkeleton variant="cards" rows={3} /><AdminSkeleton variant="table" /><AdminSkeleton variant="list" /></>}
        isEmpty={summary.length === 0 && recent.length === 0}
        empty={{
          icon: Warning,
          title: 'No errors logged',
          body: `No client-side errors in the last ${days} days. New crashes from the app appear here.`,
        }}
      >
        <div className={refreshing ? 'is-refreshing' : ''}>
          {/* ── At-a-glance window totals ─────────────────────────────────── */}
          {visibleSummary.length > 0 && (
            <div className="admin-stat-grid">
              <AdminStatCard
                label="Errors"
                value={formatCount(totalOccurrences)}
                sub={`${formatCount(visibleSummary.length)} distinct · last ${days}d`}
              />
              <AdminStatCard
                label="Users affected"
                value={formatCount(totalUsers)}
                sub="across grouped errors"
                title="Summed across error groups — the same person can hit more than one error, so this is an upper bound."
              />
              <AdminStatCard
                label="Sessions"
                value={formatCount(totalSessions)}
                sub="across grouped errors"
                title="Summed across error groups — a session can hit more than one error, so this is an upper bound."
              />
            </div>
          )}

          {/* ── Grouped: top errors by message ───────────────────────────── */}
          {visibleSummary.length > 0 && (
            <>
              <h2 className="admin-section-title">Top errors</h2>
              <div className="admin-section-sub">
                Grouped by message over the selected window — click a row for the sample stack.
              </div>
              <section className="admin-chart-panel admin-chart-panel-wide">
                <header className="admin-chart-head">
                  <h3 className="admin-chart-title">Top errors · last {days} days</h3>
                  <span className="admin-chart-sub t-meta">grouped by message — click a row for the stack</span>
                </header>
                <div className="admin-chart-body">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Error</th>
                        <th className="num">Count</th>
                        <th className="num">Users</th>
                        <th className="num">Sessions</th>
                        <th className="num">Last seen</th>
                        <th className="num" aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {visibleSummary.map((g, i) => {
                        const key = `${g.message}-${i}`;
                        const isOpen = openGroup.has(key);
                        return (
                          <Fragment key={key}>
                            <tr
                              role="button"
                              tabIndex={0}
                              aria-expanded={isOpen}
                              className={`admin-error-grouprow${g.muted ? ' admin-row-muted' : ''}`}
                              onClick={() => toggle(openGroup, setOpenGroup, key)}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(openGroup, setOpenGroup, key); } }}
                            >
                              <td>
                                <span className="admin-error-kind t-meta">{g.kind || 'error'}</span>{' '}
                                {g.muted && <>{mutedPill}{' '}</>}
                                {g.message || '(no message)'}
                              </td>
                              <td className="num">{formatCount(g.occurrences)}</td>
                              <td className="num">{formatCount(g.users)}</td>
                              <td className="num">{formatCount(g.sessions)}</td>
                              <td className="num" title={fmtDateTime(g.last_seen)}>{relativeTime(g.last_seen)}</td>
                              <td className="num" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                                <span className="admin-actions">
                                  <CopyAllButton getText={() => errorGroupText(g)} title="Copy error group" />
                                  {muteButton(g)}
                                </span>
                              </td>
                            </tr>
                            {isOpen && g.sample_stack && (
                              <tr>
                                <td colSpan={6}><pre className="admin-error-stack">{g.sample_stack}</pre></td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}

          {/* ── Recent stream ────────────────────────────────────────────── */}
          {recent.length > 0 && (
            <>
              <h2 className="admin-section-title">Recent stream</h2>
              <div className="admin-section-sub">
                The raw event stream — newest first. Click a row to expand its full stack.
              </div>
              <section className="admin-chart-panel admin-chart-panel-wide">
                <header className="admin-chart-head">
                  <h3 className="admin-chart-title">Recent · last {days} days</h3>
                  <span className="admin-chart-sub t-meta">click a row for the full stack</span>
                </header>
                <div className="admin-feedback-list">
                {recent.map((r) => {
                  const isOpen = openRow.has(r.id);
                  return (
                    <div
                      key={r.id}
                      className={`admin-feedback-row${r.muted ? ' admin-row-muted' : ''}`}
                      role="button"
                      tabIndex={0}
                      aria-expanded={isOpen}
                      onClick={() => toggle(openRow, setOpenRow, r.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(openRow, setOpenRow, r.id); } }}
                    >
                      <div className="admin-feedback-meta">
                        <span className="admin-error-kind t-meta">{r.kind || 'error'}</span>
                        {r.muted && mutedPill}
                        <span className="admin-muted" title={fmtDateTime(r.occurred_at)}>{relativeTime(r.occurred_at)}</span>
                        {r.path && <span className="admin-muted">{r.path}</span>}
                        {r.user_id
                          ? <CopyableText value={r.user_id} className="admin-email" />
                          : <span className="admin-email admin-muted">anonymous</span>}
                        {r.release && <span className="admin-muted">{r.release}</span>}
                        <span className="admin-actions">
                          <CopyAllButton getText={() => errorRowText(r)} />
                          {muteButton(r)}
                        </span>
                      </div>
                      <div className="admin-feedback-message">
                        {r.name ? `${r.name}: ` : ''}{r.message || '(no message)'}
                      </div>
                      {isOpen && (r.stack || r.component_stack) && (
                        <pre className="admin-error-stack">
                          {r.stack || ''}
                          {r.component_stack ? `\n\nComponent stack:\n${r.component_stack}` : ''}
                        </pre>
                      )}
                    </div>
                  );
                })}
                </div>
              </section>
            </>
          )}
        </div>
      </AdminAsync>
    </div>
  );
}
