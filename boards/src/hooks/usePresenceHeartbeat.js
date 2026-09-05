// usePresenceHeartbeat — keep public.user_presence.last_seen_at fresh
// so server-side triggers can skip "you missed something" emails when
// the user is actively in the app.
//
// Beats once on mount, every four minutes while the tab is visible, and
// once on visibilitychange-to-visible. Stops beating when the tab is
// hidden so a buried tab decays past the 5-minute "online" window.
//
// Four minutes rather than one: this is a WRITE per tab per minute, so it
// dirties a buffer and adds to the WAL the checkpointer then has to flush.
// It only has to land inside the 5-minute window it feeds, and the
// visibilitychange beat covers the case that matters (someone coming back).

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
    const interval = setInterval(beat, 240_000);
    const onVis = () => beat();
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
    return () => {
      alive = false;
      clearInterval(interval);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
    };
  }, [user]);
}
