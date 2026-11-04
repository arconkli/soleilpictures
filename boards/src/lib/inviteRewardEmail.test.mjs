// Source pins for the invite_reward email and the app side of the 0863 invite
// reward notice. The edge functions are Deno, so these read them as text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fns = new URL('../../../supabase/functions/', import.meta.url);
const read = (u) => readFileSync(u, 'utf8');
const tpl = read(new URL('_shared/email/templates.ts', fns));
const idx = read(new URL('send-transactional-email/index.ts', fns));
const worker = read(new URL('../worker.js', import.meta.url));
const tab = read(new URL('../components/settings/NotificationsTab.jsx', import.meta.url));
const hook = read(new URL('../hooks/useNotifications.js', import.meta.url));
const panel = read(new URL('../components/NotificationsPanel.jsx', import.meta.url));
const css = read(new URL('../components/notificationsPanel.css', import.meta.url));

test('invite_reward is in TemplateName and TEMPLATE_NAMES', () => {
  const union = tpl.slice(tpl.indexOf('export type TemplateName'), tpl.indexOf('export const TEMPLATE_NAMES'));
  const list = tpl.slice(tpl.indexOf('export const TEMPLATE_NAMES'), tpl.indexOf('export interface RenderedEmail'));
  assert.ok(union.includes('"invite_reward"'));
  assert.ok(list.includes('"invite_reward"'));
});

test('renderTemplate passes only a whole count and a GB/TB label through', () => {
  const at = tpl.indexOf('case "invite_reward"');
  assert.ok(at > 0, 'case exists');
  const block = tpl.slice(at, tpl.indexOf('case "invite_accepted"', at));
  assert.match(block, /Number\.isInteger\(n\)/);
  assert.ok(block.includes('(GB|TB)'));
  assert.ok(block.includes('unsubTokenOf(data.unsubscribeToken)'));
});

test('the builder unsubscribes email_invite_reward and tags utm_campaign invite_reward', () => {
  const at = tpl.indexOf('function inviteReward(');
  const block = tpl.slice(at, tpl.indexOf('function editRequest(', at));
  assert.ok(block.includes('unsubUrl(d.unsubscribeToken, "email_invite_reward")'));
  assert.ok(block.includes('utm_campaign: "invite_reward"'));
});

test('send-transactional-email lists it for one-click unsubscribe and as user-triggered', () => {
  const list = idx.match(/const LIST_UNSUB_TEMPLATES = new Set\(\[([^\]]*)\]/)[1];
  assert.ok(list.includes('"invite_reward"'));
  const map = idx.slice(idx.indexOf('const UNSUB_KEY_BY_TEMPLATE'));
  assert.match(map.slice(0, map.indexOf('};')), /invite_reward:\s+"email_invite_reward"/);
  const ut = idx.match(/const USER_TRIGGERED = \[([\s\S]*?)\];/);
  assert.ok(ut, 'USER_TRIGGERED found');
  assert.ok(ut[1].includes('"invite_reward"'));
});

test('the Worker unsubscribe page knows email_invite_reward', () => {
  const labels = worker.slice(worker.indexOf('const UNSUB_LABELS'), worker.indexOf('const UNSUB_KEYS'));
  assert.ok(labels.includes('email_invite_reward:'));
});

test('Settings > Notifications has the Invite rewards switch', () => {
  assert.ok(tab.includes("togglePref('email_invite_reward'"));
  assert.ok(tab.includes("isOn('email_invite_reward')"));
});

test('a live invite.reward is quiet: no toast, no browser notification', () => {
  const ret = hook.indexOf("payload.kind === 'invite.reward'");
  assert.ok(ret > 0);
  assert.ok(ret < hook.indexOf('noticeToastText(payload)'));
  assert.ok(hook.slice(ret, ret + 80).includes('return;'));
});

test('the panel logs the editor-limit event only for editors.limit_reached, and draws the earned mark', () => {
  assert.match(panel, /if \(n\.kind === 'editors\.limit_reached'\) \{\s*try \{ logEvent\(EV\.EDITOR_LIMIT_NOTICE_OPEN/);
  assert.ok(panel.includes('ntf-earn'));
});

test('the earned mark is neutral ink, never gold', () => {
  const rule = css.match(/\.ntf-earn\s*\{[^}]*\}/);
  assert.ok(rule, '.ntf-earn rule');
  assert.ok(!rule[0].includes('--soleil'));
});
