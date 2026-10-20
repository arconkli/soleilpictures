// Keep the screen from dimming and locking while `on` (the Screen Wake Lock
// API). A phone or a tablet that locks itself suspends the page, and with it
// whatever the page was doing — an import stops mid-file. The browser lets the
// lock go whenever the page is hidden, so it is taken again on coming back.
// Where the API is missing or refuses (low battery, a policy), nothing
// happens: the copy that asks people to keep the screen on still stands.
import { useEffect } from 'react';

export function useScreenAwake(on) {
  useEffect(() => {
    const wl = on && typeof navigator !== 'undefined' ? navigator.wakeLock : null;
    if (!wl?.request) return undefined;
    let held = null;
    let done = false;
    const take = async () => {
      if (done || document.visibilityState !== 'visible' || (held && !held.released)) return;
      try {
        const s = await wl.request('screen');
        if (done) s.release().catch(() => {});
        else held = s;
      } catch (_) { /* refused: it stays a request in words */ }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') take(); };
    take();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      done = true;
      document.removeEventListener('visibilitychange', onVisible);
      held?.release().catch(() => {});
    };
  }, [on]);
}
