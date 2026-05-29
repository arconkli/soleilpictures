import { EmptyState } from '../../components/EmptyState.jsx';
import { Browsers } from '../../lib/icons.js';

// Phone-width gate for /admin. The admin tabs (Overview, Analytics, Users,
// Grants, Waitlist, Feedback, Tagging, Universe) are table / grid /
// GPU-instanced-graph dense and desktop-only — per the mobile overhaul
// scoping decision we don't build phone layouts for them.
//
// Rendered from AdminPage.jsx when useBreakpoint().isPhone is true.
export function AdminPhoneGate() {
  return (
    <div className="welcome-screen">
      <EmptyState
        icon={Browsers}
        title="Open on a larger screen"
        body="The admin dashboard is desktop-only. Open this page on a tablet or desktop."
        action={{ label: '← Back to Clusters', onClick: () => window.location.assign('/') }}
      />
    </div>
  );
}
