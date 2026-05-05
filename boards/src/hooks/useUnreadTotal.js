import { useMemo } from 'react';

// Sum unreadByKey from useChannelList. V1 doesn't separately track
// mention-only unread per row, so mentions is always 0; mention badges
// surface inline at the row level instead.
export function useUnreadTotal({ unreadByKey }) {
  return useMemo(() => {
    let total = 0;
    if (unreadByKey) for (const v of unreadByKey.values()) total += v ? 1 : 0;
    return { total, mentions: 0 };
  }, [unreadByKey]);
}
