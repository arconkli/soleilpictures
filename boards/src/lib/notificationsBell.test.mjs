import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bellCountLabel, bellAriaLabel, placeUnderIsland, wantsNotificationSheet,
  notificationTarget, PANEL_WIDTH, PANEL_GUTTER, PANEL_GAP,
} from './notificationsBell.js';

test('the count: nothing at 0, the number to 9, then 9+', () => {
  assert.equal(bellCountLabel(0), '');
  assert.equal(bellCountLabel(null), '');
  assert.equal(bellCountLabel(-2), '');
  assert.equal(bellCountLabel(1), '1');
  assert.equal(bellCountLabel(9), '9');
  assert.equal(bellCountLabel(10), '9+');
  assert.equal(bellCountLabel(250), '9+');
});

test('the aria-label says how many are unread', () => {
  assert.equal(bellAriaLabel(0), 'Notifications');
  assert.equal(bellAriaLabel(1), 'Notifications, 1 unread');
  assert.equal(bellAriaLabel(14), 'Notifications, 14 unread');
});

test('the panel sits 8px under the island, right edges aligned', () => {
  const island = { top: 8, bottom: 44, left: 900, right: 1430 };
  assert.deepEqual(placeUnderIsland(island, { width: 1440, height: 900 }), { top: 44 + PANEL_GAP, right: 10 });
  assert.equal(PANEL_GAP, 8);
  assert.equal(PANEL_WIDTH, 340);
});

test('the panel never leaves the viewport', () => {
  // An island partly off the right edge: the 16px gutter.
  assert.equal(placeUnderIsland({ top: 8, bottom: 44, right: 1460 }, { width: 1440, height: 900 }).right, PANEL_GUTTER);
  // Folded sidebar or not, the island's own 10px edge is kept.
  assert.equal(placeUnderIsland({ top: 8, bottom: 44, right: 1430 }, { width: 1440, height: 900 }).right, 10);
  // An island far to the left: the panel's left edge stops at the gutter.
  const p = placeUnderIsland({ top: 8, bottom: 44, right: 200 }, { width: 1440, height: 900 });
  assert.equal(1440 - p.right - PANEL_WIDTH, PANEL_GUTTER);
  // Off the bottom: pulled up to leave room.
  assert.ok(placeUnderIsland({ top: 880, bottom: 950, right: 1400 }, { width: 1440, height: 900 }).top <= 900 - PANEL_GUTTER);
  // No island at all: the corner.
  assert.deepEqual(placeUnderIsland(null, { width: 1440, height: 900 }), { top: PANEL_GUTTER, right: PANEL_GUTTER });
});

test('a phone, or a window the panel does not fit, gets the sheet', () => {
  assert.equal(wantsNotificationSheet({ mobileShell: true, viewportWidth: 1200 }), true);
  assert.equal(wantsNotificationSheet({ mobileShell: false, viewportWidth: 1440 }), false);
  assert.equal(wantsNotificationSheet({ mobileShell: false, viewportWidth: PANEL_WIDTH + 2 * PANEL_GUTTER }), false);
  assert.equal(wantsNotificationSheet({ mobileShell: false, viewportWidth: PANEL_WIDTH + 2 * PANEL_GUTTER - 1 }), true);
});

test('a file.* row opens the file, in the app when the Shared page is on', () => {
  const n = { kind: 'file.shared', board_id: 'b1', data: { token: 'tok' } };
  assert.deepEqual(notificationTarget(n, { fileShares: true, sharedFiles: true }), { kind: 'file', token: 'tok', inApp: true });
  assert.deepEqual(notificationTarget(n, { fileShares: true, sharedFiles: false }), { kind: 'file', token: 'tok', inApp: false });
  assert.deepEqual(notificationTarget({ kind: 'file.commented', data: { token: 't2' } }), { kind: 'file', token: 't2', inApp: true });
  // File sharing off, or no token: the board, as any row.
  assert.deepEqual(notificationTarget(n, { fileShares: false }), { kind: 'board', boardId: 'b1' });
  assert.deepEqual(notificationTarget({ kind: 'file.shared', board_id: 'b1', data: {} }), { kind: 'board', boardId: 'b1' });
});

test('editors.limit_reached opens Settings at Members in its workspace, never the board', () => {
  assert.deepEqual(
    notificationTarget({ kind: 'editors.limit_reached', workspace_id: 'ws1', board_id: 'b1', data: { workspace_id: 'other' } }),
    { kind: 'settings', tab: 'members', workspaceId: 'ws1' });
  // The column first, then data.workspace_id.
  assert.deepEqual(
    notificationTarget({ kind: 'editors.limit_reached', workspace_id: null, board_id: 'b1', data: { workspace_id: 'ws2' } }),
    { kind: 'settings', tab: 'members', workspaceId: 'ws2' });
  // No workspace at all: the board, as before.
  assert.deepEqual(notificationTarget({ kind: 'editors.limit_reached', board_id: 'b1' }), { kind: 'board', boardId: 'b1' });
  assert.equal(notificationTarget({ kind: 'editors.limit_reached' }), null);
});

test('editors.joined_as_viewer and plain rows open their board', () => {
  assert.deepEqual(notificationTarget({ kind: 'editors.joined_as_viewer', workspace_id: 'ws1', board_id: 'b2' }), { kind: 'board', boardId: 'b2' });
  assert.deepEqual(notificationTarget({ kind: 'share.viewed', board_id: 'b3' }), { kind: 'board', boardId: 'b3' });
  assert.equal(notificationTarget({ kind: 'workspace.rewind' }), null);
  assert.equal(notificationTarget(null), null);
});
