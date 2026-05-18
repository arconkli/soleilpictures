// WaitlistConfirm — "you're on the list" page. Shown after submitting
// the WaitlistForm, OR whenever an authed tier='waitlist' user already
// has a pending waitlist_entries row.
//
// Reads the user's own entry via the RLS-allowed select on their email,
// shows the scheduled accept date, and offers an upgrade shortcut.

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from './AuthGate.jsx';
import { SoleilWordmark } from '../components/SoleilWordmark.jsx';

export function WaitlistConfirm() {
  const { user, signOut } = useAuth();
  const [entry, setEntry] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.email) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('waitlist_entries')
        .select('scheduled_accept_at, status, created_at')
        .eq('email', user.email.toLowerCase())
        .maybeSingle();
      if (!cancelled) {
        setEntry(data || null);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.email]);

  const formattedDate = entry?.scheduled_accept_at
    ? new Date(entry.scheduled_accept_at).toLocaleDateString(undefined, {
        weekday: 'long', month: 'long', day: 'numeric',
      })
    : null;

  return (
    <div className="welcome-screen">
      <div className="auth-glow" aria-hidden="true" />
      <div className="welcome-card welcome-card-tight">
        <SoleilWordmark size="display" />

        {loading ? (
          <p className="welcome-copy t-body">Loading…</p>
        ) : !entry ? (
          <>
            <p className="welcome-copy t-body">
              No waitlist entry found for <b>{user?.email}</b>. Pick a path to continue.
            </p>
            <div className="welcome-cta-row">
              <button
                className="welcome-cta welcome-cta-secondary"
                onClick={() => { window.location.assign('/waitlist'); }}
              >
                Submit Socials →
              </button>
              <button
                className="welcome-cta welcome-cta-primary"
                onClick={() => { window.location.assign('/pricing'); }}
              >
                Pricing Options →
              </button>
            </div>
          </>
        ) : entry.status === 'rejected' ? (
          <>
            <div className="welcome-eyebrow t-eyebrow">WAITLIST</div>
            <p className="welcome-copy t-body">
              Your application wasn't accepted. You can still skip the wait and join via a paid plan.
            </p>
            <div className="welcome-cta-row">
              <button
                className="welcome-cta welcome-cta-primary"
                onClick={() => { window.location.assign('/pricing'); }}
              >
                See Pricing →
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="welcome-eyebrow t-eyebrow">YOU'RE ON THE LIST</div>
            <p className="welcome-copy t-body">
              We'll email you when you're in
              {formattedDate ? <> — around <b>{formattedDate}</b></> : ''}.
              Average wait time is ~7 days.
            </p>
            <p className="welcome-copy welcome-copy-tight t-body">
              Want in sooner? Skip the wait by going paid.
            </p>
            <div className="welcome-cta-row">
              <button
                className="welcome-cta welcome-cta-primary"
                onClick={() => { window.location.assign('/pricing'); }}
              >
                See Pricing →
              </button>
            </div>
          </>
        )}

        <button className="auth-link auth-foot-link t-meta" onClick={signOut}>
          Use a different email
        </button>
      </div>
    </div>
  );
}
