// AdminPage — /admin. Visible only to tier='admin'. Two tabs:
//   • Waitlist — pending entries with Accept now / Reject / Reschedule
//   • Users    — search by email, see tier + subscription, grant/revoke
//
// Manual overrides on waitlist call the admin-waitlist-action Edge
// Function. Tier mutations on users go through a direct UPDATE on
// profiles (RLS only lets admins read; we add a one-off admin-write
// pathway via the same Edge Function — keep it tight for v1).

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../auth/AuthGate.jsx';
import { useMyTier } from '../hooks/useMyTier.js';
import { SoleilWordmark } from '../components/SoleilWordmark.jsx';

const ACTION_URL = (import.meta.env.VITE_SUPABASE_URL || '') + '/functions/v1/admin-waitlist-action';

export function AdminPage() {
  const { user, signOut } = useAuth();
  const { tier, loading } = useMyTier({ userId: user?.id });
  const [tab, setTab] = useState('waitlist');

  if (loading) return <Splash />;
  if (tier !== 'admin') {
    return (
      <div className="welcome-screen">
        <div className="welcome-card welcome-card-tight">
          <SoleilWordmark size="display" />
          <p className="welcome-copy t-body">Admin only.</p>
          <button className="auth-link" onClick={() => { window.location.assign('/'); }}>← Back</button>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-screen">
      <header className="admin-header">
        <SoleilWordmark size="block" />
        <div className="admin-tabs">
          <button className={`admin-tab ${tab === 'waitlist' ? 'is-active' : ''}`} onClick={() => setTab('waitlist')}>
            Waitlist
          </button>
          <button className={`admin-tab ${tab === 'users' ? 'is-active' : ''}`} onClick={() => setTab('users')}>
            Users
          </button>
        </div>
        <div className="admin-header-right">
          <button className="auth-link" onClick={() => { window.location.assign('/'); }}>← App</button>
          <button className="auth-link" onClick={signOut}>Sign out</button>
        </div>
      </header>

      <main className="admin-body">
        {tab === 'waitlist' ? <WaitlistTab /> : <UsersTab />}
      </main>
    </div>
  );
}

function Splash() {
  return <div className="welcome-screen"><div className="welcome-card welcome-card-tight"><p className="welcome-copy t-body">Loading…</p></div></div>;
}

function WaitlistTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

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

  if (loading) return <p className="admin-empty">Loading…</p>;
  if (rows.length === 0) return <p className="admin-empty">No waitlist entries yet.</p>;

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
            <th></th>
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
                    <a key={i} href={/^https?:\/\//.test(l) ? l : `https://${l}`} target="_blank" rel="noreferrer" className="admin-link">{l.replace(/^https?:\/\//, '').slice(0, 40)}</a>
                  ))}
                  {links.length > 3 && <span className="admin-muted">+{links.length - 3}</span>}
                </td>
                <td><span className={`admin-status admin-status-${r.status}`}>{r.status}</span></td>
                <td className="admin-muted">{r.scheduled_accept_at ? new Date(r.scheduled_accept_at).toLocaleString() : '—'}</td>
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

function UsersTab() {
  const [query, setQuery] = useState('');
  const [rows, setRows]   = useState([]);
  const [loading, setLoading] = useState(false);

  const search = async () => {
    const q = query.trim().toLowerCase();
    if (!q) { setRows([]); return; }
    setLoading(true);
    // Admins can read all profiles (RLS lets admins read everything via the
    // tier='admin' check). Join via the user_id_by_email lookup for email search.
    const { data: uid } = await supabase.rpc('user_id_by_email', { p_email: q });
    if (!uid) { setRows([]); setLoading(false); return; }
    const { data } = await supabase
      .from('profiles')
      .select('user_id, tier, demo_card_count, updated_at')
      .eq('user_id', uid);
    setRows((data || []).map((r) => ({ ...r, email: q })));
    setLoading(false);
  };

  return (
    <div className="admin-section">
      <div className="admin-search-row">
        <input
          className="auth-input"
          type="email"
          placeholder="search by exact email…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') search(); }}
        />
        <button className="auth-btn" onClick={search} disabled={loading || !query.trim()}>
          {loading ? '…' : 'Search'}
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="admin-empty">Type an email and hit Enter.</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr><th>Email</th><th>Tier</th><th>Card count</th><th>Updated</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.user_id}>
                <td className="admin-email">{r.email}</td>
                <td><span className={`admin-status admin-status-${r.tier}`}>{r.tier}</span></td>
                <td>{r.demo_card_count}</td>
                <td className="admin-muted">{r.updated_at ? new Date(r.updated_at).toLocaleString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="admin-empty t-meta" style={{ marginTop: 20 }}>
        Tier mutations (grant admin/paid, revoke) aren't wired in v1. Use the SQL editor or
        extend admin-waitlist-action with a 'set-tier' action.
      </p>
    </div>
  );
}
