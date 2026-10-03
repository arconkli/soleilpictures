// useStarterIntentResume — write the document a page promised, once there is
// somewhere to write it.
//
// A signed-out "Start a treatment" (lib/starterIntent) is read back here once
// the signed-in app has a board this person can write, the SERVER's copy of
// that board is in (not just the instant cache paint, which can be a day old —
// the document is placed beside what is there), and a brand-new account's own
// first run has settled, so it does not land in the middle of the onboarding
// seed. The request is spent BEFORE the write: a refused card (the cap) or a
// crash must never write it twice on the next load.

import { useEffect, useRef } from 'react';
import { readStarterIntent, clearStarterIntent } from '../lib/starterIntent.js';

// Let the board paint first, as useCreatorIntentResume does.
const SETTLE_MS = 1200;

// Read-and-clear as ONE step across tabs. Signing in by the emailed link opens
// a second tab beside the one that asked for the code, and both load the app
// at once: with a plain read then clear, both could read the request before
// either cleared it, and the board would get two treatments. A Web Lock
// serialises the two; where the API is missing, read-then-clear is the
// fallback (the window is the few microseconds between the two calls).
export async function claimStarterIntent({ locks = (typeof navigator !== 'undefined' ? navigator.locks : null) } = {}) {
  const take = () => {
    const intent = readStarterIntent();
    if (intent) clearStarterIntent();
    return intent;
  };
  try {
    if (locks?.request) return await locks.request('soleil.starter-intent', take);
  } catch (_) { /* fall through to the unlocked claim */ }
  return take();
}

export function useStarterIntentResume({ ready, onResume }) {
  const doneRef = useRef(false);
  const resumeRef = useRef(onResume);
  resumeRef.current = onResume;

  useEffect(() => {
    if (!ready || doneRef.current) return undefined;
    if (!readStarterIntent()) { doneRef.current = true; return undefined; }
    let live = true;
    const t = setTimeout(() => {
      doneRef.current = true;
      claimStarterIntent().then((intent) => {
        if (intent && live) resumeRef.current(intent);
      });
    }, SETTLE_MS);
    return () => { live = false; clearTimeout(t); };
  }, [ready]);
}
