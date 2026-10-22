// The notifications bell (placement C, owner's pick, 2026-10-21): a button in
// the board's right island after the theme switch (on a phone, in the top bar
// before Share), its number the unread count, and the list under it. Pure, so
// node --test can pin it: the count, the label, where the panel goes, when a
// phone sheet replaces it, and where a row leads.

export const PANEL_WIDTH = 340;
export const PANEL_GUTTER = 16;   // the panel never comes closer to a viewport edge
export const PANEL_GAP = 8;       // under the island's bottom edge
const PANEL_MIN_ROOM = 160;       // the least height it is pulled up to keep

// Ink, never a badge: nothing at 0, the number to 9, then 9+.
export function bellCountLabel(unread) {
  const n = Math.floor(Number(unread) || 0);
  if (n <= 0) return '';
  return n > 9 ? '9+' : String(n);
}

export function bellAriaLabel(unread) {
  const n = Math.floor(Number(unread) || 0);
  return n > 0 ? `Notifications, ${n} unread` : 'Notifications';
}

// {top, right} for a position:fixed panel: its right edge on the island's,
// its top PANEL_GAP under it. The island is the anchor, so the right edge
// follows it even though it sits nearer the edge than the gutter (10px); an
// island off the right edge falls back to the gutter, and the left and bottom
// edges keep PANEL_GUTTER clear of the viewport's.
export function placeUnderIsland(islandRect, viewport) {
  const vw = Number(viewport?.width) || 0;
  const vh = Number(viewport?.height) || 0;
  if (!islandRect) return { top: PANEL_GUTTER, right: PANEL_GUTTER };
  let right = Math.round(vw - islandRect.right);
  if (!(right >= 0)) right = PANEL_GUTTER;
  // The left edge stays inside the gutter.
  right = Math.max(0, Math.min(right, vw - PANEL_WIDTH - PANEL_GUTTER));
  let top = Math.round(islandRect.bottom + PANEL_GAP);
  top = Math.min(top, vh - PANEL_GUTTER - PANEL_MIN_ROOM);
  top = Math.max(top, PANEL_GUTTER);
  return { top, right };
}

// A phone shell, or a window too narrow for the panel and its two gutters.
export function wantsNotificationSheet({ mobileShell = false, viewportWidth = Infinity } = {}) {
  if (mobileShell) return true;
  return Number(viewportWidth) < PANEL_WIDTH + 2 * PANEL_GUTTER;
}

// Where a row leads:
//   { kind: 'file', token, inApp }            a file.* row with a link token
//   { kind: 'settings', tab, workspaceId }    an editor-limit row: Members
//   { kind: 'board', boardId }                anything else with a board
//   null                                      nothing to open
// fileShares / sharedFiles are the appHost holds, passed in so this stays pure.
export function notificationTarget(n, { fileShares = true, sharedFiles = true } = {}) {
  if (!n) return null;
  const kind = String(n.kind || '');
  if (kind.startsWith('file.') && n.data?.token && fileShares) {
    return { kind: 'file', token: n.data.token, inApp: !!sharedFiles };
  }
  if (kind === 'editors.limit_reached') {
    // public.notifications.workspace_id (0242) first, then the payload's.
    const workspaceId = n.workspace_id || n.data?.workspace_id || null;
    if (workspaceId) return { kind: 'settings', tab: 'members', workspaceId };
  }
  if (n.board_id) return { kind: 'board', boardId: n.board_id };
  return null;
}
