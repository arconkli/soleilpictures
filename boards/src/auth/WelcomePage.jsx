// WelcomePage — shown to authed users on tier='waitlist' who haven't
// chosen a path yet. Two CTAs: Submit Socials (→ /waitlist) or
// Pricing Options (→ /pricing). Mirrors the reference screenshot layout.

import { useAuth } from './AuthGate.jsx';
import { SoleilWordmark } from '../components/SoleilWordmark.jsx';

export function WelcomePage() {
  const { signOut } = useAuth();

  return (
    <div className="welcome-screen">
      <div className="auth-glow" aria-hidden="true" />
      <div className="welcome-card">
        <SoleilWordmark size="display" />

        <p className="welcome-copy t-body">
          Due to the large number of new creators, there is a waitlist
          of a few days to try our demo version only for our most
          creative users. To be accepted, submit any creative social
          media accounts for evaluation or check our pricing options
          for instant usage.
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

        <div className="welcome-foot t-meta">
          Average wait time is ~7 days
          <span className="welcome-foot-sep">·</span>
          You will receive an email once approved
        </div>
      </div>

      <button className="auth-link auth-foot-link t-meta" onClick={signOut}>
        Use a different email
      </button>
    </div>
  );
}
