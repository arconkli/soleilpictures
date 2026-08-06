// Notification side-channel for inline comment threads.
//
// The threads themselves live in Yjs (docState's `docComments`), which is the
// right home — the anchor is a CommentMark inside the fragment, so ranges
// survive concurrent edits for free. But Yjs reaches only the peers who happen
// to have the board open, so an @-mention in a comment needs one server touch
// to reach someone who's away.
//
// Rather than invent a parallel notification table, this writes into the
// EXISTING mention_notifications pipeline (migration 0020, extended by 0207):
//   • hooks/useMentionNotifications.js already fetches + realtime-subscribes to
//     that table, so the in-app notification needs no client changes;
//   • the AFTER INSERT trigger from 0075 sends `mention_email`, already gated
//     on _is_user_online() and the per-user `email_mentions` preference.
//
// Writes go through a SECURITY DEFINER RPC, never a direct insert: the table's
// own insert policy is `auth.uid() is not null`, i.e. anyone could notify
// anyone. The RPC checks can_read_board() for BOTH the caller and every
// recipient.
//
// Fire-and-forget by design. The comment is already committed to the CRDT
// before this runs, so a failed notification must never surface as a failed
// comment — it's logged and dropped.

import { supabase } from './supabase.js';

export async function notifyCommentMentions({
  workspaceId, boardId, cardId = null, threadId = null, userIds = [], preview = '',
}) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length || !workspaceId || !boardId || !supabase) return 0;
  try {
    const { data, error } = await supabase.rpc('notify_comment_mention', {
      p_workspace_id: workspaceId,
      p_board_id: boardId,
      p_card_id: cardId,
      p_thread_id: threadId,
      p_user_ids: ids,
      p_preview: String(preview || '').slice(0, 280),
    });
    if (error) throw error;
    return data || 0;
  } catch (e) {
    console.warn('[comment-mentions] notify failed', e);
    return 0;
  }
}
