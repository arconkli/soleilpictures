// AdminEmailsTab — every outbound email: what the lifecycle mail did, how all of
// it was delivered, and the raw stream.
//
// Three views, as the Analytics tab has them (localStorage + ?view=, arrow-key
// nav, the active one bracketed):
//   • Impact   — the lifecycle emails week by week: opens, sends, who then made
//                something, the welcome per new account, and what changed
//                (emails/EmailImpactView.jsx, the owner's pick of 2026-10-20)
//   • Delivery — sent / delivered / open% / click% / bounced / spam, in total
//                and per template, over a 7/30/90d window
//   • Stream   — the raw send stream, filterable by template/status + recipient
//
// Delivery and Stream are backed by the universal email_sends log (migration
// 0175): send-transactional-email writes one row per send at the choke point,
// and the Resend webhook folds in delivered/opened/clicked/bounced/complained.
// RPCs: admin_email_stats() + admin_recent_emails(); Impact reads
// admin_email_impact() (0494). The window and the other-senders switch are
// shared by Delivery and Stream, so moving between them keeps both.

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { CopyableText } from '../../components/CopyableText.jsx';
import { formatCount, formatPct, relativeTime, fmtDateTime } from '../../lib/adminFormat.js';
import { useAdminData } from './useAdminData.js';
import { AdminToolbar, AdminAsync, AdminSkeleton } from './AdminStates.jsx';
import { AdminStatCard } from './AdminStatCard.jsx';
import { AdminTimeRange } from './AdminTimeRange.jsx';
import { EmailImpactView } from './emails/EmailImpactView.jsx';
import { Envelope } from '../../lib/icons.js';

const RECENT_LIMIT = 200;

const VIEWS = [
  { id: 'impact',   label: 'Impact' },
  { id: 'delivery', label: 'Delivery' },
  { id: 'stream',   label: 'Stream' },
];
const VIEW_IDS = VIEWS.map((v) => v.id);
const SUBTAB_KEY = 'admin.emails.view';

function readInitialView() {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('view');
    if (VIEW_IDS.includes(fromUrl)) return fromUrl;
    const stored = window.localStorage.getItem(SUBTAB_KEY);
    if (VIEW_IDS.includes(stored)) return stored;
  } catch { /* ignore */ }
  return 'impact';
}

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
  const [view, setView] = useState(readInitialView);
  const tabRefs = useRef([]);
  const [days, setDays] = useState(7);
  // Default OFF: this Resend account also carries another product's auth mail
  // (updates.bountyos.com), which lands as template='unknown' stubs and made up
  // 73% of every tracked email — blending it in dragged every rate with it.
  // Migration 0212 records the sending domain; this toggle restores the raw view.
  const [includeForeign, setIncludeForeign] = useState(false);

  const selectView = (v) => {
    setView(v);
    try {
      window.localStorage.setItem(SUBTAB_KEY, v);
      const url = new URL(window.location.href);
      url.searchParams.set('view', v);
      window.history.replaceState({}, '', url);
    } catch { /* ignore */ }
  };

  const onKey = (e, idx) => {
    let next = null;
    if (e.key === 'ArrowRight') next = (idx + 1) % VIEWS.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + VIEWS.length) % VIEWS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = VIEWS.length - 1;
    if (next == null) return;
    e.preventDefault();
    selectView(VIEWS[next].id);
    tabRefs.current[next]?.focus();
  };

  const shared = { days, setDays, includeForeign, setIncludeForeign };

  // The Analytics tab's frame (admin-analytics): numbered section bands, the
  // bracketed mode, the cockpit toolbar. admin-emails is this tab's own hook.
  return (
    <div className="admin-analytics admin-emails">
      <div className="admin-subtabs" role="tablist" aria-label="Email views">
        {VIEWS.map((v, i) => (
          <button
            key={v.id}
            ref={(el) => { tabRefs.current[i] = el; }}
            role="tab"
            aria-selected={view === v.id}
            tabIndex={view === v.id ? 0 : -1}
            className={`admin-subtab ${view === v.id ? 'is-active' : ''}`}
            onClick={() => selectView(v.id)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {v.label}
          </button>
        ))}
      </div>

      {view === 'impact'   && <EmailImpactView key="impact" />}
      {view === 'delivery' && <EmailDelivery key="delivery" {...shared} />}
      {view === 'stream'   && <EmailStream key="stream" {...shared} />}
    </div>
  );
}

function ForeignToggle({ includeForeign, setIncludeForeign }) {
  return (
    <label className="admin-inline-check" title="This Resend account also carries another product's mail. Off = Soleil domains only.">
      <input type="checkbox" checked={includeForeign}
             onChange={(e) => setIncludeForeign(e.target.checked)} />
      <span>other senders</span>
    </label>
  );
}

// ── Delivery ────────────────────────────────────────────────────────────────

function EmailDelivery({ days, setDays, includeForeign, setIncludeForeign }) {
  const fetchStats = useCallback(async () => {
    const r = await supabase.rpc('admin_email_stats', { p_days: days, p_include_foreign: includeForeign });
    if (r.error) throw r.error;
    return r.data || [];
  }, [days, includeForeign]);

  const { data, loading, error, refreshing, lastUpdated, refresh, hasData } =
    useAdminData(fetchStats, [days, includeForeign]);
  const stats = data || [];

  // Window totals summed across the (always full-window) per-template stats.
  const sum = (k) => stats.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const totals = {
    sent: sum('sent'), delivered: sum('delivered'), opened: sum('opened'),
    clicked: sum('clicked'), bounced: sum('bounced'), complained: sum('complained'),
    failed: sum('failed'),
  };
  const bounceRate = rate(totals.bounced, totals.sent) || 0;
  const spamRate   = rate(totals.complained, totals.sent) || 0;

  return (
    <>
      <AdminToolbar onRefresh={refresh} refreshing={refreshing} lastUpdated={lastUpdated}>
        <AdminTimeRange value={days} onChange={setDays} />
        <ForeignToggle includeForeign={includeForeign} setIncludeForeign={setIncludeForeign} />
      </AdminToolbar>

      <AdminAsync
        loading={loading}
        error={error}
        hasData={hasData}
        onRetry={refresh}
        skeleton={<><AdminSkeleton variant="cards" rows={6} /><AdminSkeleton variant="table" /></>}
        isEmpty={stats.length === 0}
        empty={{
          icon: Envelope,
          title: 'No emails sent yet',
          body: `No outbound email in the last ${days} days. Sends appear here as they go out.`,
        }}
      >
        <div className="adm-view">
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
        </div>
      </AdminAsync>
    </>
  );
}

// ── Stream ──────────────────────────────────────────────────────────────────

function EmailStream({ days, setDays, includeForeign, setIncludeForeign }) {
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
      // Only for the template picker: it offers templates that actually have sends.
      supabase.rpc('admin_email_stats',  { p_days: days, p_include_foreign: includeForeign }),
      supabase.rpc('admin_recent_emails', {
        p_days: days, p_limit: RECENT_LIMIT,
        p_template: template || null, p_status: status || null, p_query: query || null,
        p_include_foreign: includeForeign,
      }),
    ]);
    const [st, rec] = results;
    const val = (r) => (r.status === 'fulfilled' && !r.value.error ? r.value.data : null);
    const errOf = (r) => (r.status === 'rejected' ? r.reason : r.value?.error) || null;
    if (!val(rec)) throw errOf(rec) || new Error('Failed to load emails');
    return { stats: val(st) || [], recent: val(rec) || [] };
  }, [days, template, status, query, includeForeign]);

  const { data, loading, error, refreshing, lastUpdated, refresh, hasData } =
    useAdminData(fetchEmails, [days, template, status, query, includeForeign]);
  const stats = data?.stats || [];
  const recent = data?.recent || [];

  const templateOptions = [...new Set(stats.map((r) => r.template))].sort();

  return (
    <>
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
        <ForeignToggle includeForeign={includeForeign} setIncludeForeign={setIncludeForeign} />
      </AdminToolbar>

      <AdminAsync
        loading={loading}
        error={error}
        hasData={hasData}
        onRetry={refresh}
        skeleton={<AdminSkeleton variant="list" />}
      >
        <div className="adm-view">
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
    </>
  );
}
