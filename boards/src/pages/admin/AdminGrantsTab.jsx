// AdminGrantsTab — issue and manage time-bound paid-tier access grants.
//
//   • Top: paste a list of emails, pick a duration (presets or custom days
//     or Forever), optional note, hit Grant. Same duration applies to all.
//   • Bottom: paginated list of every grant — Active, Forever, Expired,
//     Revoked. Per-row Revoke button.
//
// Grants are independent of Stripe; either keeps a user on the paid tier.
// Pre-signup emails are stored as pending and auto-applied on first login
// (via the ensure_profile_for_new_user trigger). Expired grants are swept
// hourly by pg_cron + opportunistically when this tab is opened.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { useFeedback } from '../../components/AppFeedback.jsx';

const PAGE_SIZE = 50;

const DURATION_PRESETS = [
  { label: '7 days',   days: 7 },
  { label: '1 month',  days: 30 },
  { label: '3 months', days: 90 },
  { label: '6 months', days: 180 },
  { label: '1 year',   days: 365 },
  { label: 'Forever',  days: null },
  { label: 'Custom…',  days: 'custom' },
];

const STATUS_OPTIONS = [
  { value: '',         label: 'All statuses' },
  { value: 'active',   label: 'Active' },
  { value: 'forever',  label: 'Forever' },
  { value: 'expired',  label: 'Expired' },
  { value: 'revoked',  label: 'Revoked' },
];

function parseEmails(raw) {
  const seen = new Set();
  const out = [];
  for (const piece of (raw || '').split(/[\s,;]+/)) {
    const e = piece.trim().toLowerCase();
    if (!e) continue;
    if (seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out;
}

function formatExpires(iso) {
  if (!iso) return 'forever';
  const d = new Date(iso);
  const ms = d.getTime() - Date.now();
  if (ms < 0) return `expired ${d.toLocaleDateString()}`;
  const days = Math.floor(ms / 86400000);
  if (days < 1)  return 'today';
  if (days < 30) return `in ${days}d (${d.toLocaleDateString()})`;
  return d.toLocaleDateString();
}

function statusPillClass(status) {
  // Reuse the tier-pill .is-active palette: paid=green, demo=neutral, waitlist=red, admin=orange.
  if (status === 'active' || status === 'forever') return 'admin-tier-pill admin-tier-pill-paid is-active';
  if (status === 'expired')                        return 'admin-tier-pill admin-tier-pill-demo is-active';
  if (status === 'revoked')                        return 'admin-tier-pill admin-tier-pill-waitlist is-active';
  return 'admin-tier-pill';
}

export function AdminGrantsTab() {
  const feedback = useFeedback();

  // --- Grant form state ---
  const [emailsRaw, setEmailsRaw] = useState('');
  const [preset, setPreset]       = useState(30);          // days OR null OR 'custom'
  const [customDays, setCustomDays] = useState('');
  const [note, setNote]           = useState('');
  const [granting, setGranting]   = useState(false);

  const parsedEmails = useMemo(() => parseEmails(emailsRaw), [emailsRaw]);

  // --- List state ---
  const [query, setQueryRaw]      = useState('');
  const [debounced, setDebounced] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage]           = useState(0);
  const [rows, setRows]           = useState([]);
  const [total, setTotal]         = useState(0);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [busyEmail, setBusyEmail] = useState(null);

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Reset page when filters change
  useEffect(() => { setPage(0); }, [debounced, statusFilter]);

  const fetchPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = debounced || null;
      const s = statusFilter || null;
      const [listRes, countRes] = await Promise.all([
        supabase.rpc('admin_list_paid_grants', {
          p_limit:  PAGE_SIZE,
          p_offset: page * PAGE_SIZE,
          p_query:  q,
          p_status: s,
        }),
        supabase.rpc('admin_paid_grants_count', { p_query: q, p_status: s }),
      ]);
      if (listRes.error)  throw listRes.error;
      if (countRes.error) throw countRes.error;
      setRows(listRes.data || []);
      setTotal(Number(countRes.data) || 0);
    } catch (e) {
      setError(e?.message || String(e));
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, debounced, statusFilter]);

  useEffect(() => { fetchPage(); }, [fetchPage]);

  // Opportunistic sweep on mount — applies any grants that expired since
  // the last cron tick so the list shows accurate state.
  useEffect(() => {
    supabase.rpc('sweep_expired_paid_grants').catch(() => {});
  }, []);

  const onGrant = async (e) => {
    e?.preventDefault?.();
    if (parsedEmails.length === 0) {
      feedback.toast({ type: 'info', message: 'Enter at least one email.' });
      return;
    }

    let durationDays = null;
    if (preset === 'custom') {
      const n = Number(customDays);
      if (!Number.isFinite(n) || n <= 0) {
        feedback.toast({ type: 'info', message: 'Custom days must be a positive number.' });
        return;
      }
      durationDays = Math.floor(n);
    } else if (preset !== null) {
      durationDays = preset;
    }

    const label = durationDays === null ? 'forever' : `${durationDays} day${durationDays === 1 ? '' : 's'}`;
    const ok = await feedback.confirm({
      title: `Grant paid access to ${parsedEmails.length} email${parsedEmails.length === 1 ? '' : 's'}?`,
      message: `They'll be granted paid-tier access for ${label}. Re-granting replaces any previous expiry.`,
      confirmLabel: 'Grant access',
    });
    if (!ok) return;

    setGranting(true);
    try {
      const { data, error: err } = await supabase.rpc('admin_grant_paid_access', {
        p_emails:         parsedEmails,
        p_duration_days:  durationDays,
        p_note:           note.trim() || null,
      });
      if (err) throw err;
      const r = data || {};
      const parts = [];
      parts.push(`${r.granted ?? 0} granted`);
      if ((r.linked_existing_user ?? 0) > 0) parts.push(`${r.linked_existing_user} active now`);
      if ((r.pending_signup ?? 0)       > 0) parts.push(`${r.pending_signup} pending signup`);
      if ((r.invalid ?? 0)              > 0) parts.push(`${r.invalid} invalid`);
      feedback.toast({ type: 'success', message: parts.join(' · ') });
      setEmailsRaw('');
      setNote('');
      await fetchPage();
    } catch (ex) {
      feedback.toast({ type: 'error', message: 'Grant failed: ' + (ex?.message || ex) });
    } finally {
      setGranting(false);
    }
  };

  const onRevoke = async (row) => {
    const ok = await feedback.confirm({
      title:        `Revoke access for ${row.email}?`,
      message:      row.user_id
        ? `${row.email} will drop to demo tier immediately (unless they have an active Stripe subscription).`
        : `${row.email} hasn't signed up yet — the pending grant will be removed.`,
      confirmLabel: 'Revoke',
      danger:       true,
    });
    if (!ok) return;

    setBusyEmail(row.email);
    try {
      const { error: err } = await supabase.rpc('admin_revoke_paid_access', { p_email: row.email });
      if (err) throw err;
      feedback.toast({ type: 'success', message: `Revoked ${row.email}` });
      await fetchPage();
    } catch (ex) {
      feedback.toast({ type: 'error', message: 'Revoke failed: ' + (ex?.message || ex) });
    } finally {
      setBusyEmail(null);
    }
  };

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstIdx  = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const lastIdx   = Math.min(total, (page + 1) * PAGE_SIZE);

  return (
    <div className="admin-section">

      {/* ===== Grant form ===== */}
      <form onSubmit={onGrant} style={{ marginBottom: 32 }}>
        <h3 className="t-section" style={{ marginBottom: 12 }}>Grant paid access</h3>

        <textarea
          className="auth-input"
          rows={4}
          placeholder="emails — one per line, or comma/space separated"
          value={emailsRaw}
          onChange={(e) => setEmailsRaw(e.target.value)}
          style={{ width: '100%', fontFamily: 'inherit', marginBottom: 12 }}
        />

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <label className="t-meta admin-muted" htmlFor="grant-duration">Duration</label>
          <select
            id="grant-duration"
            className="auth-input admin-filter-select"
            value={preset === null ? 'forever' : String(preset)}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'forever')      setPreset(null);
              else if (v === 'custom')  setPreset('custom');
              else                      setPreset(Number(v));
            }}
            style={{ width: 160 }}
          >
            {DURATION_PRESETS.map((p) => (
              <option
                key={p.label}
                value={p.days === null ? 'forever' : p.days === 'custom' ? 'custom' : String(p.days)}
              >
                {p.label}
              </option>
            ))}
          </select>

          {preset === 'custom' && (
            <>
              <input
                className="auth-input"
                type="number"
                min="1"
                placeholder="days"
                value={customDays}
                onChange={(e) => setCustomDays(e.target.value)}
                style={{ width: 100 }}
              />
              <span className="t-meta admin-muted">days</span>
            </>
          )}

          <input
            className="auth-input"
            type="text"
            placeholder="note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            style={{ flex: '1 1 220px', minWidth: 220 }}
          />

          <button
            type="submit"
            className="admin-action admin-action-primary"
            disabled={granting || parsedEmails.length === 0}
          >
            {granting
              ? 'Granting…'
              : `Grant access${parsedEmails.length > 0 ? ` (${parsedEmails.length})` : ''}`}
          </button>
        </div>

        {parsedEmails.length > 0 && (
          <div className="t-meta admin-muted">
            {parsedEmails.length} unique email{parsedEmails.length === 1 ? '' : 's'} parsed
          </div>
        )}
      </form>

      {/* ===== List ===== */}
      <h3 className="t-section" style={{ marginBottom: 12 }}>Grants</h3>

      <div className="admin-filter-row">
        <input
          className="auth-input admin-search-input"
          type="text"
          placeholder="search email…"
          value={query}
          onChange={(e) => setQueryRaw(e.target.value)}
        />
        <select
          className="auth-input admin-filter-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <div className="admin-filter-meta t-meta">
          {loading
            ? 'Loading…'
            : total === 0
              ? 'No grants'
              : `${firstIdx.toLocaleString()}–${lastIdx.toLocaleString()} of ${total.toLocaleString()}`}
        </div>
      </div>

      {error && <div className="auth-error t-meta">{error}</div>}

      {rows.length === 0 && !loading ? (
        <div className="admin-empty">
          No grants {statusFilter || query ? 'match these filters' : 'yet — grant some above'}.
        </div>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Signed up?</th>
              <th>Tier</th>
              <th>Status</th>
              <th>Expires</th>
              <th>Granted by</th>
              <th>Granted</th>
              <th>Note</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isRevoked = r.status === 'revoked';
              return (
                <tr key={r.email}>
                  <td className="admin-email">{r.email}</td>
                  <td className="admin-muted">
                    {r.signed_up ? '✓' : <span title="grant will apply on first sign-in">pending</span>}
                  </td>
                  <td className="admin-muted">{r.current_tier || '—'}</td>
                  <td><span className={statusPillClass(r.status)}>{r.status}</span></td>
                  <td className="admin-muted">{formatExpires(r.expires_at)}</td>
                  <td className="admin-muted">{r.granted_by_email || '—'}</td>
                  <td className="admin-muted">
                    {r.granted_at ? new Date(r.granted_at).toLocaleDateString() : '—'}
                  </td>
                  <td className="admin-muted">{r.note || ''}</td>
                  <td className="admin-actions">
                    <button
                      className="admin-action admin-action-danger"
                      disabled={isRevoked || busyEmail === r.email}
                      onClick={() => onRevoke(r)}
                      title={isRevoked ? 'Already revoked' : 'Revoke this grant'}
                    >
                      {busyEmail === r.email ? '…' : isRevoked ? 'revoked' : 'Revoke'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {pageCount > 1 && (
        <div className="admin-pagination">
          <button
            className="admin-action"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            ← Prev
          </button>
          <span className="admin-muted">Page {page + 1} of {pageCount}</span>
          <button
            className="admin-action"
            disabled={page >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
