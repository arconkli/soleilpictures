// Subscribes to the per-user broadcast topic `user:{userId}` and fans
// each inbox-ping payload out to three surfaces:
//
//   1. inboxBus  — so the conversation list + unread badge can bump
//                  optimistically without a refetch round-trip
//   2. feedback.toast — in-app banner with an "Open" action (suppressed
//                  when the message lands in the currently-open thread)
//   3. browser Notifications API — when the tab isn't visible
//
// Mounted once near the top of the app. A single Supabase channel for
// `user:{uid}` covers every reader.

import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase.js';
import { publishInbox } from '../lib/inboxBus.js';
import { maybeShowNotification } from '../lib/browserNotifications.js';
import * as userProfiles from '../lib/userProfiles.js';

export function useInboxLive({ userId, openConversationId, onOpenConversation, feedback }) {
  // Use refs for the moving parts so we don't re-subscribe on every
  // parent re-render (the channel and its handler close over fresh
  // values via the refs).
  const openConvRef = useRef(openConversationId);
  const onOpenRef = useRef(onOpenConversation);
  const feedbackRef = useRef(feedback);
  useEffect(() => { openConvRef.current = openConversationId; }, [openConversationId]);
  useEffect(() => { onOpenRef.current = onOpenConversation; }, [onOpenConversation]);
  useEffect(() => { feedbackRef.current = feedback; }, [feedback]);

  useEffect(() => {
    if (!supabase || !userId) return;

    const handle = (payload) => {
      if (!payload || !payload.conversation_id) return;

      // Always publish so the inbox list / unread badge can react.
      publishInbox(userId, payload);

      // Suppress in-app toast + OS notification when the user is
      // already looking at this thread — the conv:{id} channel
      // handles that surface.
      if (payload.conversation_id === openConvRef.current) return;

      // Warm the profile cache so the name renders on the next paint.
      try { userProfiles.resolve(payload.sender_id); } catch (_) {}
      const senderName = userProfiles.getName(payload.sender_id, payload.sender_email || 'New message');
      const mentionsMe = Array.isArray(payload.mentions) && payload.mentions.includes(userId);
      const preview = payload.body_preview
        || (payload.has_attachments ? '📎 Attachment' : '');
      const message = mentionsMe
        ? `${senderName} mentioned you${preview ? `: ${preview}` : ''}`
        : (preview ? `${senderName}: ${preview}` : senderName);

      const openIt = () => {
        try { onOpenRef.current?.(payload.conversation_id); } catch (e) { console.warn('[inbox-live] open threw', e); }
      };

      try {
        feedbackRef.current?.toast({
          type: mentionsMe ? 'info' : 'info',
          message,
          ttl: 6000,
          action: { label: 'Open', onClick: openIt },
        });
      } catch (e) { console.warn('[inbox-live] toast failed', e); }

      maybeShowNotification({
        title: mentionsMe ? `${senderName} mentioned you` : senderName,
        body: preview,
        tag: payload.conversation_id,
        onClick: openIt,
      });
    };

    // Topic name must match the server-side realtime.send() exactly —
    // `user:{uid}` — so the RLS policy (substring(topic from 6)::uuid
    // = auth.uid()) gates it correctly. Supabase v2 dedupes channels
    // by topic, so an HMR re-mount reuses the existing channel.
    const topic = `user:${userId}`;
    const ch = supabase.channel(topic, { config: { private: true, broadcast: { self: false } } });
    ch.on('broadcast', { event: 'inbox-ping' }, ({ payload }) => handle(payload));
    ch.subscribe((status, err) => {
      if (status === 'CHANNEL_ERROR' || err) {
        console.warn('[inbox-live] subscribe error', { topic, status, err });
      }
    });

    return () => { try { supabase.removeChannel(ch); } catch (_) {} };
  }, [userId]);
}
