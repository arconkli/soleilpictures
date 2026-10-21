// setupTips.test.mjs — the three tips a new account gets in its workspace.
//
//   node --test src/lib/setupTips.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIP_IDS, TIP_ANCHORS, TIPS_QUIET_MS, tipsFor, tipsEligible, tipsDue, tipsRecord } from './setupTips.js';
import { SETUP_EPOCH } from './workspaceSetup.js';

const NEW = '2026-10-23T10:00:00Z';   // after SETUP_EPOCH (the sidebar release)
const OLD = '2026-10-01T10:00:00Z';

test('three tips in order, each pointing at the part of the sidebar it names', () => {
  const desk = tipsFor({ phone: false, canImport: true });
  assert.deepEqual(desk.map((t) => t.id), [...TIP_IDS]);
  assert.deepEqual(desk.map((t) => [t.n, t.of]), [[1, 3], [2, 3], [3, 3]]);
  assert.deepEqual(desk.map((t) => t.anchor), [TIP_ANCHORS.desk.clusters, TIP_ANCHORS.desk.files, TIP_ANCHORS.desk.import]);
  assert.ok(desk.every((t) => t.placement === 'right'));
  assert.deepEqual(desk.map((t) => t.last), [false, false, true]);
  assert.equal(desk[0].title, 'Your clusters live here');
  assert.equal(desk[1].title, 'Drop any file, or paste a link');
  assert.equal(desk[2].title, 'Coming from Google Drive or Dropbox?');
});

test('the first tip waits for content before it asks for a cluster per project', () => {
  for (const phone of [false, true]) {
    const [first] = tipsFor({ phone, canImport: true });
    assert.doesNotMatch(first.body, /make|create|new cluster/i, 'no push to nest on day one');
  }
  assert.match(tipsFor({})[0].body, /^Each cluster is its own board\. Once you’ve added a few things/);
});

test('the files tip names the paste-a-link habit on every screen', () => {
  assert.match(tipsFor({ phone: false })[1].body, /Paste a link/);
  assert.match(tipsFor({ phone: true })[1].body, /Paste a link/);
});

test('the import tip offers the guide only where it exists; otherwise it says to unzip', () => {
  const withGuide = tipsFor({ canImport: true })[2];
  assert.equal(withGuide.how, true);
  assert.match(withGuide.body, /zip/);
  const plain = tipsFor({ canImport: false })[2];
  assert.equal(plain.how, false);
  assert.match(plain.body, /unzip/);
  assert.equal(tipsFor({ phone: true, canImport: false })[2].how, false);
  assert.match(tipsFor({ phone: true, canImport: false })[2].body, /unzip/);
  assert.ok(tipsFor({ canImport: true }).slice(0, 2).every((t) => !t.how), 'only the last tip has See how');
});

test('on a phone the first tip points at the menu button and the rest inside the open drawer', () => {
  const phone = tipsFor({ phone: true, canImport: true });
  assert.equal(phone[0].anchor, TIP_ANCHORS.phone.clusters);
  assert.match(phone[0].anchor, /Open menu/);
  assert.match(phone[1].anchor, /is-mobile-open/);
  assert.match(phone[2].anchor, /is-mobile-open/);
  assert.deepEqual(phone.map((t) => t.placement), ['bottom', 'bottom', 'top']);
  assert.equal(phone[0].title, 'Your clusters and files live here');
});

test('only accounts made since the setup began, and only once', () => {
  assert.equal(tipsEligible({ allowed: true, createdAt: NEW }), true);
  assert.equal(tipsEligible({ allowed: true, createdAt: SETUP_EPOCH }), true, 'the epoch itself counts');
  assert.equal(tipsEligible({ allowed: true, createdAt: OLD }), false, 'an older account never gets them');
  assert.equal(tipsEligible({ allowed: false, createdAt: NEW }), false, 'the host gate');
  assert.equal(tipsEligible({ allowed: true, createdAt: NEW, seenHere: true }), false, 'seen on this device');
  assert.equal(tipsEligible({ allowed: true, createdAt: NEW, record: { done: true } }), false, 'kept on the profile');
  assert.equal(tipsEligible({ allowed: true, createdAt: NEW, record: { done: false } }), true);
  assert.equal(tipsEligible({ allowed: true, createdAt: 'nonsense' }), false);
  assert.equal(tipsEligible({ allowed: true }), false);
  assert.equal(tipsEligible(), false);
});

test('due once something is down and they have been quiet, never over an upload or another surface', () => {
  const base = { eligible: true, hasCards: true, uploading: false, quietFor: TIPS_QUIET_MS, blocked: false, sidebarShown: true };
  assert.equal(tipsDue(base), true);
  assert.equal(tipsDue({ ...base, quietFor: TIPS_QUIET_MS - 1 }), false, 'still working');
  assert.equal(tipsDue({ ...base, hasCards: false }), false, 'nothing on the board yet');
  assert.equal(tipsDue({ ...base, uploading: true }), false);
  assert.equal(tipsDue({ ...base, blocked: true }), false);
  assert.equal(tipsDue({ ...base, sidebarShown: false }), false, 'a hidden sidebar has nothing to point at');
  assert.equal(tipsDue({ ...base, eligible: false }), false);
  assert.equal(tipsDue({ ...base, quietFor: undefined }), false);
  assert.equal(tipsDue(), false);
});

test('the record says how they ended, and that they did', () => {
  assert.deepEqual(tipsRecord({ last: 'files', action: 'skip', now: NEW }), { v: 1, done: true, last: 'files', action: 'skip', at: NEW });
  assert.deepEqual(tipsRecord({ last: 'import', action: 'how', now: NEW }), { v: 1, done: true, last: 'import', action: 'how', at: NEW });
  assert.equal(tipsRecord({ last: 'bogus', action: 'done' }).last, null);
  assert.equal(tipsRecord({ last: 'clusters' }).done, true);
});
