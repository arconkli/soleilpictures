import { FeedbackProvider, useFeedback } from '../components/AppFeedback.jsx';
import { POWER_REVEALS } from '../lib/powerReveals.js';

// Dev-only harness for ?revealqa=1. Mounts the REAL FeedbackProvider (which
// hosts FeedbackOverlay) and fires the REAL power-reveal registry entries as
// toasts — exact copy, exact action labels, exact styling — so the reveal
// surface can be reviewed and screenshotted without a signed-in Supabase
// session (the live reveal effect only runs on the Workspace path). Buttons
// fire one reveal each; the action button just acknowledges (the real actions
// need live mutators). DEV only — dropped from production builds.

function RevealButtons() {
  const feedback = useFeedback();
  const fire = (r) => feedback.toast({
    message: r.message,
    ttl: 60000, // parked long so screenshots aren't racing the auto-dismiss
    action: { label: r.actionLabel, onClick: () => {} },
  });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: 220 }}>
      {POWER_REVEALS.map((r) => (
        <button key={r.key} type="button" data-reveal={r.key} onClick={() => fire(r)}
                style={{ padding: '8px 12px', textAlign: 'left' }}>
          fire: {r.key}
        </button>
      ))}
    </div>
  );
}

export function RevealQaHarness() {
  return (
    <FeedbackProvider>
      <div id="revealqa-ready" className="canvas-wrap"
           style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <RevealButtons />
      </div>
    </FeedbackProvider>
  );
}
