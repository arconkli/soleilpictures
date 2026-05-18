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

      <p className="welcome-intro t-body">
        Due to the large number of new creators, there is a waitlist to try our
        demo version. As we are unable to support everyone please submit your
        creative socials for review and we will get back to you soon. Or skip
        the wait and get a creator subscription for instant usage.
      </p>

      <div className="pricing-grid">

        {/* DEMO / WAITLIST */}
        <article className="pricing-card pricing-card-demo">
          <div className="pricing-card-head">
            <div className="pricing-card-name">Free Demo</div>
            <div className="pricing-card-price">~7d<span className="pricing-card-price-unit"> wait</span></div>
          </div>
          <ul className="pricing-features">
            <li>Submit your creative socials for review</li>
            <li>Average wait time 3 – 7 days</li>
            <li>100 cards total, view-only on others' boards</li>
            <li>Email when you're accepted</li>
          </ul>
          <button
            className="pricing-cta pricing-cta-secondary"
            onClick={() => setSocialsOpen(true)}
          >
            Submit Socials
          </button>
        </article>

        {/* CREATOR / SKIP */}
        <article className="pricing-card pricing-card-creator">
          <div className="pricing-card-head">
            <div className="pricing-card-name">Creator</div>
            <div className="pricing-card-price">$20<span className="pricing-card-price-unit">/mo</span></div>
          </div>
          <ul className="pricing-features">
            <li>Skip the wait — instant access</li>
            <li>Unlimited cards, boards, exports</li>
            <li>Edit on others' boards, invite editors</li>
            <li>All Creative Tools + Virtual + Social events</li>
          </ul>
          <button
            className="pricing-cta pricing-cta-primary"
            onClick={() => { window.location.assign('/pricing'); }}
          >
            See Pricing →
          </button>
        </article>

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
