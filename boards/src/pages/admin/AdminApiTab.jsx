// AdminApiTab — who is using /api/v1 and the MCP server, through which door.
//
// Everything here reads public.api_request_log, which the Worker writes on
// every write and on every image-byte read (worker-api.js, end of
// handleApiRoute). Two things make it legible that were not there before 0223:
//
//   • `tool` — the hosted MCP server is ONE route, so a route-keyed log said
//     "POST /mcp" for every call an agent ever made. The tool name is the fact
//     worth having: models choose tools by reading their descriptions, so the
//     distribution across tools is direct feedback on those descriptions.
//   • the admin_api_* aggregates — the log's only read path was the customer's
//     own /audit, scoped to auth.uid(). Correct for them, useless for us.
//
// The empty state is deliberate and is the state this tab shipped in. "No data"
// is a true but worthless thing to tell an operator about a surface that has
// just launched; what they need to know is whether the doors are open and
// whether anyone has been given a key.

import { useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { supabase } from '../../lib/supabase.js';
import { CopyableText } from '../../components/CopyableText.jsx';
import { formatCount, formatPct, relativeTime, fmtDateTime, shortDate } from '../../lib/adminFormat.js';
import { useAdminData } from './useAdminData.js';
import { AdminToolbar, AdminAsync, AdminSkeleton } from './AdminStates.jsx';
import { AdminStatCard } from './AdminStatCard.jsx';
import { AdminTimeRange } from './AdminTimeRange.jsx';
import { CHART } from './chartTheme.js';

const RECENT_LIMIT = 150;

const ms = (n) => (n == null ? '—' : `${formatCount(n)}ms`);

// A status class that reads at a glance. 4xx is the caller's mistake and 5xx is
// ours; collapsing them into one "error" colour hides which of those is
// happening, and they call for completely different responses.
function StatusCell({ status }) {
  const kind = status >= 500 ? 'rejected' : status >= 400 ? 'pending' : 'accepted';
  return <span className={`admin-status admin-status-${kind}`}>{status}</span>;
}

function DoorPill({ mcp }) {
  return (
    <span className={`admin-api-door ${mcp ? 'is-mcp' : 'is-rest'}`}>{mcp ? 'MCP' : 'REST'}</span>
  );
}

// Nothing has called it yet. Say what is true and what would change it, rather
// than drawing six empty charts.
function NeverUsed({ overview }) {
  const t = overview?.tokens || {};
  return (
    <div className="admin-chart-placeholder">
      <div className="admin-chart-placeholder-title">Nothing has called the API yet</div>
      <div className="admin-chart-placeholder-sub">
        {t.total > 0
          ? <>
              {formatCount(t.total)} token{t.total === 1 ? '' : 's'} minted
              {t.used > 0
                ? <> · {formatCount(t.used)} presented at least once</>
                : <> · <b>none has ever been presented</b> — someone got as far as Settings → API and no further</>}
            </>
          : <>No tokens have been minted. The API and MCP are live and reachable; nobody holds a key.</>}
        <br />
        The doors: <code>POST /api/v1/mcp</code> · <code>/api/v1</code> ·{' '}
        <a className="admin-link" href="/docs/api" target="_blank" rel="noreferrer">/docs/api</a>
      </div>
    </div>
  );
}

function Table({ title, sub, columns, rows, empty, renderRow }) {
  return (
    <section className="admin-chart-panel">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">{title}</h3>
        {sub && <span className="admin-chart-sub t-meta">{sub}</span>}
      </header>
      <div className="admin-chart-body">
        {rows.length === 0
          ? <div className="admin-empty">{empty}</div>
          : (
            <table className="admin-table">
              <thead><tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
              <tbody>{rows.map(renderRow)}</tbody>
            </table>
          )}
      </div>
    </section>
  );
}

export function AdminApiTab() {
  const [days, setDays] = useState(30);
  const [onlyErrors, setOnlyErrors] = useState(false);

  const { data, loading, error, refreshing, lastUpdated, refresh } = useAdminData(async () => {
    const [ov, series, tools, routes, callers, recent] = await Promise.all([
      supabase.rpc('admin_api_overview', { p_days: days }),
      supabase.rpc('admin_api_series', { p_days: days }),
      supabase.rpc('admin_api_tools', { p_days: days, p_limit: 25 }),
      supabase.rpc('admin_api_routes', { p_days: days, p_limit: 25 }),
      supabase.rpc('admin_api_callers', { p_days: days, p_limit: 50 }),
      supabase.rpc('admin_api_recent', { p_limit: RECENT_LIMIT, p_only_errors: onlyErrors }),
    ]);
    for (const r of [ov, series, tools, routes, callers, recent]) if (r.error) throw r.error;
    return {
      overview: ov.data || null,
      series: series.data || [],
      tools: tools.data || [],
      routes: routes.data || [],
      callers: callers.data || [],
      recent: recent.data || [],
    };
  }, [days, onlyErrors]);

  const ov = data?.overview;
  const calls = ov?.calls || {};
  const tokens = ov?.tokens || {};
  const everCalled = Number(calls.total || 0) > 0 || !!ov?.first_call_at;

  const chart = (data?.series || []).map((d) => ({
    day: shortDate(d.day),
    MCP: Number(d.mcp_calls) || 0,
    REST: Number(d.rest_calls) || 0,
    errors: Number(d.errors) || 0,
  }));

  return (
    <div className="admin-section">
      <h2 className="admin-section-title">API &amp; MCP</h2>
      <div className="admin-section-sub">
        Traffic through <code>/api/v1</code> and the hosted MCP server. Writes and image-byte reads are
        recorded; ordinary reads are not, so these counts are <b>mutations and content leaving</b>, not
        total requests.
      </div>

      <AdminToolbar onRefresh={refresh} refreshing={refreshing} lastUpdated={lastUpdated}>
        <AdminTimeRange value={days} onChange={setDays} />
      </AdminToolbar>

      <AdminAsync loading={loading} error={error} onRetry={refresh} skeleton={<AdminSkeleton variant="table" rows={8} />}>
        <div className={refreshing ? 'is-refreshing' : ''}>
          <div className="admin-stat-grid">
            <AdminStatCard
              label={`Calls · ${days}d`}
              value={formatCount(calls.total || 0)}
              sub={`${formatCount(calls.callers || 0)} caller${calls.callers === 1 ? '' : 's'}`}
              accent
            />
            <AdminStatCard
              label="Through MCP"
              value={calls.total ? formatPct((calls.mcp || 0) / calls.total) : '—'}
              sub={`${formatCount(calls.mcp || 0)} MCP · ${formatCount(calls.rest || 0)} REST`}
            />
            <AdminStatCard
              label="Errors"
              value={calls.total ? formatPct((calls.errors || 0) / calls.total) : '—'}
              sub={`${formatCount(calls.errors || 0)} of ${formatCount(calls.total || 0)}`}
            />
            <AdminStatCard label="p95 latency" value={ms(calls.p95_ms)} sub={`p50 ${ms(calls.p50_ms)}`} />
            <AdminStatCard
              label="Live tokens"
              value={formatCount(tokens.live || 0)}
              // A token minted and never presented is a different failure from
              // one never minted: it means the docs got someone to Settings and
              // no further.
              sub={`${formatCount(tokens.used || 0)} ever used · ${formatCount(tokens.holders || 0)} holder${tokens.holders === 1 ? '' : 's'}`}
            />
            <AdminStatCard
              label="Service accounts"
              value={formatCount(ov?.service_accounts?.active || 0)}
              sub={`${formatCount(ov?.webhooks?.active || 0)} webhook${ov?.webhooks?.active === 1 ? '' : 's'} · ${formatCount(ov?.identifiers || 0)} identifiers`}
            />
          </div>

          {!everCalled ? <NeverUsed overview={ov} /> : (
            <>
              <section className="admin-chart-panel admin-chart-panel-wide">
                <header className="admin-chart-head">
                  <h3 className="admin-chart-title">Calls per day</h3>
                  <span className="admin-chart-sub t-meta">
                    by door · first call {ov?.first_call_at ? relativeTime(ov.first_call_at) : '—'}
                  </span>
                </header>
                <div className="admin-chart-body">
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={chart}>
                      <CartesianGrid {...CHART.grid} />
                      <XAxis dataKey="day" {...CHART.axis} />
                      <YAxis {...CHART.axis} allowDecimals={false} />
                      <Tooltip {...CHART.tooltip} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="MCP" stackId="a" fill={CHART.soleil} {...CHART.noAnim} />
                      <Bar dataKey="REST" stackId="a" fill={CHART.series[2]} {...CHART.noAnim} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>

              <div className="admin-charts-row">
                <Table
                  title="MCP tools"
                  sub="what assistants actually reach for"
                  columns={['Tool', 'Calls', 'Errors', 'Callers', 'p95', 'Last']}
                  rows={data.tools}
                  empty="No MCP calls in this window."
                  renderRow={(t) => (
                    <tr key={t.tool}>
                      <td><code className="admin-api-tool">{t.tool}</code></td>
                      <td>{formatCount(t.calls)}</td>
                      <td className={t.errors > 0 ? '' : 'admin-muted'}>{formatCount(t.errors)}</td>
                      <td>{formatCount(t.callers)}</td>
                      <td className="admin-muted">{ms(t.p95_ms)}</td>
                      <td className="admin-muted" title={fmtDateTime(t.last_at)}>{relativeTime(t.last_at)}</td>
                    </tr>
                  )}
                />
                <Table
                  title="REST routes"
                  sub="templated path, not the specific object"
                  columns={['Route', 'Calls', 'Errors', 'p95', 'Last']}
                  rows={data.routes}
                  empty="No REST calls in this window."
                  renderRow={(r) => (
                    <tr key={`${r.method} ${r.route}`}>
                      <td><code className="admin-api-tool">{r.method} {r.route}</code></td>
                      <td>{formatCount(r.calls)}</td>
                      <td className={r.errors > 0 ? '' : 'admin-muted'}>{formatCount(r.errors)}</td>
                      <td className="admin-muted">{ms(r.p95_ms)}</td>
                      <td className="admin-muted" title={fmtDateTime(r.last_at)}>{relativeTime(r.last_at)}</td>
                    </tr>
                  )}
                />
              </div>

              <Table
                title="Callers"
                sub="a service account is a credential, not a person — it is named as one"
                columns={['Who', 'Calls', 'MCP', 'Errors', 'Tokens', 'First', 'Last']}
                rows={data.callers}
                empty="Nobody in this window."
                renderRow={(c) => (
                  <tr key={c.user_id}>
                    <td>
                      {c.is_service_account
                        ? <>
                            <span className="admin-badge-ghost">service</span>{' '}
                            <b>{c.display_name || c.service_of || 'unnamed'}</b>
                            {c.service_of && <span className="admin-muted"> · {c.service_of}</span>}
                          </>
                        : <>
                            <CopyableText value={c.email || c.user_id} className="admin-email" />
                            {c.tier && c.tier !== 'demo' && <span className={`admin-status admin-status-${c.tier}`} style={{ marginLeft: 6 }}>{c.tier}</span>}
                          </>}
                    </td>
                    <td>{formatCount(c.calls)}</td>
                    <td>{formatCount(c.mcp_calls)}</td>
                    <td className={c.errors > 0 ? '' : 'admin-muted'}>{formatCount(c.errors)}</td>
                    <td className="admin-muted">{formatCount(c.tokens)}</td>
                    <td className="admin-muted" title={fmtDateTime(c.first_call_at)}>{relativeTime(c.first_call_at)}</td>
                    <td className="admin-muted" title={fmtDateTime(c.last_call_at)}>{relativeTime(c.last_call_at)}</td>
                  </tr>
                )}
              />

              <section className="admin-chart-panel admin-chart-panel-wide">
                <header className="admin-chart-head">
                  <h3 className="admin-chart-title">Recent calls</h3>
                  <span className="admin-chart-sub t-meta">
                    newest first · not windowed by the range above
                  </span>
                  <label className="admin-inline-check">
                    <input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} />
                    Errors only
                  </label>
                </header>
                <div className="admin-chart-body">
                  {data.recent.length === 0 ? (
                    <div className="admin-empty">{onlyErrors ? 'No failures recorded.' : 'Nothing recorded yet.'}</div>
                  ) : (
                    <table className="admin-table">
                      <thead>
                        <tr><th>When</th><th>Door</th><th>What</th><th>Who</th><th>Status</th><th>ms</th></tr>
                      </thead>
                      <tbody>
                        {data.recent.map((r) => (
                          <tr key={r.id}>
                            <td className="admin-muted" title={fmtDateTime(r.at)}>{relativeTime(r.at)}</td>
                            <td><DoorPill mcp={r.route === '/mcp'} /></td>
                            <td>
                              <code className="admin-api-tool">{r.tool || `${r.method} ${r.route}`}</code>
                              {r.token_name && <span className="admin-muted"> · {r.token_name}</span>}
                            </td>
                            <td>
                              {r.is_service_account
                                ? <span className="admin-badge-ghost">service</span>
                                : <span className="admin-email admin-muted">{r.email || r.user_id}</span>}
                            </td>
                            <td><StatusCell status={r.status} /></td>
                            <td className="admin-muted">{r.ms == null ? '—' : formatCount(r.ms)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </section>
            </>
          )}
        </div>
      </AdminAsync>
    </div>
  );
}
