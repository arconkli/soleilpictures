// WaitlistModal — in-app socials-submission popup. Triggered from
// WelcomePage's "Submit Socials" card. Same payload as the old
// /waitlist full-page form: a freeform list of links + the user's
// timezone, posted to the submit-waitlist Edge Function.
//
// On success → /waitlist/status. On error → inline message.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase.js';
import { logEvent } from '../lib/analytics.js';
import { useAuth } from '../auth/AuthGate.jsx';

const EDGE_URL = (import.meta.env.VITE_SUPABASE_URL || '') + '/functions/v1/submit-waitlist';

export function WaitlistModal({ onClose }) {
  const { user } = useAuth();
  const [rows, setRows]   = useState(['']);
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { logEvent('submit_socials_open'); }, []);

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
        headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ links, timezone: tz }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      logEvent('submit_socials_done', { link_count: links.length });
      window.location.assign('/waitlist/status');
    } catch (err) {
      setError(err?.message || String(err));
      setBusy(false);
    }
  };

  return createPortal(
    <div className="upgrade-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="upgrade-modal">
        <button className="upgrade-close" onClick={onClose} aria-label="Close" disabled={busy}>×</button>

        <div className="upgrade-intro">
          <div className="upgrade-eyebrow t-eyebrow">SUBMIT YOUR SOCIALS</div>
          <h2 className="upgrade-title">Show us your work.</h2>
          <p className="upgrade-sub t-body">
            Drop any links that represent your creative work — Instagram, TikTok,
            YouTube, portfolio, anything. Average wait is ~7 days.
          </p>
        </div>

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
                <button type="button" className="waitlist-remove" onClick={() => removeRow(i)} aria-label="Remove">×</button>
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

          <button
            type="submit"
            className="pricing-cta pricing-cta-primary"
            disabled={busy}
          >
            {busy ? 'Submitting…' : 'Join the waitlist'}
          </button>
        </form>

        <div className="upgrade-foot t-meta">
          Signed in as <b>{user?.email}</b>
        </div>
      </div>
    </div>,
    document.body,
  );
}
