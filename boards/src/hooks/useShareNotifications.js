// Unread share notifications for the current user. The recipient
// shape is:
//   { id, board_id, role, shared_by, created_at, kind, detail }
//
// kind (migration 0171): 'share' (someone shared a board) | 'explore_approved'
// (your board went public, detail = slug) | 'explore_rejected' (detail = reason).
//
// Fetched once on mount + on userId change. Consumers call dismiss(id)
// after surfacing a notification (e.g. inside a toast click handler).

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

export function useShareNotifications(userId) {
  const [unread, setUnread] = useState([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!userId) { setUnread([]); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('share_notifications')
        .select('id, board_id, role, shared_by, created_at, kind, detail')
        .eq('user_id', userId)
        .is('dismissed_at', null)
        .order('created_at', { ascending: true });
      if (error) throw error;
      setUnread(data || []);
    } catch (e) {
      console.warn('[share-notif] fetch failed', e);
      setUnread([]);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Mark a single notification dismissed (locally + DB).
  const dismiss = useCallback(async (id) => {
    setUnread(arr => arr.filter(n => n.id !== id));
    try {
      await supabase
        .from('share_notifications')
        .update({ dismissed_at: new Date().toISOString() })
        .eq('id', id);
    } catch (e) {
      console.warn('[share-notif] dismiss failed', e);
    }
  }, []);

  // Mark all dismissed (used after the toast batch fires on mount so
  // the user doesn't get re-toasted on the next page load).
  const dismissAll = useCallback(async () => {
    const ids = unread.map(n => n.id);
    if (ids.length === 0) return;
    setUnread([]);
    try {
      await supabase
        .from('share_notifications')
        .update({ dismissed_at: new Date().toISOString() })
        .in('id', ids);
    } catch (e) {
      console.warn('[share-notif] dismissAll failed', e);
    }
  }, [unread]);

  return { unread, loading, refresh, dismiss, dismissAll };
}
