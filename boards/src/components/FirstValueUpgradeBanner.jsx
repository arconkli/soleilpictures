// FirstValueUpgradeBanner — a soft, non-blocking nudge shown ONCE to a demo user
// the first time they place a genuine card (their "first value" moment). Unlike
// the cap-hit/shared-edit upgrade MODALS, this never blocks the canvas: it slides
// in at the bottom and is trivial to ignore, so it can't hurt the very activation
// we're trying to protect. "See Creator" opens the existing PricingModal (with the
// 'first-value' framing, surface='first_value'); "Not now" dismisses.
//
// All state, once-per-account persistence, and analytics live in App.jsx (the
// owner). This component is purely presentational + fires nothing on its own.

import { useEffect, useRef, useState } from 'react';

export function FirstValueUpgradeBanner({ onSeeCreator, onDismiss }) {
  // "Not now" animates out before App.jsx unmounts us. "See Creator" stays
  // immediate — the pricing modal covers the banner anyway.
  const [leaving, setLeaving] = useState(false);
  const leaveTimer = useRef(null);
  useEffect(() => () => clearTimeout(leaveTimer.current), []);
  const dismiss = () => {
    if (leaving) return;
    setLeaving(true);
    leaveTimer.current = setTimeout(() => onDismiss?.(), 190);
  };
  return (
    <div className={`fv-banner surface-frosted${leaving ? ' is-leaving' : ''}`} role="dialog" aria-label="Upgrade to Creator">
      <div className="fv-banner-spark" aria-hidden="true">✦</div>
      <div className="fv-banner-copy">
        <div className="fv-banner-title">Your first board is taking shape.</div>
        <div className="fv-banner-body">
          Creator unlocks unlimited cards, boards, and full edit access.
        </div>
      </div>
      <div className="fv-banner-actions">
        <button className="fv-banner-cta" onClick={onSeeCreator}>See Creator</button>
        <button className="fv-banner-dismiss" onClick={dismiss}>Not now</button>
      </div>
    </div>
  );
}
