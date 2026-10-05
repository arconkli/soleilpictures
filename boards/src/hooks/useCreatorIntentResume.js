// useCreatorIntentResume — reopen the Creator offer for someone who asked for it
// before they had an account.
//
// A signed-out "Get Creator" on /pricing writes the intent (lib/creatorIntent)
// and sends the visitor to sign in. This is the other half: once the signed-in
// app knows the tier, a fresh intent on a free account opens the same in-app
// offer every other surface uses. The trial is decided there, server-side, as
// always — a brand-new account is not eligible, so it is offered Creator at the
// price it clicked. Someone already paying has nothing to buy; their intent is
// simply spent.
//
// It CLAIMS the upsell slot before opening, as every deliberate press must (see
// openCapWall in App.jsx): an offer opened without a claim leaves the ambient
// surfaces nothing to defer to, which is how an asked-for upgrade screen once
// lived for 16 ms. If the slot is busy it waits out the window and tries again;
// the intent stays stored until it is shown or expires.

import { useEffect, useRef } from 'react';
import { readCreatorIntent, clearCreatorIntent } from '../lib/creatorIntent.js';
import { claimUpsellSlot, UPSELL_STACK_WINDOW_MS } from '../lib/upsellSlot.js';
import { logEvent } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';

// Let the board paint first: a modal over a blank canvas reads as the app
// failing to load, not as the thing you asked for.
const SETTLE_MS = 1500;

export function useCreatorIntentResume({ tier, ready, onResume }) {
  const settledRef = useRef(false);
  const resumeRef = useRef(onResume);
  resumeRef.current = onResume;

  useEffect(() => {
    if (!ready || settledRef.current) return undefined;
    if (!readCreatorIntent()) { settledRef.current = true; return undefined; }
    if (tier !== 'demo') {
      clearCreatorIntent();
      settledRef.current = true;
      return undefined;
    }

    let timer = null;
    const attempt = () => {
      // Re-read: another tab may already have shown it, or it may have expired.
      const intent = readCreatorIntent();
      if (!intent) { settledRef.current = true; return; }
      if (!claimUpsellSlot('pricing-intent')) {
        timer = setTimeout(attempt, UPSELL_STACK_WINDOW_MS);
        return;
      }
      settledRef.current = true;
      clearCreatorIntent();
      logEvent(EV.PRICING_INTENT_RESUMED, {
        plan: intent.plan, from: intent.from, age_s: Math.round(intent.ageMs / 1000),
      });
      resumeRef.current(intent.plan);
    };
    timer = setTimeout(attempt, SETTLE_MS);
    return () => { if (timer) clearTimeout(timer); };
  }, [ready, tier]);
}
