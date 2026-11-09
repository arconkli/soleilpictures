// One clock for the screens that say "still loading". The page's own boot
// splash, AuthGate's SplashLoading, TierRouter's Splash and the workspace
// LoadingShell hand over to each other with no visible change, so the words
// count from the start of the whole wait, not from each screen's own mount.

// 0 = nothing, 1 = "Still loading…", 2 = "taking longer" + Reload.
export function stallStage(elapsedMs, steps = [8000, 15000]) {
  let stage = 0;
  for (let i = 0; i < steps.length; i++) if (elapsedMs >= steps[i]) stage = i + 1;
  return stage;
}

// Where the wait began, in performance.now() terms.
//  - the page's own splash still in the DOM: the page's start (0)
//  - another such screen mounted, or the last one gone under `gapMs` ago: its start
//  - otherwise: now
export function stallStart({ bootSplashPresent, live, now, endedAt, sharedStart, gapMs = 1000 }) {
  if (bootSplashPresent) return 0;
  if (sharedStart != null && (live > 0 || (endedAt != null && now - endedAt < gapMs))) return sharedStart;
  return now;
}
