// The unread share_notifications read behind useShareNotifications, apart from
// the hook so node can test it against a fake client.
//
// `scope` came with 0452. The app and that migration don't land at the same
// moment (main serves the preview off the same database production uses, and
// a promote applies its migrations by hand), and a select naming a column the
// table doesn't have fails the whole read (42703), which would show nobody a
// share toast at all. So a read that hits that error asks again with the
// columns it had before, and stops asking for scope for the rest of the page's
// life; with no scope a 'joined' row reads as the board join it was.

export const SHARE_NOTIFICATION_COLUMNS = 'id, board_id, role, shared_by, created_at, kind, detail';

let scopeMissing = false;

export async function readUnreadShareNotifications(client, userId) {
  const read = (cols) => client
    .from('share_notifications')
    .select(cols)
    .eq('user_id', userId)
    .is('dismissed_at', null)
    .order('created_at', { ascending: true });
  if (!scopeMissing) {
    const res = await read(`${SHARE_NOTIFICATION_COLUMNS}, scope`);
    if (res?.error?.code !== '42703') return res;
    scopeMissing = true;
  }
  return read(SHARE_NOTIFICATION_COLUMNS);
}

export function _resetScopeProbeForTests() { scopeMissing = false; }
