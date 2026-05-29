// WelcomePage — shown to authed users on tier='waitlist' who haven't
// chosen a path yet. Mirrors the PricingPage's two-card layout:
//   • Free Demo  → opens WaitlistModal for socials submission
//   • Creator    → routes to /pricing for Stripe Checkout
//
// Auto-opens the WaitlistModal when the URL is /waitlist (preserves the
// old route's destination without requiring a dedicated page).

import { useEffect, useState } from 'react';
import { useAuth } from './AuthGate.jsx';
import { logEvent } from '../lib/analytics.js';
import { SoleilWordmark } from '../components/SoleilWordmark.jsx';
import { WaitlistModal } from '../components/WaitlistModal.jsx';

export function WelcomePage() {
  const { user, signOut } = useAuth();
  const [socialsOpen, setSocialsOpen] = useState(false);

  // /waitlist auto-opens the modal so links to it still work.
  useEffect(() => {
    if (window.location.pathname === '/waitlist') setSocialsOpen(true);
  }, []);
  useEffect(() => { logEvent('welcome_view'); }, []);

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

      <div className="waitlist-status-card welcome-card">
        <p className="waitlist-status-sub t-body welcome-card-lede">
          If you are a singular user requesting access to our demo, please
          submit artist socials for evaluation. Want instant access? Skip the
          wait with a subscription.
        </p>
        <div className="waitlist-status-cta-row">
          <button
            className="pricing-cta pricing-cta-secondary waitlist-status-cta"
            onClick={() => setSocialsOpen(true)}
          >
            Submit Socials
          </button>
          <button
            className="pricing-cta pricing-cta-primary waitlist-status-cta"
            onClick={() => { window.location.assign('/pricing'); }}
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
        <button className="auth-link" onClick={signOut}>Use a different email</button>
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
