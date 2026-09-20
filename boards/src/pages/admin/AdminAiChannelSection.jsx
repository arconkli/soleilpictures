// Admin AI channel: three discovery readers that existed without a UI.
//
//   admin_ai_referrals   (0256; re-pointed in 0335)  signups whose first visit
//                        came from an AI assistant, by host × landing path,
//                        with activation. ChatGPT strips the referrer and
//                        appends utm_source=chatgpt.com instead; 0335 made
//                        those arrivals count, labelled `utm:<host>`.
//   admin_aeo_retrieval  (0296)  the weekly AEO retrieval probe: a fixed set
//                        of questions asked of an assistant, recording whether
//                        we were cited, at what position, from which sources.
//   admin_crawler_hits   (0295)  per-bot fetch counts from the Worker's
//                        crawler log — which AI crawlers read us, and what.
//
// Rendered on the Discover tab directly under the SEO section, on the same
// skeleton (toolbar + range, one load() fanning out the three RPCs).
//
// Why the banner: the probe fails CLOSED. A run where every question errored
// (provider out of credits, a revoked key, a changed response shape) stores the
// same `cited: false` rows as a run where every assistant simply left us out,
// and the only way to tell the two apart was SQL on aeo_retrieval_results.error.
// The banner fires when half or more of the newest run failed, when the newest
// run is older than the weekly cadence allows, or when there is no run at all —
// and it quotes the first stored error verbatim, so a provider's refusal is
// read on the dashboard the week it happens.

import { useCallback, useEffect, useState } from 'react';
import { adminAiReferrals, adminAeoRetrieval, adminCrawlerHits } from '../../lib/boardsApi.js';
import { formatCount, fmtDateTime } from '../../lib/adminFormat.js';
import { Icon } from '../../components/Icon.jsx';
import { Warning } from '../../lib/icons.js';
import { AdminToolbar, AdminAsync, AdminSkeleton } from './AdminStates.jsx';
import { AdminTimeRange } from './AdminTimeRange.jsx';
import { Spark, RateCell, PanelNote } from './SmallN.jsx';

// The probe runs weekly (pg_cron). Past this many days the newest run is not
// late, it is missing.
const PROBE_STALE_DAYS = 8;
// A provider error can be a paragraph; the banner quotes enough to name the cause.
const ERROR_QUOTE_MAX = 160;
const TOP_AI_PATHS = 10;

// Inline pill, as the SEO section's health chips. `PILL_AI` is the distinct-
// but-not-gold variant for AI crawlers: gold is reserved for active/selection/
// focus, so the emphasis here is weight and ground, not hue.
const PILL = {
  font: '500 12px/1 var(--font-sans)', padding: '5px 9px', borderRadius: 999,
  border: '1px solid var(--line-2)', color: 'var(--ink-1)',
};
const PILL_AI = { ...PILL, border: '1px solid var(--ink-3)', background: 'var(--bg-2)', color: 'var(--ink-0)' };

function timeAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3600000);
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60000))}m ago`;
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function ageDays(iso) {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? Infinity : (Date.now() - t) / 86400000;
}

function num(v) { return Number(v) || 0; }

function truncate(s, n) {
  const t = String(s ?? '').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

// `sources` is a jsonb array on aeo_retrieval_results; tolerate a count too.
function sourceCount(s) { return Array.isArray(s) ? s.length : num(s); }

// `utm:chatgpt.com` = the assistant stripped the referrer and the utm carried
// the source. Render the host with a small marker, never the raw prefix.
function SourceCell({ host }) {
  const h = String(host || '');
  if (h.startsWith('utm:')) {
    return (
      <span className="admin-ai-source">
        {h.slice(4)}
        <span className="admin-ai-utm" title="Referrer stripped by the assistant; attributed from utm_source">utm</span>
      </span>
    );
  }
  return <span className="admin-ai-source">{h || '(unknown)'}</span>;
}

// The newest run. `runs` is window-scoped but `latest` is not (it is always
// the most recent run's rows), so a narrow window still reports the real last
// run — and its age is exactly what the banner has to judge.
function newestRun(probe) {
  const runs = Array.isArray(probe?.runs) ? probe.runs : [];
  const latest = Array.isArray(probe?.latest) ? probe.latest : [];
  if (runs[0]) return runs[0];
  if (!latest.length) return null;
  return {
    run_at: latest[0].run_at, provider: latest[0].provider, model: null,
    asked: latest.length,
    cited: latest.filter((r) => r.cited).length,
    failed: latest.filter((r) => r.error != null && String(r.error).trim() !== '').length,
  };
}

// null when the probe is healthy; otherwise what to say and the stored error.
function probeAlarm(probe, newest) {
  if (!newest) return { title: 'The AEO probe has never run.', detail: null };
  const latest = Array.isArray(probe?.latest) ? probe.latest : [];
  const detail = latest.map((r) => r.error).find((e) => e != null && String(e).trim() !== '') || null;
  const asked = num(newest.asked);
  const failed = num(newest.failed);
  if (failed * 2 >= asked) {
    return {
      title: asked === 0
        ? 'The newest probe run asked no questions.'
        : `${formatCount(failed)} of ${formatCount(asked)} questions failed on the newest run.`,
      detail,
    };
  }
  const age = ageDays(newest.run_at);
  if (age > PROBE_STALE_DAYS) {
    return { title: `The newest probe run is ${Math.floor(age)}d old — the weekly probe is not running.`, detail };
  }
  return null;
}

export function AdminAiChannelSection() {
  const [days, setDays] = useState(30);
  const [referrals, setReferrals] = useState(null);
  const [probe, setProbe] = useState(null);
  const [crawlers, setCrawlers] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  const load = useCallback(async (d = days) => {
    setRefreshing(true);
    try {
      const [r, p, c] = await Promise.all([
        adminAiReferrals(d),
        adminAeoRetrieval(d),
        adminCrawlerHits(d),
      ]);
      setReferrals(r); setProbe(p); setCrawlers(c);
      setError(null); setLastUpdated(new Date());
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [days]);

  useEffect(() => { load(days); }, [load, days]);

  const rows = Array.isArray(referrals) ? referrals : [];

  const latest = Array.isArray(probe?.latest) ? probe.latest : [];
  const latestByQuestion = new Map(latest.map((r) => [r.question, r]));
  const newest = newestRun(probe);
  const alarm = probeAlarm(probe, newest);
  const failed = num(newest?.failed);
  // The RPC orders by_question by cite_rate as TEXT ("9.0" sorts above "66.7");
  // order it numerically here.
  const byQuestion = (Array.isArray(probe?.by_question) ? [...probe.by_question] : [])
    .sort((a, b) => (num(b.cite_rate) - num(a.cite_rate)) || String(a.question).localeCompare(String(b.question)));

  const byBot = Array.isArray(crawlers?.by_bot) ? crawlers.by_bot : [];
  const byDay = Array.isArray(crawlers?.by_day) ? crawlers.by_day : [];
  const topPaths = (Array.isArray(crawlers?.top_ai_paths) ? crawlers.top_ai_paths : []).slice(0, TOP_AI_PATHS);

  return (
    <section className="admin-chart-panel admin-chart-panel-wide">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">AI channel</h3>
        <span className="admin-chart-sub t-meta">
          Signups referred by AI assistants, the weekly AEO retrieval probe (are we cited — and is the
          probe itself alive), and which crawlers fetch the public pages.
        </span>
      </header>

      <AdminToolbar onRefresh={() => load(days)} refreshing={refreshing} lastUpdated={lastUpdated}>
        <AdminTimeRange value={days} onChange={setDays} />
      </AdminToolbar>

      <AdminAsync loading={loading} error={error} onRetry={() => load(days)}
                  skeleton={<AdminSkeleton variant="table" rows={3} />} isEmpty={false}>
        {/* 1. AI assistant referrals */}
        <div style={{ marginBottom: 18 }}>
          <div className="t-meta" style={{ marginBottom: 6, display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <b>AI assistant referrals ({days}d)</b>
            <span className="admin-muted">signups whose first visit came from an assistant</span>
          </div>
          {rows.length === 0 ? (
            <div className="t-meta admin-muted">No assistant referrals in this window.</div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Landing path</th>
                  <th className="num">Signups</th>
                  <th className="num">Activated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.ref_host}:${r.landing_path}`}>
                    <td><SourceCell host={r.ref_host} /></td>
                    <td><code>{r.landing_path || '/'}</code></td>
                    <td className="num">{formatCount(r.signups)}</td>
                    <td className="num">
                      {formatCount(r.activated)} <span className="admin-muted">·</span>{' '}
                      <RateCell numer={r.activated} denom={r.signups} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* 2. AEO retrieval probe */}
        <div style={{ marginBottom: 18 }}>
          <div className="t-meta" style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <b>AEO probe</b>
            {newest ? (
              <>
                <span className="admin-muted" title={fmtDateTime(newest.run_at)}>ran {timeAgo(newest.run_at)}</span>
                <span>{formatCount(newest.cited)}/{formatCount(newest.asked)} cited</span>
                <span style={failed > 0 ? { color: 'var(--danger, #e5484d)' } : undefined}>
                  {formatCount(failed)} failed
                </span>
                {(newest.provider || newest.model) && (
                  <span className="admin-muted">{[newest.provider, newest.model].filter(Boolean).join(' · ')}</span>
                )}
              </>
            ) : <span className="admin-muted">no runs yet</span>}
          </div>

          {alarm && (
            <div className="admin-ai-banner" role="alert">
              <Icon as={Warning} size={16} />
              <div>
                <div>{alarm.title}</div>
                {alarm.detail && (
                  <div className="admin-ai-banner-quote">“{truncate(alarm.detail, ERROR_QUOTE_MAX)}”</div>
                )}
              </div>
            </div>
          )}

          {byQuestion.length === 0 ? (
            <div className="t-meta admin-muted">No probe results in this window.</div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Question</th>
                  <th className="num">Asked</th>
                  <th className="num">Cited</th>
                  <th className="num">Cite rate</th>
                  <th className="num">Latest position</th>
                  <th className="num">Sources</th>
                </tr>
              </thead>
              <tbody>
                {byQuestion.map((q) => {
                  const l = latestByQuestion.get(q.question);
                  const rate = q.cite_rate == null ? null : num(q.cite_rate);
                  return (
                    <tr key={`${q.provider}:${q.question}`}>
                      <td title={l?.excerpt || undefined}>
                        {q.question}
                        {q.provider && <span className="admin-muted"> · {q.provider}</span>}
                      </td>
                      <td className="num">{formatCount(q.asked)}</td>
                      <td className="num">{formatCount(q.cited)}</td>
                      <td className="num">{rate == null ? <span className="admin-muted">—</span> : `${rate}%`}</td>
                      <td className="num">
                        {l?.error ? <span style={{ color: 'var(--danger, #e5484d)' }} title={l.error}>error</span>
                          : l?.cited && l.position != null ? `#${l.position}`
                          : <span className="admin-muted">—</span>}
                      </td>
                      <td className="num">{l ? formatCount(sourceCount(l.sources)) : <span className="admin-muted">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* 3. Crawlers */}
        <div>
          <div className="t-meta" style={{ marginBottom: 6 }}><b>Crawlers ({days}d)</b></div>
          {byBot.length === 0 ? (
            <div className="t-meta admin-muted">No crawler hits in this window.</div>
          ) : (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                {byBot.map((b) => (
                  <span key={`${b.bot}:${b.kind}`} style={b.kind === 'ai' ? PILL_AI : PILL}
                        title={b.last_seen ? `last seen ${fmtDateTime(b.last_seen)}` : undefined}>
                    {b.bot} · {b.kind} · {formatCount(b.hits)} · {formatCount(b.paths)} paths
                  </span>
                ))}
              </div>
              <div className="t-meta admin-muted">AI crawler hits per day</div>
              <Spark data={byDay.map((d) => ({ v: num(d.ai) }))} />
              {topPaths.length > 0 && (
                <table className="admin-table" style={{ marginTop: 10 }}>
                  <thead>
                    <tr>
                      <th>Most-fetched by AI crawlers</th>
                      <th className="num">Hits</th>
                      <th className="num">Bots</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topPaths.map((p) => (
                      <tr key={p.path}>
                        <td><code>{p.path}</code></td>
                        <td className="num">{formatCount(p.hits)}</td>
                        <td className="num">{formatCount(p.bots)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>

        <PanelNote>
          Referrals are attributed from each profile's first recorded source. The probe asks every
          question once per weekly run, so a cite rate rests on only a few runs per window; a failed
          question is one the provider errored on, not one that left us out.
        </PanelNote>
      </AdminAsync>
    </section>
  );
}
