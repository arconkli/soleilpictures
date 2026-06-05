import { useEffect } from 'react';
import { logEventOnce } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';

// First-run coachmark. A small dismissible pill anchored bottom-center of the
// canvas, shown ONCE to a brand-new user right after we seed their starter
// cards. It nudges the single highest-leverage action — placing their OWN first
// card — because the live data showed new users hit the blank canvas and bounce
// (~44s median, only a fraction ever create anything).
//
// Dismissal is owned by App.jsx (dismissOnboarding): it fires on the first real
// card placed, or when the user clicks "Got it" here. This component only
// renders + fires the one-time view event.
export function OnboardingCoachmark({ boardId, onDismiss }) {
  useEffect(() => {
    logEventOnce('onboarding_view', EV.ONBOARDING_VIEW, { board_id: boardId || null });
  }, [boardId]);

  return (
    <div className="onboarding-coachmark surface-frosted" role="status">
      <div className="onboarding-coachmark-spark" aria-hidden="true">✦</div>
      <div className="onboarding-coachmark-copy">
        <div className="onboarding-coachmark-title">Make it yours</div>
        <div className="onboarding-coachmark-body">
          Right-click, use the + on the left, or drag an image straight in to add your first card.
        </div>
      </div>
      <button
        className="onboarding-coachmark-dismiss"
        onClick={() => onDismiss?.('dismissed')}
      >
        Got it
      </button>
    </div>
  );
}
