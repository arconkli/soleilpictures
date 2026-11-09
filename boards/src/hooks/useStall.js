// Which stage of "still loading" a boot screen is in (see lib/stall.js). The
// start of the wait is decided once, on first render, and shared by the boot
// screens that follow one another.

import { useEffect, useState } from 'react';
import { stallStage, stallStart } from '../lib/stall.js';

const shared = { start: null, live: 0, endedAt: null };
const DEFAULT_STEPS = [8000, 15000];

export function useStall({ steps = DEFAULT_STEPS, force } = {}) {
  const [start] = useState(() => {
    const s = stallStart({
      bootSplashPresent: typeof document !== 'undefined' && !!document.getElementById('boot-splash'),
      live: shared.live,
      now: performance.now(),
      endedAt: shared.endedAt,
      sharedStart: shared.start,
    });
    shared.start = s;
    return s;
  });
  const [stage, setStage] = useState(() => stallStage(performance.now() - start, steps));
  const key = steps.join(',');

  useEffect(() => {
    shared.live += 1;
    return () => {
      shared.live -= 1;
      shared.endedAt = performance.now();
    };
  }, []);

  useEffect(() => {
    const timers = [];
    const elapsed = performance.now() - start;
    setStage(stallStage(elapsed, steps));
    steps.forEach((ms, i) => {
      if (elapsed < ms) timers.push(setTimeout(() => setStage(i + 1), ms - elapsed));
    });
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, key]);

  return typeof force === 'number' ? force : stage;
}
