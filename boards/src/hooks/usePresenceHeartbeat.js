// usePresenceHeartbeat — keep public.user_presence.last_seen_at fresh
// so server-side triggers can skip "you missed something" emails when
// the user is actively in the app.
//
// Beats once on mount, once a minute while the tab is visible, and
// once on visibilitychange-to-visible. Stops beating when the tab is
// hidden so a buried tab decays past the 5-minute "online" window.

import { useEffect } from 'react';
import { supabase } from '../lib/supabase.js';

export function usePresenceHeartbeat(user) {
  useEffect(() => {
    if (!user || !supabase) return;
    let alive = true;
    const beat = async () => {
      if (!alive) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      // PostgrestBuilder is thenable but its .catch isn't always present
      // across supabase-js patch versions; awaiting inside try/catch is
      // the safe-everywhere form.
      try { await supabase.rpc('touch_presence'); } catch (_) {}
    };
    beat();
    const interval = setInterval(beat, 60_000);
    const onVis = () => beat();
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
    return () => {
      alive = false;
      clearInterval(interval);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
    };
  }, [user]);
}
