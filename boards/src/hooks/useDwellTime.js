import { useEffect, useRef } from 'react';
import { logEvent } from '../lib/analytics.js';

// useDwellTime — logs `<eventName> { ms, ...getExtra() }` exactly once, on
// whichever comes first: unmount (SPA route change) or the tab being hidden /
// unloaded. getExtra() is read at FIRE time so callers can attach late state
// (status, outcome, max_depth) captured when the user actually leaves.
//
// StrictMode note: in dev the double mount/unmount produces one extra ~0ms
// dwell on the throwaway mount — acceptable dev-only noise; prod doesn't
// double-invoke.
export function useDwellTime(eventName, getExtra) {
  const extraRef = useRef(getExtra);
  extraRef.current = getExtra;

  useEffect(() => {
    if (!eventName) return undefined;
    const startedAt = Date.now();
    let fired = false;
    const fire = () => {
      if (fired) return;
      fired = true;
      const ms = Date.now() - startedAt;
      let extra = {};
      try { extra = extraRef.current?.() || {}; } catch (_) {}
      try { logEvent(eventName, { ms, ...extra }); } catch (_) {}
    };
    const onHide = () => { if (document.visibilityState === 'hidden') fire(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', fire);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', fire);
      fire();   // unmount (in-SPA navigation)
    };
  }, [eventName]);
}
