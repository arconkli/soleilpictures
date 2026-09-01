// ReturnReasonAsk — the one question the product has never asked anyone.
//
// public.feedback has RLS enabled and no policies, so it has been admin-read
// only for its entire life and there has never been a write path from the app.
// Across the whole user base it holds a single row. Every other thing we know
// about why people leave is inferred from behaviour, and behaviour cannot say
// why somebody decided this was not for them.
//
// WHY THIS QUESTION, ASKED OF THESE PEOPLE. The product loses almost everyone
// at one step — between the first visit and the second — and there is no honest
// way to ask someone who has already gone. But roughly a third do come back,
// and nobody has ever asked them what brought them. Whatever pulls that third
// in is the only lever we have evidence for, and it is invisible in telemetry:
// the app cannot tell "I remembered I had photos to sort" from "a colleague
// asked me". So the question goes to people who are demonstrably willing, at a
// moment they have already chosen to be here.
//
// WHAT KEEPS IT FROM BEING A NAG:
//   • never on a first session — it fires only on a return
//   • a delay, so it is not the thing that greets you at the door
//   • once per account, EVER — enforced on the server, so clearing local
//     storage cannot reopen it, and a dismissal is remembered too
//   • routed through the shared upsell slot, so it can never stack on the cap
//     wall, the share ask or the mix prompt
//   • one tap answers it; the free-text line is optional and never focused
//
// No celebration on the way out. It closes.

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { logEvent, logEventNow } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { claimUpsellSlot } from '../lib/upsellSlot.js';

// Long enough that it reads as "while you're here" rather than as a toll booth
// on the door. They have already decided to come back; the question can wait.
const DELAY_MS = 45_000;

// If another ambient surface owns the slot when the timer fires, wait and try
// again rather than dropping the question. UPSELL_STACK_WINDOW_MS is 60s, so
// this clears a single occupant.
const RETRY_MS = 70_000;
const RETRIES = 2;

const ASKED_KEY = 'soleil.returnreason.v1';

// The closed list the server also enforces. Phrased as reasons a person would
// recognise, not as categories an analyst would invent.
const CHOICES = [
  { id: 'unfinished',    label: 'I had something unfinished' },
  { id: 'new_material',  label: 'I had new material to add' },
  { id: 'reminded',      label: 'Something reminded me' },
  { id: 'someone_asked', label: 'Someone else asked me to look' },
  { id: 'looking',       label: 'Just having another look' },
];

function alreadyHandled() {
  try { return !!localStorage.getItem(ASKED_KEY); } catch (_) { return false; }
}
function markHandled(how) {
  try { localStorage.setItem(ASKED_KEY, how); } catch (_) { /* private mode */ }
}

export function ReturnReasonAsk() {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const daysRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    if (alreadyHandled()) return undefined;

    let tries = 0;
    const arm = (delay) => {
      timerRef.current = setTimeout(() => {
        if (alreadyHandled()) return;
        // Claimed late, at show time rather than at trigger time: whether some
        // other surface owns the moment is only knowable when the moment
        // arrives, not forty-five seconds earlier.
        //
        // Losing the claim must not lose the question. This is asked once per
        // account for good, so a surface that happens to be up at the moment
        // the timer fires would otherwise silently cost that account its only
        // chance to answer. Retried a couple of times, then dropped for the
        // session rather than looped.
        if (!claimUpsellSlot('return-reason')) {
          tries += 1;
          if (tries <= RETRIES) arm(RETRY_MS);
          return;
        }
        setOpen(true);
        try { logEvent(EV.RETURN_REASON_SHOWN, { days_since_last_seen: daysRef.current }); } catch (_) {}
      }, delay);
    };

    const onReturned = (e) => {
      if (alreadyHandled() || timerRef.current) return;
      daysRef.current = Number(e?.detail?.days) || null;
      arm(DELAY_MS);
    };

    window.addEventListener('soleil:returned', onReturned);
    return () => {
      window.removeEventListener('soleil:returned', onReturned);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (!open) return null;

  const answer = async (choice) => {
    if (busy) return;
    setBusy(true);
    // Marked before the round-trip: if the network fails we still do not ask
    // again. A lost answer is a smaller cost than a repeated question.
    markHandled('answered');
    try {
      logEventNow(EV.RETURN_REASON_ANSWERED, {
        choice, has_note: !!note.trim(), days_since_last_seen: daysRef.current,
      });
    } catch (_) {}
    try {
      await supabase.rpc('submit_return_reason', { p_choice: choice, p_note: note.trim() || null });
    } catch (_) { /* the answer is gone; the question stays answered */ }
    setOpen(false);
  };

  const dismiss = () => {
    markHandled('dismissed');
    try { logEvent(EV.RETURN_REASON_DISMISSED, { days_since_last_seen: daysRef.current }); } catch (_) {}
    setOpen(false);
  };

  return (
    <div className="fv-banner surface-frosted rr-ask" role="dialog" aria-label="One question">
      <div className="fv-banner-copy">
        <div className="fv-banner-title">What brought you back?</div>
        <div className="fv-banner-body">
          One tap, and we stop asking. It genuinely shapes what gets built next.
        </div>
        <div className="rr-choices">
          {CHOICES.map((c) => (
            <button
              key={c.id}
              type="button"
              className="rr-chip"
              disabled={busy}
              onClick={() => answer(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
        <input
          className="rr-note"
          type="text"
          value={note}
          maxLength={500}
          disabled={busy}
          placeholder="Anything else? (optional)"
          onChange={(e) => setNote(e.target.value)}
          aria-label="Anything else, optional"
        />
      </div>
      <div className="fv-banner-actions">
        <button className="fv-banner-dismiss" onClick={dismiss} disabled={busy}>No thanks</button>
      </div>
    </div>
  );
}
