// The bell: persistent notifications.
//
// Reads public.notifications (0242), which unlike share_notifications and
// mention_notifications is NOT a toast queue — rows survive until read, so
// someone who missed the toast for a file shared with them still finds it
// later. It also read the caller's upcoming schedule until schedules were
// retired (owner, 2026-10-20).
//
// Live updates arrive through notificationBus rather than a Supabase channel of
// our own: notification pings share the `user:{uid}` topic useInboxLive already
// owns, and opening a second channel on that topic would throw (v2 dedupes by
// topic and .on() after subscribe is an error).

import { useCallback, useEffect, useRef, useState } from 'react';
import { listNotifications, markNotificationsRead } from '../lib/boardsApi.js';
import { subscribeNotifications } from '../lib/notificationBus.js';
import { maybeShowNotification } from '../lib/browserNotifications.js';
import { fileSharesAllowed, sharedFilesAllowed } from '../lib/appHost.js';
// A line of its own: fileShareWiring.test.mjs pins the one above as it is.
import { editorLimitAllowed } from '../lib/appHost.js';
import { openSharedFile } from '../lib/sharedFileBus.js';
import { notificationTarget, mergeNotice, shouldToastNotice, noteNoticeToast, fileCommentQuery } from '../lib/notificationsBell.js';
import { isThreadOpen } from '../lib/openThreads.js';
import { notificationText } from '../lib/notificationWords.js';
import { refreshMyTier } from './useMyTier.js';
import { missedJoinedAsViewer } from '../lib/editorLimit.js';
import { noticeToastText } from '../lib/editorLimitWords.js';
import { logEvent } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { t } from '@lingui/core/macro';

// Notices already toasted on this page, by id: realtime can deliver a ping
// twice, and the first load's look for missed ones can reach the same row.
const toasted = new Set();
// …and when each conversation last toasted (lib/notificationsBell.js
// shouldToastNotice): a comment notice's row folds, so its id says nothing.
const threadToastAt = new Map();

// onOpenComment(target): a comment notice's Open (notificationTarget's
// { kind: 'comment', … }). boardNameOf(id): a cluster's name, for the words
// of a comment notice in another language.
export function useNotifications({
  userId, feedback = null, onOpenBoard = null, onOpenSettings = null, onOpenTeam = null, onOpenComment = null,
  nameOf = null, boardNameOf = null,
} = {}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const onOpenRef = useRef(onOpenBoard);
  const onSettingsRef = useRef(onOpenSettings);
  const onTeamRef = useRef(onOpenTeam);
  const onCommentRef = useRef(onOpenComment);
  const feedbackRef = useRef(feedback);
  const nameOfRef = useRef(nameOf);
  const boardNameOfRef = useRef(boardNameOf);
  const sweptFor = useRef(null);   // the userId whose first load was looked through
  useEffect(() => { onOpenRef.current = onOpenBoard; }, [onOpenBoard]);
  useEffect(() => { onSettingsRef.current = onOpenSettings; }, [onOpenSettings]);
  useEffect(() => { onTeamRef.current = onOpenTeam; }, [onOpenTeam]);
  useEffect(() => { onCommentRef.current = onOpenComment; }, [onOpenComment]);
  useEffect(() => { feedbackRef.current = feedback; }, [feedback]);
  useEffect(() => { nameOfRef.current = nameOf; }, [nameOf]);
  useEffect(() => { boardNameOfRef.current = boardNameOf; }, [boardNameOf]);
  // The row as the person reads it: the stored English, or its words in their language.
  const worded = useCallback((n) => ({ ...n, ...notificationText(n, { nameOf: nameOfRef.current, boardNameOf: boardNameOfRef.current }) }), []);

  // Optimistic: the badge should clear on click, not after a round trip. A
  // failed write reconciles on the next refresh rather than bouncing the UI.
  const markRead = useCallback(async (ids = null) => {
    const stamp = new Date().toISOString();
    setItems((prev) => prev.map((x) => (
      (!ids || ids.includes(x.id)) && !x.read_at ? { ...x, read_at: stamp } : x
    )));
    try { await markNotificationsRead(ids); } catch (e) { console.warn('[notifications] mark read failed', e); }
  }, []);

  const refresh = useCallback(async () => {
    if (!userId) { setItems([]); return; }
    setLoading(true);
    try {
      const rows = await listNotifications({ limit: 50 });
      setItems(rows);
      // An edit link is claimed before the app subscribes to its pings, so
      // the notice that it let someone in as a viewer (0520) lands before
      // anyone listens. The first load shows the newest one missed, once.
      if (sweptFor.current !== userId) {
        sweptFor.current = userId;
        if (editorLimitAllowed()) {
          const missed = missedJoinedAsViewer(rows, { toasted });
          if (missed.length) {
            for (const n of missed) toasted.add(n.id);
            try { feedbackRef.current?.toast({ type: 'info', message: noticeToastText(worded(missed[0])), ttl: 12000 }); } catch (_) {}
            markRead(missed.map((n) => n.id));
          }
        }
      }
    } catch (e) {
      console.warn('[notifications] list failed', e);
    } finally {
      setLoading(false);
    }
  }, [userId, markRead, worded]);

  useEffect(() => { refresh(); }, [refresh]);

  // Live pings: into the list optimistically so the badge moves on the same
  // frame. One rule for every kind (lib/notificationsBell.js mergeNotice): a
  // payload whose id is already listed replaces that row and moves it to the
  // top, keeping its read_at. That is a ping realtime delivered twice (the
  // same words again), a notice that counts up and is sent again on its own
  // id with the new words and time (team.joined, 0897), or a burst on one
  // conversation folding into the person's row (the comment notices).
  useEffect(() => {
    if (!userId) return undefined;
    return subscribeNotifications(userId, (payload) => {
      setItems((prev) => mergeNotice(prev, payload));
      // Once per id; a comment notice once per conversation every two
      // minutes, and never while that conversation is open on screen.
      const memory = { toastedIds: toasted, lastByThread: threadToastAt, now: Date.now(), threadOpen: isThreadOpen };
      if (!shouldToastNotice(payload, memory)) return;
      noteNoticeToast(payload, memory);
      // An invite reward is quiet: the bell's dot carries it, and the app's own
      // reward toast (App.jsx, when the bonus grows) stays the one pop-up. The
      // tier is re-read now, so that toast and the higher card limit don't wait
      // for the next focus.
      if (payload.kind === 'invite.reward') { refreshMyTier(); return; }
      const fileToken = fileSharesAllowed() && String(payload.kind || '').startsWith('file.') ? payload.data?.token : null;
      // An editor-limit notice opens Settings › Members in its workspace; a
      // comment notice opens its conversation, not just the cluster.
      const target = notificationTarget(payload);
      const fileComment = target?.kind === 'file' ? target.commentId : null;
      const openIt = () => {
        try {
          if (target?.kind === 'comment' && onCommentRef.current) onCommentRef.current(target);
          else onOpenRef.current?.(payload.board_id);
        } catch (_) {}
      };
      const openSettings = target?.kind === 'settings'
        ? () => {
            try { logEvent(EV.EDITOR_LIMIT_NOTICE_OPEN, { via: 'toast' }); } catch (_) {}
            try { onSettingsRef.current?.(target.tab, target.workspaceId); } catch (_) {}
          }
        : null;
      // A team notice opens that team's page on the tab it is about.
      const openTeam = target?.kind === 'team'
        ? () => { try { onTeamRef.current?.(target.tab, target.orgId); } catch (_) {} }
        : null;
      try {
        feedbackRef.current?.toast({
          type: 'info',
          message: noticeToastText(worded(payload)),
          ttl: 8000,
          action: fileToken
            ? { label: t`Open`, onClick: () => (sharedFilesAllowed()
                ? openSharedFile({ token: fileToken, via: 'toast', commentId: fileComment })
                : window.open('/f/' + encodeURIComponent(fileToken) + fileCommentQuery(fileComment), '_blank', 'noopener')) }
            : openSettings ? { label: t`See who can edit`, onClick: openSettings }
              : openTeam ? { label: t`Open`, onClick: openTeam }
                : (payload.board_id ? { label: t`Open`, onClick: openIt } : undefined),
        });
      } catch (_) {}
      // Only fires when the tab is hidden/unfocused and permission was granted.
      // The tag is the row's id, so a fold takes the earlier notice's place.
      const shown = worded(payload);
      maybeShowNotification({ title: shown.title, body: shown.body || '', tag: `ntf:${payload.id}`, onClick: openTeam || openIt });
    });
  }, [userId, worded]);

  const unread = items.reduce((n, x) => n + (x.read_at ? 0 : 1), 0);

  return { items, unread, loading, refresh, markRead };
}
