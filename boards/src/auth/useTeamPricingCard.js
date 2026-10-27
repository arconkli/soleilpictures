// The Team card's state, for both pricing pages (PricingPage signed in,
// PublicPricingPage signed out): the seat picker and the hero's Team sentence,
// and the card's two presses (Start, and Talk to us's link), recorded here for both
// pages (`surface` says which). The sentence's price lives in the team model,
// loaded once the card shows. Null when the card is off.
import { useEffect, useState } from 'react';
import { EDITOR_LIMIT } from '../lib/editorLimit.js';
import { logEventNow } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';

export function useTeamPricingCard({ on, plan, onStart, surface }) {
  const [seats, setSeats] = useState(12);
  const [heroLine, setHeroLine] = useState(null);
  useEffect(() => {
    if (!on) return undefined;
    let live = true;
    import('../lib/teamModel.js').then((m) => { if (live) setHeroLine(m.teamHeroLine(EDITOR_LIMIT)); }, () => {});
    return () => { live = false; };
  }, [on]);
  if (!on) return null;
  return {
    plan,
    seats,
    setSeats,
    // Start leaves the page, so it beacons.
    onStart: () => { logEventNow(EV.PRICING_TEAM_START, { surface, plan, seats }); onStart(seats); },
    // Talk to us is a link to its own page, so it beacons too.
    onTalk: () => { logEventNow(EV.PRICING_TEAM_TALK, { surface }); },
    heroLine,
    editorLimit: EDITOR_LIMIT,
  };
}
