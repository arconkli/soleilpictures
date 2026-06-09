// WelcomePage — shown to authed users on tier='waitlist' who haven't
// chosen a path yet. Mirrors the PricingPage's two-card layout:
//   • Free Demo  → opens WaitlistModal for socials submission
//   • Creator    → routes to /pricing for Stripe Checkout
//
// Auto-opens the WaitlistModal when the URL is /waitlist (preserves the
// old route's destination without requiring a dedicated page).

import { useEffect, useState, useRef } from 'react';
import { useAuth } from './AuthGate.jsx';
import { logEvent, logEventNow, logEventOnce } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { useDwellTime } from '../hooks/useDwellTime.js';
import { SoleilWordmark } from '../components/SoleilWordmark.jsx';
import { WaitlistModal } from '../components/WaitlistModal.jsx';

export function WelcomePage() {
  const { user, signOut } = useAuth();
  const [socialsOpen, setSocialsOpen] = useState(false);

  // /waitlist auto-opens the modal so links to it still work.
  useEffect(() => {
    if (window.location.pathname === '/waitlist') setSocialsOpen(true);
  }, []);
  useEffect(() => { logEventOnce('welcome_view', EV.WELCOME_VIEW); }, []);
  useDwellTime(EV.WELCOME_DWELL);

  // gate_dead_end: a waitlist user who landed on /welcome and left WITHOUT
  // engaging any path (no Submit Socials, no See Pricing) — the silent leak.
  // These users never enter the accept queue, so they're stranded with no
  // programmatic way in. Fires once, on hide/unmount, mirroring useDwellTime's
  // timing; engagedRef flips true the moment they take a path (below), which
  // suppresses the event. Turns the "19-user black hole" into a standing metric.
  const engagedRef = useRef(false);
  useEffect(() => { if (socialsOpen) engagedRef.current = true; }, [socialsOpen]);
  useEffect(() => {
    const startedAt = Date.now();
    let fired = false;
    const fire = () => {
      if (fired || engagedRef.current) return;
      fired = true;
      try { logEvent(EV.GATE_DEAD_END, { dwell_ms: Date.now() - startedAt }); } catch (_) {}
    };
    const onHide = () => { if (document.visibilityState === 'hidden') fire(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', fire);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', fire);
      fire();
    };
  }, []);

  return (
    <div className="pricing-screen">
      <div className="auth-glow" aria-hidden="true" />

      <header className="pricing-header">
        <SoleilWordmark size="display" />
      </header>

      <div className="welcome-contact t-meta">
        To report an issue or submit a suggestion please email us at:{' '}
        <a href="mailto:clusters@soleilpictures.com" className="auth-link">clusters@soleilpictures.com</a>
      </div>

      <div className="surface-frosted welcome-request-card">
        <p className="waitlist-status-sub t-body">
          If you are a singular user requesting access to our demo, please
          submit artist socials for evaluation. Want instant access? Skip the
          wait with a subscription.
        </p>
        <div className="waitlist-status-cta-row">
          <button
            className="pricing-cta pricing-cta-secondary waitlist-status-cta"
            onClick={() => { engagedRef.current = true; logEvent(EV.WELCOME_CTA, { target: 'waitlist' }); setSocialsOpen(true); }}
          >
            Submit Socials
          </button>
          <button
            className="pricing-cta pricing-cta-primary waitlist-status-cta"
            onClick={() => { engagedRef.current = true; logEventNow(EV.WELCOME_CTA, { target: 'pricing' }); window.location.assign('/pricing'); }}
          >
            See Pricing →
          </button>
        </div>
        <div className="welcome-card-foot t-meta">
          Most invites go out within about a week
          <span className="welcome-foot-sep">·</span>
          You'll receive an email once approved
        </div>
      </div>

      <footer className="pricing-foot t-meta">
        Signed in as <b>{user?.email}</b>
        <span className="welcome-foot-sep">·</span>
        <button className="auth-link" onClick={() => { logEvent(EV.WELCOME_SIGNOUT); signOut(); }}>Use a different email</button>
      </footer>

      {socialsOpen && (
        <WaitlistModal onClose={() => {
          setSocialsOpen(false);
          // Restore the URL if we auto-opened from /waitlist
          if (window.location.pathname === '/waitlist') {
            window.history.replaceState({}, '', '/welcome');
          }
        }} />
      )}
    </div>
  );
}
