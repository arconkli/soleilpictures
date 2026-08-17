// useAppTrace — the DOM half of lib/appTrace.js (which stays pure + node-testable).
//
// Arms the established-user trace ONLY in the gap the other two leave:
//
//   • signed in            — anonymous traffic is lp_trace's job
//   • no journey open      — a new user's first session is ps_trace's job, and
//                            double-recording would corrupt both
//   • not a public page    — /share, /c, /explore and the SEO pages are lp_trace's
//
// Those three conditions are checked live, not once: journey.js closes the
// journey the moment a new user activates, and this picks up from exactly there
// so the user's first session and their fiftieth are covered by one continuous
// record vocabulary.

import { useEffect } from 'react';
import { logEvent, logEventNow } from '../lib/analytics.js';
import { describeTarget, isJourneyOpen } from '../lib/journey.js';
import {
  setAppTraceSink, armAppTrace, disarmAppTrace, isAppTraceArmed,
  flushTrace, traceClick, traceKey, traceRoute, __TUNABLES,
} from '../lib/appTrace.js';

setAppTraceSink({ logEvent, logEventNow });

// Public surfaces own their own instrumentation (lp_trace). Matches the prefixes
// the router uses; '/' is deliberately absent because for a signed-in user it IS
// the app.
const PUBLIC_PREFIXES = ['/share', '/c/', '/explore', '/tools', '/vs', '/best', '/pricing', '/docs', '/scout', '/resume'];

function onPublicPage() {
  try {
    const p = location.pathname;
    return PUBLIC_PREFIXES.some((prefix) => p === prefix || p.startsWith(prefix));
  } catch (_) { return false; }
}

export function useAppTrace(enabled) {
  useEffect(() => {
    if (!enabled) return undefined;

    let flushTimer = null;

    // Re-evaluated on every event rather than captured once: a first-session
    // user activates mid-session, journey.js closes, and this takes over
    // without a reload.
    const eligible = () => enabled && !isJourneyOpen() && !onPublicPage();

    const sync = () => {
      if (eligible()) {
        if (!isAppTraceArmed()) armAppTrace();
      } else if (isAppTraceArmed()) {
        disarmAppTrace();
      }
    };

    const onClick = (e) => { sync(); if (isAppTraceArmed()) traceClick(e.target, describeTarget); };
    const onKey = (e) => {
      if (!isAppTraceArmed()) return;
      // Commands only. A modifier combo is never prose — no one writes with Cmd
      // held down — so this cannot capture what someone typed.
      if ((e.metaKey || e.ctrlKey) && e.key && e.key.length === 1) {
        const mods = (e.metaKey ? 'M' : '') + (e.ctrlKey ? 'C' : '') + (e.shiftKey ? 'S' : '') + (e.altKey ? 'A' : '');
        traceKey(e.key.toLowerCase(), mods + '-');
      }
    };
    const onRoute = () => { sync(); if (isAppTraceArmed()) traceRoute(location.pathname); };
    const onHide = () => { if (document.visibilityState === 'hidden') flushTrace(true); };
    const onPageHide = () => flushTrace(true);

    sync();

    const opts = { passive: true, capture: true };
    window.addEventListener('click', onClick, opts);
    window.addEventListener('keydown', onKey, opts);
    window.addEventListener('popstate', onRoute);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    flushTimer = setInterval(() => flushTrace(false), __TUNABLES.TRACE_FLUSH_MS);

    return () => {
      window.removeEventListener('click', onClick, { capture: true });
      window.removeEventListener('keydown', onKey, { capture: true });
      window.removeEventListener('popstate', onRoute);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      if (flushTimer) clearInterval(flushTimer);
      disarmAppTrace();
    };
  }, [enabled]);
}
