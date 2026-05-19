import { SoleilWordmark } from '../../components/SoleilWordmark.jsx';

// Phone-width gate for /admin. Admin tabs (Universe, Users, Waitlist,
// Analytics, Overview, Feedback) are desktop-only — they're table /
// grid / GPU-instanced-graph dense. Per the mobile overhaul scoping
// decision, we don't build phone layouts for them.
//
// Rendered from AdminPage.jsx when useBreakpoint().isPhone is true.
export function AdminPhoneGate() {
  return (
    <div className="welcome-screen">
      <div className="welcome-card welcome-card-tight">
        <SoleilWordmark size="display" />
        <p className="welcome-copy t-body">
          The admin dashboard requires a larger screen.<br />
          Open this page on a tablet or desktop.
        </p>
        <button className="auth-link" onClick={() => { window.location.assign('/'); }}>
          ← Back to Clusters
        </button>
      </div>
    </div>
  );
}
