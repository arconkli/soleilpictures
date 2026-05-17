import { useMemo } from 'react';

// Sum unreadByConv from useConversationList. V1 doesn't separately
// track mention-only unread per row, so mentions is always 0; mention
// badges surface inline at the row level instead.
export function useUnreadTotal({ unreadByConv }) {
  return useMemo(() => {
    let total = 0;
    if (unreadByConv) for (const v of unreadByConv.values()) total += v ? 1 : 0;
    return { total, mentions: 0 };
  }, [unreadByConv]);
}
