// AdminWaitlistTab — review pending waitlist entries.
// Per row (pending only): Accept now, custom date/time picker for
// rescheduling, quick +7d shortcut, Reject.

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase.js';

const ACTION_URL = (import.meta.env.VITE_SUPABASE_URL || '') + '/functions/v1/admin-waitlist-action';

// <input type="datetime-local"> expects "YYYY-MM-DDTHH:MM" in *local*
// time. These helpers convert between that and ISO UTC.
function isoToLocalInput(iso) {
  if (!iso) {
    // Default to one week from now, rounded to the nearest hour.
    const d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    d.setMinutes(0, 0, 0);
    return localInputString(d);
  }
  return localInputString(new Date(iso));
}
function localInputString(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localInputToIso(local) {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function AdminWaitlistTab() {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId]   = useState(null);
  const [error, setError]     = useState(null);
  // Local edit state for each row's date picker. Map<entry_id, local-input-string>.
  const [drafts, setDrafts]   = useState({});

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('waitlist_entries')
      .select('id, email, links, status, scheduled_accept_at, accepted_at, rejected_at, created_at')
      .order('scheduled_accept_at', { ascending: true })
      .limit(200);
    if (error) setError(error.message);
    setRows(data || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const act = async (entry, action, extras = {}) => {
    setBusyId(entry.id);
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      const res = await fetch(ACTION_URL, {
        method: 'POST',
        headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ entry_id: entry.id, action, ...extras }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      // Clear the row's local draft after a successful action.
      setDrafts((d) => { const n = { ...d }; delete n[entry.id]; return n; });
      await load();
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <div className="admin-empty">Loading…</div>;
  if (rows.length === 0) return <div className="admin-empty">No waitlist entries yet.</div>;

  return (
    <div className="admin-section">
      {error && <div className="auth-error t-meta">{error}</div>}
      <table className="admin-table admin-waitlist-table">
        <thead>
          <tr>
            <th>Email</th>
            <th>Links</th>
            <th>Status</th>
            <th>Scheduled</th>
            <th>Joined</th>
            <th style={{ textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const links = Array.isArray(r.links) ? r.links : [];
            const isPending = r.status === 'pending';
            return (
              <tr key={r.id}>
                <td className="admin-email">{r.email}</td>
                <td className="admin-links">
                  {links.length === 0 ? <span className="admin-muted">—</span> : links.slice(0, 3).map((l, i) => (
                    <a key={i}
                       href={/^https?:\/\//.test(l) ? l : `https://${l}`}
                       target="_blank"
                       rel="noreferrer"
                       className="admin-link">
                      {l.replace(/^https?:\/\//, '').slice(0, 40)}
                    </a>
                  ))}
                  {links.length > 3 && <span className="admin-muted">+{links.length - 3}</span>}
                </td>
                <td><span className={`admin-status admin-status-${r.status}`}>{r.status}</span></td>
                <td className="admin-muted">
                  {r.scheduled_accept_at ? new Date(r.scheduled_accept_at).toLocaleString() : '—'}
                </td>
                <td className="admin-muted">{new Date(r.created_at).toLocaleDateString()}</td>
                <td className="admin-actions">
                  {isPending ? (
                    <div className="admin-waitlist-actions">
                      <button className="admin-action admin-action-primary" disabled={busyId === r.id} onClick={() => act(r, 'accept')}>Accept</button>
                      <input
                        type="datetime-local"
                        className="admin-action admin-waitlist-when"
                        value={drafts[r.id] ?? isoToLocalInput(r.scheduled_accept_at)}
                        disabled={busyId === r.id}
                        onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                      />
                      <button
                        className="admin-action"
                        disabled={busyId === r.id || !drafts[r.id]}
                        title="Reschedule to the selected date/time"
                        onClick={() => {
                          const iso = localInputToIso(drafts[r.id]);
                          if (!iso) return;
                          act(r, 'reschedule', { scheduled_at: iso });
                        }}
                      >
                        Set
                      </button>
                      <button className="admin-action" disabled={busyId === r.id} onClick={() => act(r, 'reschedule', { days: 7 })}>+7d</button>
                      <button className="admin-action admin-action-danger" disabled={busyId === r.id} onClick={() => act(r, 'reject')}>Reject</button>
                    </div>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
