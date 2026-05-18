// AdminWaitlistTab — extracted verbatim from the original AdminPage's
// WaitlistTab. No behavior change; sibling components live next to it now.

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase.js';

const ACTION_URL = (import.meta.env.VITE_SUPABASE_URL || '') + '/functions/v1/admin-waitlist-action';

export function AdminWaitlistTab() {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId]   = useState(null);
  const [error, setError]     = useState(null);

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

  const act = async (entry, action, days) => {
    setBusyId(entry.id);
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      const res = await fetch(ACTION_URL, {
        method: 'POST',
        headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ entry_id: entry.id, action, days }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
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
      <table className="admin-table">
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
                    <>
                      <button className="admin-action admin-action-primary" disabled={busyId === r.id} onClick={() => act(r, 'accept')}>Accept</button>
                      <button className="admin-action" disabled={busyId === r.id} onClick={() => act(r, 'reschedule', 7)}>+7d</button>
                      <button className="admin-action admin-action-danger" disabled={busyId === r.id} onClick={() => act(r, 'reject')}>Reject</button>
                    </>
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
