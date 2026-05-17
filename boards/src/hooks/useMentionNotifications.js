// Unread @-mention notifications. Fired from the messages_fire_
// mention_notifications trigger (migration 0020) at INSERT time, so
// when someone @-mentions you in any board chat or DM, a row lands
// in mention_notifications with your user_id. We fetch on mount,
// surface as toasts, and dismiss after the batch.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

export function useMentionNotifications(userId) {
  const [unread, setUnread] = useState([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!userId) { setUnread([]); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('mention_notifications')
        .select('id, message_id, workspace_id, conversation_id, mentioned_by, created_at')
        .eq('user_id', userId)
        .is('dismissed_at', null)
        .order('created_at', { ascending: true });
      if (error) throw error;
      setUnread(data || []);
    } catch (e) {
      console.warn('[mention-notif] fetch failed', e);
      setUnread([]);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { refresh(); }, [refresh]);

  const dismiss = useCallback(async (id) => {
    setUnread(arr => arr.filter(n => n.id !== id));
    try {
      await supabase.from('mention_notifications')
        .update({ dismissed_at: new Date().toISOString() })
        .eq('id', id);
    } catch (e) { console.warn('[mention-notif] dismiss failed', e); }
  }, []);

  const dismissAll = useCallback(async () => {
    const ids = unread.map(n => n.id);
    if (ids.length === 0) return;
    setUnread([]);
    try {
      await supabase.from('mention_notifications')
        .update({ dismissed_at: new Date().toISOString() })
        .in('id', ids);
    } catch (e) { console.warn('[mention-notif] dismissAll failed', e); }
  }, [unread]);

  return { unread, loading, refresh, dismiss, dismissAll };
}
