// Source pins for the notifications bell (placement C): where App puts it,
// what opening it logs, and how the panel routes a row. Reads source text only
// (the components import JSX and CSS, which node --test cannot load).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const app = src('../App.jsx');

// The right island: from `right={(` to its menuItems.
function rightIsland() {
  const at = app.indexOf('right={(\n              <>');
  assert.ok(at > 0, 'the right island is found');
  return app.slice(at, app.indexOf('menuItems={[', at));
}

test('App imports the bell', () => {
  assert.match(app, /import \{ NotificationsBell \} from '\.\/components\/NotificationsBell\.jsx'/);
});

test('in the right island the bell follows Toggle theme, or Search under a finger', () => {
  const r = rightIsland();
  // Search, then: with a mouse the theme and the bell, under a finger the bell.
  assert.match(r, /aria-label="Search"[\s\S]*?<\/button>\s*(\{\/\*[\s\S]*?\*\/\}\s*)?\{!isTouch \? \(\s*<>\s*<button className="tb-icon tb-icon-theme"/);
  assert.match(r, /aria-label="Toggle theme"[\s\S]*?<\/button>\s*\{notifBell\}\s*<\/>\s*\) : notifBell\}\s*<span className="chrome-sep"/);
  assert.equal((r.match(/notifBell/g) || []).length, 2);
});

test('in the classic top bar the bell comes right before Share', () => {
  const at = app.indexOf('<div className="tb-right">');
  assert.ok(at > 0);
  const bar = app.slice(at, app.indexOf('tb-icon-split', at));
  assert.match(bar, /\{notifBell\}\s*<button className="tb-btn tb-share"/);
});

test('one bell element, logging NOTIF_OPEN on open only, toggling the panel', () => {
  const at = app.indexOf('const notifBell = (');
  assert.ok(at > 0);
  const el = app.slice(at, app.indexOf('/>\n  );', at));
  assert.match(el, /<NotificationsBell/);
  assert.match(el, /unread=\{notifications\.unread\}/);
  assert.match(el, /open=\{notifOpen\}/);
  assert.match(el, /ref=\{notifBellRef\}/);
  assert.match(el, /if \(!notifOpen\) \{\s*try \{ logEvent\(EV\.NOTIF_OPEN, \{ unread: notifications\.unread \|\| 0 \}\); \} catch \(_\) \{\}\s*\}\s*setNotifOpen\(v => !v\);/);
});

test('the panel is anchored to the bell, phone-aware, and routes Settings rows', () => {
  const at = app.indexOf('{notifOpen && createPortal((');
  const p = app.slice(at, app.indexOf('), document.body)}', at));
  assert.match(p, /anchorRef=\{notifBellRef\}/);
  assert.match(p, /mobileShell=\{mobileShell\}/);
  assert.match(p, /onOpenSettings=\{openNotificationSettings\}/);
  const f = app.slice(app.indexOf('const openNotificationSettings = '), app.indexOf('const openNotificationSettings = ') + 600);
  assert.match(f, /workspaceId && workspaceId !== workspace\?\.id/);
  assert.match(f, /markSettingsAfterSwitch\(workspaceId, tab\)/);
  assert.match(f, /onSwitchWorkspace\?\.\(workspaceId\)/);
  assert.match(f, /openSettings\(tab\)/);
});

test('NotificationsPanel routes through notificationTarget, with the appHost holds', () => {
  const s = src('../components/NotificationsPanel.jsx');
  assert.match(s, /notificationTarget\(n, \{ fileShares: fileSharesAllowed\(\), sharedFiles: sharedFilesAllowed\(\) \}\)/);
  assert.match(s, /onOpenSettings\?\.\(target\.tab, target\.workspaceId\)/);
  assert.match(s, /logEvent\(EV\.NOTIF_CLICK/);
  // Outside the panel and the bell, a press closes it.
  assert.match(s, /addEventListener\('pointerdown'/);
  assert.match(s, /anchorRef\?\.current\?\.contains\(e\.target\)/);
  // Escape gives focus back to the bell.
  assert.match(s, /anchorRef\?\.current\?\.focus\(/);
});

test('the bell is ink: gold only on a keyboard focus ring', () => {
  const css = src('../components/notificationsPanel.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = css.split('}').filter((r) => r.includes('--soleil'));
  for (const r of rules) assert.match(r.split('{')[0], /:focus-visible/, `gold outside focus: ${r.trim().slice(0, 80)}`);
});

test('rows carry workspace_id: the list selects every column', () => {
  const api = src('./boardsApi.js');
  const at = api.indexOf('export async function listNotifications');
  assert.match(api.slice(at, at + 300), /from\('notifications'\)\s*\.select\('\*'\)/);
});
