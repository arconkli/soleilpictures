// useStarterIntentResume — write the document a page promised, once there is
// somewhere to write it.
//
// A signed-out "Start a treatment" (lib/starterIntent) is read back here once
// the signed-in app has a board this person can write and a brand-new
// account's own first run has settled, so the document does not land in the
// middle of the onboarding seed. The request is spent BEFORE the write: a
// refused card (the cap) or a crash must never write it twice on the next load.

import { useEffect, useRef } from 'react';
import { readStarterIntent, clearStarterIntent } from '../lib/starterIntent.js';

// Let the board paint first, as useCreatorIntentResume does.
const SETTLE_MS = 1200;

export function useStarterIntentResume({ ready, onResume }) {
  const doneRef = useRef(false);
  const resumeRef = useRef(onResume);
  resumeRef.current = onResume;

  useEffect(() => {
    if (!ready || doneRef.current) return undefined;
    if (!readStarterIntent()) { doneRef.current = true; return undefined; }
    const t = setTimeout(() => {
      // Re-read: another tab may have used it, or it may have expired.
      const intent = readStarterIntent();
      doneRef.current = true;
      if (!intent) return;
      clearStarterIntent();
      resumeRef.current(intent);
    }, SETTLE_MS);
    return () => clearTimeout(t);
  }, [ready]);
}
