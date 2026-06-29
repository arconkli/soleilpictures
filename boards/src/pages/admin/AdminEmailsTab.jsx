// AdminEmailsTab — every outbound email, with deliverability + engagement.
//
// Backed by the universal email_sends log (migration 0175): send-transactional-email
// writes one row per send at the choke point, and the Resend webhook folds in
// delivered/opened/clicked/bounced/complained. Two views over a 7/30/90d window:
//   • By template — sent / delivered / open% / click% / bounced / spam per template
//   • Recent      — the raw send stream, filterable by template/status + recipient
// RPCs: admin_email_stats() + admin_recent_emails(). Mirrors AdminErrorsTab.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { CopyableText } from '../../components/CopyableText.jsx';
import { formatCount, formatPct, relativeTime, fmtDateTime } from '../../lib/adminFormat.js';
import { useAdminData } from './useAdminData.js';
import { AdminToolbar, AdminAsync, AdminSkeleton } from './AdminStates.jsx';
import { AdminStatCard } from './AdminStatCard.jsx';
import { AdminTimeRange } from './AdminTimeRange.jsx';
import { Envelope } from '../../lib/icons.js';

const RECENT_LIMIT = 200;

// A clean denominator-aware rate ("—" when there's nothing to divide).
const rate = (numer, denom) => (Number(denom) > 0 ? Number(numer) / Number(denom) : null);
const pct = (numer, denom) => { const r = rate(numer, denom); return r == null ? '—' : formatPct(r); };

// derived_status → an admin-status-* palette class (reuses existing pills).
const STATUS_CLASS = {
  sent:      'pending',
  delivered: 'accepted',
  opened:    'paid',
  clicked:   'admin',
  bounced:   'rejected',
  spam:      'rejected',
  failed:    'canceled',
};
const STATUS_ORDER = ['sent', 'delivered', 'opened', 'clicked', 'bounced', 'spam', 'failed'];

function StatusPill({ status }) {
  const cls = STATUS_CLASS[status] || 'canceled';
  return <span className={`admin-status admin-status-${cls}`}>{status}</span>;
}

export function AdminEmailsTab() {
  const [days, setDays] = useState(7);
  const [template, setTemplate] = useState('');   // '' = all
  const [status, setStatus]     = useState('');   // '' = all
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');

  // Debounce the recipient search so each keystroke doesn't refetch.
  useEffect(() => {
    const id = setTimeout(() => setQuery(queryInput.trim()), 300);
    return () => clearTimeout(id);
  }, [queryInput]);

  const fetchEmails = useCallback(async () => {
    const results = await Promise.allSettled([
      supabase.rpc('admin_email_stats',  { p_days: days }),
      supabase.rpc('admin_recent_emails', {
        p_days: days, p_limit: RECENT_LIMIT,
        p_template: template || null, p_status: status || null, p_query: query || null,
      }),
    ]);
    const [st, rec] = results;
    const val = (r) => (r.status === 'fulfilled' && !r.value.error ? r.value.data : null);
    const errOf = (r) => (r.status === 'rejected' ? r.reason : r.value?.error) || null;
    if (!val(st) && !val(rec)) throw errOf(st) || errOf(rec) || new Error('Failed to load emails');
    return { stats: val(st) || [], recent: val(rec) || [] };
  }, [days, template, status, query]);

  const { data, loading, error, refreshing, lastUpdated, refresh } =
    useAdminData(fetchEmails, [days, template, status, query]);
  const stats = data?.stats || [];
  const recent = data?.recent || [];

  // Window totals summed across the (always full-window) per-template stats.
  const sum = (k) => stats.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const totals = {
    sent: sum('sent'), delivered: sum('delivered'), opened: sum('opened'),
    clicked: sum('clicked'), bounced: sum('bounced'), complained: sum('complained'),
    failed: sum('failed'),
  };
  const bounceRate = rate(totals.bounced, totals.sent) || 0;
  const spamRate   = rate(totals.complained, totals.sent) || 0;

  // The template dropdown only offers templates that actually have sends.
  const templateOptions = [...new Set(stats.map((r) => r.template))].sort();

  return (
    <div className="admin-section">
      <AdminToolbar onRefresh={refresh} refreshing={refreshing} lastUpdated={lastUpdated}>
        <AdminTimeRange value={days} onChange={setDays} />
        <select className="auth-input admin-filter-select" value={template} onChange={(e) => setTemplate(e.target.value)}
                aria-label="Filter by template">
          <option value="">All templates</option>
          {templateOptions.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="auth-input admin-filter-select" value={status} onChange={(e) => setStatus(e.target.value)}
                aria-label="Filter by status">
          <option value="">Any status</option>
          {STATUS_ORDER.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input className="auth-input admin-search-input" type="search" placeholder="search recipient…"
               value={queryInput} onChange={(e) => setQueryInput(e.target.value)}
               aria-label="Search by recipient" />
      </AdminToolbar>

      <AdminAsync
        loading={loading}
        error={error}
        onRetry={refresh}
        skeleton={<><AdminSkeleton variant="cards" rows={6} /><AdminSkeleton variant="table" /><AdminSkeleton variant="list" /></>}
        isEmpty={stats.length === 0 && recent.length === 0}
        empty={{
          icon: Envelope,
          title: 'No emails sent yet',
          body: `No outbound email in the last ${days} days. Sends appear here as they go out.`,
        }}
      >
        <div className={refreshing ? 'is-refreshing' : ''}>
          {/* ── Window totals ────────────────────────────────────────────── */}
          <div className="admin-stat-grid">
            <AdminStatCard label="Sent" value={formatCount(totals.sent)}
              sub={`last ${days}d${totals.failed ? ` · ${formatCount(totals.failed)} failed` : ''}`} />
            <AdminStatCard label="Delivered" value={formatCount(totals.delivered)}
              sub={`${pct(totals.delivered, totals.sent)} of sent`} />
            <AdminStatCard label="Open rate" value={pct(totals.opened, totals.delivered)}
              sub={`${formatCount(totals.opened)} opened`} />
            <AdminStatCard label="Click rate" value={pct(totals.clicked, totals.delivered)}
              sub={`${formatCount(totals.clicked)} clicked`} />
            <AdminStatCard label="Bounced" value={formatCount(totals.bounced)}
              sub={`${pct(totals.bounced, totals.sent)} of sent`} accent={bounceRate > 0.02} />
            <AdminStatCard label="Spam reports" value={formatCount(totals.complained)}
              sub={`${pct(totals.complained, totals.sent)} of sent`} accent={spamRate > 0.001} />
          </div>

          {/* ── By template ──────────────────────────────────────────────── */}
          {stats.length > 0 && (
            <>
              <h2 className="admin-section-title">By template</h2>
              <div className="admin-section-sub">
                Volume and deliverability per template over the selected window (open/click rates are of delivered).
              </div>
              <section className="admin-chart-panel admin-chart-panel-wide">
                <header className="admin-chart-head">
                  <h3 className="admin-chart-title">Templates · last {days} days</h3>
                  <span className="admin-chart-sub t-meta">sorted by volume</span>
                </header>
                <div className="admin-chart-body">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Template</th>
                        <th className="num">Sent</th>
                        <th className="num">Delivered</th>
                        <th className="num">Open</th>
                        <th className="num">Click</th>
                        <th className="num">Bounced</th>
                        <th className="num">Spam</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.map((r) => (
                        <tr key={`${r.category}-${r.template}`}>
                          <td>
                            {r.template}{' '}
                            <span className="admin-error-kind t-meta">{r.category}</span>
                          </td>
                          <td className="num">{formatCount(r.sent)}</td>
                          <td className="num" title={`${pct(r.delivered, r.sent)} of sent`}>{formatCount(r.delivered)}</td>
                          <td className="num">{pct(r.opened, r.delivered)}</td>
                          <td className="num">{pct(r.clicked, r.delivered)}</td>
                          <td className="num">{formatCount(r.bounced)}</td>
                          <td className="num">{formatCount(r.complained)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}

          {/* ── Recent stream ────────────────────────────────────────────── */}
          <h2 className="admin-section-title">Recent stream</h2>
          <div className="admin-section-sub">
            Individual sends, newest first{(template || status || query) ? ' (filtered)' : ''}.
          </div>
          <section className="admin-chart-panel admin-chart-panel-wide">
            <header className="admin-chart-head">
              <h3 className="admin-chart-title">Recent · last {days} days</h3>
              <span className="admin-chart-sub t-meta">
                {formatCount(recent.length)}{recent.length >= RECENT_LIMIT ? '+' : ''} shown
              </span>
            </header>
            <AdminAsync
              loading={false}
              error={null}
              isEmpty={recent.length === 0}
              empty={{ icon: Envelope, title: 'No matching sends', body: 'No emails match these filters in this window.' }}
            >
              <div className="admin-feedback-list">
                {recent.map((r) => (
                  <div key={r.id} className="admin-feedback-row">
                    <div className="admin-feedback-meta">
                      <StatusPill status={r.derived_status} />
                      <span className="admin-muted" title={fmtDateTime(r.sent_at)}>{relativeTime(r.sent_at)}</span>
                      <CopyableText value={r.recipient_email} className="admin-email" />
                      <span className="admin-error-kind t-meta">{r.template}</span>
                      {r.open_count > 1 && <span className="admin-muted">{r.open_count} opens</span>}
                      {r.bounce_type && <span className="admin-muted">{r.bounce_type} bounce</span>}
                    </div>
                  </div>
                ))}
              </div>
            </AdminAsync>
          </section>
        </div>
      </AdminAsync>
    </div>
  );
}
