// WaitlistModal — in-app socials-submission popup. Triggered from
// WelcomePage's "Submit Socials" card. Posts the user's freeform link
// list + timezone to the submit-waitlist Edge Function.
//
// Socials are optional — they're useful for review but not required to
// join the waitlist. The button label flips between "Join the waitlist"
// and "Skip & join the waitlist" based on whether anything's been typed.

import { useEffect, useMemo, useState } from 'react';
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

  const validLinks = useMemo(
    () => rows.map((r) => r.trim()).filter(Boolean),
    [rows]
  );
  const hasLinks = validLinks.length > 0;

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) throw new Error('Not signed in.');
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await fetch(EDGE_URL, {
        method: 'POST',
        headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ links: validLinks, timezone: tz }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      logEvent('submit_socials_done', { link_count: validLinks.length });
      window.location.assign('/waitlist/status');
    } catch (err) {
      setError(err?.message || String(err));
      setBusy(false);
    }
  };

  return createPortal(
    <div className="upgrade-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="upgrade-modal waitlist-modal-card">
        <button className="upgrade-close" onClick={onClose} aria-label="Close" disabled={busy}>×</button>

        {/* Header (mirrors PricingModal's intro shape) */}
        <div className="waitlist-card-head">
          <div className="waitlist-card-eyebrow t-eyebrow">
            Submit your socials <span className="waitlist-optional-tag">Optional</span>
          </div>
          <h2 className="waitlist-card-title">Show us your work.</h2>
          <p className="waitlist-card-sub t-body">
            Drop links to your creative work — Instagram, TikTok, YouTube,
            portfolio, anything. Or skip and we'll accept based on email alone.
          </p>
        </div>

        {/* Form section — matches the pricing-card "field list" feel */}
        <form className="waitlist-card-form" onSubmit={submit}>
          <label className="waitlist-card-label">Your links</label>

          <div className="waitlist-card-fields">
            {rows.map((row, i) => (
              <div key={i} className="waitlist-card-field">
                <input
                  className="waitlist-card-input"
                  type="text"
                  placeholder={i === 0
                    ? 'instagram.com/your-handle'
                    : i === 1
                      ? 'tiktok.com/@your-handle'
                      : 'https:// or @handle'}
                  value={row}
                  onChange={(e) => updateRow(i, e.target.value)}
                  disabled={busy}
                  autoFocus={i === 0}
                />
                {rows.length > 1 && (
                  <button type="button"
                          className="waitlist-card-remove"
                          onClick={() => removeRow(i)}
                          aria-label="Remove">
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>

          {rows.length < 20 && (
            <button
              type="button"
              className="waitlist-card-add"
              onClick={addRow}
              disabled={busy}
            >
              + Add another link
            </button>
          )}

          {error && <div className="auth-error t-meta">{error}</div>}

          <button
            type="submit"
            className="pricing-cta pricing-cta-primary waitlist-card-cta"
            disabled={busy}
          >
            {busy
              ? 'Submitting…'
              : hasLinks
                ? 'Join the waitlist'
                : 'Skip & join the waitlist'}
          </button>
          <div className="waitlist-card-hint t-meta">
            We'll email you within about a week once approved.
          </div>
        </form>

        <div className="upgrade-foot t-meta">
          Signed in as <b>{user?.email}</b>
        </div>
      </div>
    </div>,
    document.body,
  );
}
