// The Team card's state, for both pricing pages (PricingPage signed in,
// PublicPricingPage signed out): the seat picker, the "Talk to us" note and
// the hero's Team sentence. The sentence's price lives in the team model,
// loaded only while the card shows (it shares a chunk with the card), so the
// pricing pages never import it. Null when the card is off.
import { useEffect, useState } from 'react';
import { EDITOR_LIMIT } from '../lib/editorLimit.js';

export function useTeamPricingCard({ on, plan, onStart }) {
  const [seats, setSeats] = useState(12);
  const [talkNote, setTalkNote] = useState(false);
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
    onStart: () => onStart(seats),
    talkNote,
    onTalk: () => setTalkNote(true),
    heroLine,
    editorLimit: EDITOR_LIMIT,
  };
}
