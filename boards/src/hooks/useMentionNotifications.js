// Unread @-mention notifications. Fired from the messages_fire_
// mention_notifications trigger (migration 0020) at INSERT time, so
// when someone @-mentions you in any board chat or DM, a row lands
// in mention_notifications with your user_id. We fetch on mount AND
// subscribe to postgres_changes (publication add in 0081) so new
// mentions surface live without a refresh.

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

  // Realtime: append new mention rows as they're inserted. The INSERT
  // payload IS the full row, so no follow-up fetch needed. Dedupe by id
  // in case the initial fetch and the realtime event race.
  useEffect(() => {
    if (!supabase || !userId) return;
    const ch = supabase.channel(`mentions:${userId}:${Math.random().toString(36).slice(2, 9)}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'mention_notifications',
        filter: `user_id=eq.${userId}`,
      }, (payload) => {
        const row = payload?.new;
        if (!row || row.dismissed_at) return;
        setUnread(arr => arr.some(n => n.id === row.id) ? arr : [...arr, row]);
      })
      .subscribe();
    return () => { try { supabase.removeChannel(ch); } catch (_) {} };
  }, [userId]);

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
