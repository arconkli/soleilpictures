import { useEffect, useRef, useState } from 'react';
import { logEventOnce } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { useBreakpoint } from '../hooks/useBreakpoint.js';

// First-run coachmark. A small dismissible pill anchored bottom-center of the
// canvas, shown ONCE to a brand-new user right after we seed their starter
// cards. It nudges the single highest-leverage action — placing their OWN first
// card — because the live data showed new users hit the blank canvas and bounce
// (~44s median, only a fraction ever create anything).
//
// Dismissal is owned by App.jsx (dismissOnboarding): it fires on the first real
// card placed, the first note nested into the tutorial board, or when the user
// clicks "Got it" here. This component only renders + fires the one-time view event.
//
// When a tutorial "Ideas" board was seeded (the common path), the copy reinforces
// the drag-to-nest AHA the seeded note teaches. If board creation failed and only
// notes were seeded (hasTutorialBoard=false), it falls back to the add-a-card nudge.
export function OnboardingCoachmark({ boardId, onDismiss, hasTutorialBoard = false }) {
  const { isTouch } = useBreakpoint();
  // "Got it" animates out before App.jsx unmounts us; external dismissals
  // (first card placed, note nested) still remove the pill immediately —
  // the user is mid-action there and never watches it go.
  const [leaving, setLeaving] = useState(false);
  const leaveTimer = useRef(null);
  useEffect(() => () => clearTimeout(leaveTimer.current), []);
  const dismiss = () => {
    if (leaving) return;
    setLeaving(true);
    leaveTimer.current = setTimeout(() => onDismiss?.('dismissed'), 190);
  };
  useEffect(() => {
    logEventOnce('onboarding_view', EV.ONBOARDING_VIEW, { board_id: boardId || null });
  }, [boardId]);

  return (
    <div className={`onboarding-coachmark surface-frosted${leaving ? ' is-leaving' : ''}`} role="status">
      <div className="onboarding-coachmark-spark" aria-hidden="true">✦</div>
      <div className="onboarding-coachmark-copy">
        <div className="onboarding-coachmark-title">Make it yours</div>
        <div className="onboarding-coachmark-body">
          {hasTutorialBoard
            ? 'Drag the note into the “Ideas” board to organize it ✨'
            : isTouch
              ? 'Tap the + on the left, or long-press the canvas, to add your first card.'
              : 'Right-click, use the + on the left, or drag an image straight in to add your first card.'}
        </div>
      </div>
      <button
        className="onboarding-coachmark-dismiss"
        onClick={dismiss}
      >
        Got it
      </button>
    </div>
  );
}
