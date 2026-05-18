// WaitlistForm — collect a freeform list of social/creative links from
// a tier='waitlist' user and submit to the submit-waitlist Edge Function.
// Posts the user's local timezone alongside (browser-supplied) so the
// cron can target their evening window.
//
// On success → /waitlist/status. On failure → inline error.

import { useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from './AuthGate.jsx';
import { SoleilWordmark } from '../components/SoleilWordmark.jsx';

const EDGE_URL = (import.meta.env.VITE_SUPABASE_URL || '') + '/functions/v1/submit-waitlist';

export function WaitlistForm() {
  const { user, signOut } = useAuth();
  const [rows, setRows]   = useState(['']);   // start with one empty input
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);

  const updateRow = (i, v) => setRows((arr) => arr.map((x, idx) => idx === i ? v : x));
  const addRow    = ()      => setRows((arr) => arr.length < 20 ? [...arr, ''] : arr);
  const removeRow = (i)     => setRows((arr) => arr.length === 1 ? [''] : arr.filter((_, idx) => idx !== i));

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    const links = rows.map((r) => r.trim()).filter(Boolean);
    if (links.length === 0) { setError('Add at least one link.'); return; }
    setBusy(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) throw new Error('Not signed in.');

      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await fetch(EDGE_URL, {
        method: 'POST',
        headers: {
          'authorization': `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ links, timezone: tz }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);

      window.location.assign('/waitlist/status');
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="welcome-screen">
      <div className="auth-glow" aria-hidden="true" />
      <div className="welcome-card welcome-card-tight">
        <SoleilWordmark size="display" />
        <div className="welcome-eyebrow t-eyebrow">SUBMIT YOUR SOCIALS</div>
        <p className="welcome-copy welcome-copy-tight t-body">
          Drop any links that represent your creative work — Instagram,
          TikTok, YouTube, portfolio, anything.
          Signed in as <b>{user?.email}</b>.
        </p>

        <form className="waitlist-form" onSubmit={submit}>
          {rows.map((row, i) => (
            <div key={i} className="waitlist-row">
              <input
                className="waitlist-input"
                type="text"
                placeholder="https:// or @handle"
                value={row}
                onChange={(e) => updateRow(i, e.target.value)}
                disabled={busy}
                autoFocus={i === 0}
              />
              {rows.length > 1 && (
                <button type="button" className="waitlist-remove" onClick={() => removeRow(i)} aria-label="Remove">
                  ×
                </button>
              )}
            </div>
          ))}

          <button
            type="button"
            className="waitlist-add"
            onClick={addRow}
            disabled={busy || rows.length >= 20}
          >
            + Add another
          </button>

          {error && <div className="auth-error t-meta">{error}</div>}

          <div className="waitlist-actions">
            <button
              type="button"
              className="waitlist-back"
              onClick={() => { window.location.assign('/welcome'); }}
              disabled={busy}
            >
              ← Back
            </button>
            <button
              type="submit"
              className="welcome-cta welcome-cta-primary waitlist-submit"
              disabled={busy}
            >
              {busy ? 'Submitting…' : 'Join the waitlist'}
            </button>
          </div>
        </form>

        <button className="auth-link auth-foot-link t-meta" onClick={signOut}>
          Use a different email
        </button>
      </div>
    </div>
  );
}
