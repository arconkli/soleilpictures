// A signed-out visitor's coin is per device, starts on its date, and never
// reaches crawlers, signed-in people or the user-id machinery. See visitorArms.js
// (the read every signed-out event makes) and visitorEnroll.js (the enrolling).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readVisitorArms, visitorArmProps, VISITOR_ARMS_KEY, isBoxPreview } from './visitorArms.js';
import { assignVisitorArm, enrollVisitor, hasStoredSession } from './visitorEnroll.js';
import { EXPERIMENTS, assignArm, getActiveExperiments } from './experiments.js';

function memoryStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

const START = Date.parse('2026-10-29T00:00:00Z');
const AFTER = START + 3600_000;

test('the sign-up box test is pinned: a 50/50 visitor test from 29 Oct', () => {
  const e = EXPERIMENTS.signup_box;
  assert.equal(e.enabled, true);
  assert.equal(e.audience, 'visitor');
  assert.equal(e.startsAt, '2026-10-29T00:00:00Z');
  assert.deepEqual(e.arms, [{ id: 'A', weight: 50 }, { id: 'B', weight: 50 }]);
});

test('the user-id machinery never assigns it', () => {
  assert.equal(assignArm('signup_box', 'some-user-id'), null);
  assert.ok(!getActiveExperiments().includes('signup_box'));
  // and the user-id experiments still are what they were
  assert.ok(getActiveExperiments().includes('workspace_setup'));
  assert.equal(assignVisitorArm('workspace_setup', 'dev-1', AFTER), null);
});

test('the arm is deterministic per device and about 50/50', () => {
  assert.equal(assignVisitorArm('signup_box', 'dev-1', AFTER), assignVisitorArm('signup_box', 'dev-1', AFTER + 9e9));
  let b = 0;
  const n = 10_000;
  for (let i = 0; i < n; i++) if (assignVisitorArm('signup_box', `device-${i}-${i * 7919}`, AFTER) === 'B') b++;
  assert.ok(Math.abs(b / n - 0.5) < 0.02, `B share ${b / n}`);
});

test('nobody is assigned before the start date, or without a device id', () => {
  assert.equal(assignVisitorArm('signup_box', 'dev-1', START - 1), null);
  assert.ok(['A', 'B'].includes(assignVisitorArm('signup_box', 'dev-1', START)));
  assert.equal(assignVisitorArm('signup_box', null, AFTER), null);
  assert.equal(assignVisitorArm('signup_box', '', AFTER), null);
});

test('enroll keeps the arm, and it rides signed-out events as exp_signup_box', () => {
  const s = memoryStorage();
  assert.deepEqual(visitorArmProps(s), {});
  const arm = enrollVisitor(s, 'signup_box', { deviceId: 'dev-1', now: AFTER });
  assert.equal(arm, assignVisitorArm('signup_box', 'dev-1', AFTER));
  assert.deepEqual(visitorArmProps(s), { exp_signup_box: arm });
  assert.deepEqual(JSON.parse(s.getItem(VISITOR_ARMS_KEY)), { signup_box: arm });
  // a stored arm sticks, whatever the coin now says
  const other = arm === 'A' ? 'B' : 'A';
  s.setItem(VISITOR_ARMS_KEY, JSON.stringify({ signup_box: other }));
  assert.equal(enrollVisitor(s, 'signup_box', { deviceId: 'dev-1', now: AFTER }), other);
  assert.deepEqual(visitorArmProps(s), { exp_signup_box: other });
});

test('crawlers, signed-in people, no storage and early visits are never enrolled', () => {
  const s = memoryStorage();
  assert.equal(enrollVisitor(s, 'signup_box', { deviceId: 'dev-1', bot: true, now: AFTER }), null);
  assert.equal(enrollVisitor(s, 'signup_box', { deviceId: 'dev-1', now: START - 1 }), null);
  assert.equal(enrollVisitor(s, 'signup_box', { deviceId: null, now: AFTER }), null);
  assert.equal(s.getItem(VISITOR_ARMS_KEY), null, 'nothing stored for them');
  assert.deepEqual(visitorArmProps(s), {});

  const signedIn = memoryStorage({ 'sb-abcdefgh-auth-token': '{}' });
  assert.equal(enrollVisitor(signedIn, 'signup_box', { deviceId: 'dev-1', now: AFTER }), null);
  const alt = memoryStorage({ 'sb-auth-as-xyz': '{}' });
  assert.equal(enrollVisitor(alt, 'signup_box', { deviceId: 'dev-1', now: AFTER }), null);
  assert.equal(enrollVisitor(null, 'signup_box', { deviceId: 'dev-1', now: AFTER }), null);
  assert.equal(enrollVisitor(s, 'workspace_setup', { deviceId: 'dev-1', now: AFTER }), null, 'only a visitor experiment');

  const denied = { get length() { throw new Error('denied'); }, key() { throw new Error('denied'); },
    getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(enrollVisitor(denied, 'signup_box', { deviceId: 'dev-1', now: AFTER }), null);
  assert.deepEqual(visitorArmProps(denied), {});
  const full = { length: 0, key: () => null, getItem: () => null, setItem() { throw new Error('quota'); } };
  assert.equal(enrollVisitor(full, 'signup_box', { deviceId: 'dev-1', now: AFTER }), null,
    'an arm that cannot be kept is not shown: its events could not carry it');
});

test('a code sent but not yet entered is not a session', () => {
  assert.equal(hasStoredSession(memoryStorage({ 'sb-abcdefgh-auth-token-code-verifier': 'x', 'soleil.auth.pendingCode': '{}' })), false);
  assert.equal(hasStoredSession(memoryStorage({ 'sb-abcdefgh-auth-token': '{}' })), true);
});

test('junk in storage, unknown keys and user-id experiments never ride events', () => {
  const s = memoryStorage({ [VISITOR_ARMS_KEY]: JSON.stringify({ signup_box: 'Z', workspace_setup: 'B', nope: 'A' }) });
  assert.deepEqual(readVisitorArms(s), {});
  assert.deepEqual(visitorArmProps(s), {});
  assert.ok(['A', 'B'].includes(enrollVisitor(s, 'signup_box', { deviceId: 'dev-1', now: AFTER })), 'a bad stored arm is replaced');
  assert.deepEqual(Object.keys(JSON.parse(s.getItem(VISITOR_ARMS_KEY))), ['signup_box'], 'and the junk is dropped');
  const broken = memoryStorage({ [VISITOR_ARMS_KEY]: '{not json' });
  assert.deepEqual(visitorArmProps(broken), {});
  assert.deepEqual(visitorArmProps(memoryStorage({ [VISITOR_ARMS_KEY]: '"B"' })), {});
});

test('the preview link: only ?preview=signupbox, and never without a page', () => {
  assert.equal(isBoxPreview('?preview=signupbox'), true);
  assert.equal(isBoxPreview('?utm_source=x&preview=signupbox'), true);
  assert.equal(isBoxPreview('?preview=signupbox2'), false);
  assert.equal(isBoxPreview('?preview=1'), false);
  assert.equal(isBoxPreview(''), false);
  assert.equal(isBoxPreview(), false, 'under node there is no window: false, not a throw');
});
