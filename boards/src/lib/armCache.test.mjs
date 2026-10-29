// The arm cache is per account, and the server's stamp is the truth for it.
// See armCache.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createArmCache, ARMS_PREFIX, LEGACY_ARMS_KEY } from './armCache.js';

function memoryStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

function cacheOn(seed) {
  const s = memoryStorage(seed);
  return { s, c: createArmCache(() => s) };
}

test('two accounts on one browser keep their own arms, and signed out there are none', () => {
  const { s, c } = cacheOn();
  c.enroll({ exp_workspace_setup: 'B' }, 'ann');
  assert.deepEqual(c.arms('ann'), { exp_workspace_setup: 'B' });
  assert.deepEqual(c.arms('bob'), {}, 'bob does not inherit ann\'s arms');
  c.enroll({ exp_workspace_setup: 'A' }, 'bob');
  assert.deepEqual(c.arms('ann'), { exp_workspace_setup: 'B' });
  assert.deepEqual(c.arms(null), {});
  assert.equal(c.arm(null, 'workspace_setup'), null);
  assert.deepEqual(JSON.parse(s.getItem(ARMS_PREFIX + 'bob')), { exp_workspace_setup: 'A' });
});

test('an enrollment merges; it never wipes another key', () => {
  const { c } = cacheOn();
  c.enroll({ exp_workspace_setup: 'B' }, 'ann');
  c.enroll({ exp_onboarding_v2: 'B' }, 'ann');
  assert.deepEqual(c.arms('ann'), { exp_workspace_setup: 'B', exp_onboarding_v2: 'B' });
  assert.equal(c.arm('ann', 'onboarding_v2'), 'B');
});

test('a reload keeps the arms, and the server\'s stamp then replaces them', () => {
  const { s } = cacheOn();
  const first = createArmCache(() => s);
  first.enroll({ exp_workspace_setup: 'B', exp_onboarding_v2: 'A', exp_retired: 'C' }, 'ann');
  const next = createArmCache(() => s);
  assert.deepEqual(next.arms('ann'), { exp_workspace_setup: 'B', exp_onboarding_v2: 'A', exp_retired: 'C' });
  next.adoptServer({ workspace_setup: 'B', onboarding_v2: 'B', instant_entry: 'B' }, 'ann');
  assert.deepEqual(next.arms('ann'), { exp_workspace_setup: 'B', exp_onboarding_v2: 'B', exp_instant_entry: 'B' },
    'the server wins every key it holds, and a key it never stamped stops riding events');
  assert.deepEqual(JSON.parse(s.getItem(ARMS_PREFIX + 'ann')), next.arms('ann'));
});

test('a key enrolled this page load survives a stamp read that has not caught up with it', () => {
  const { c } = cacheOn();
  c.enroll({ exp_workspace_setup: 'B' }, 'ann');
  c.adoptServer({}, 'ann');
  assert.deepEqual(c.arms('ann'), { exp_workspace_setup: 'B' });
  c.adoptServer({ workspace_setup: 'A' }, 'ann');
  assert.deepEqual(c.arms('ann'), { exp_workspace_setup: 'A' }, 'an earlier stamp on the server still wins');
});

test('only string arms are taken from the server, and a malformed answer changes nothing', () => {
  const { c } = cacheOn();
  c.enroll({ exp_onboarding_v2: 'B' }, 'ann');
  c.adoptServer(null, 'ann');
  c.adoptServer(['B'], 'ann');
  assert.deepEqual(c.arms('ann'), { exp_onboarding_v2: 'B' });
  c.adoptServer({ onboarding_v2: 'B', bad: { arm: 'B' }, empty: '' }, 'ann');
  assert.deepEqual(c.arms('ann'), { exp_onboarding_v2: 'B' });
});

test('a write without an account does nothing, and one for another account reaches only its map', () => {
  const { c } = cacheOn();
  assert.deepEqual(c.arms('ann'), {});
  c.enroll({ exp_workspace_setup: 'B' }, 'bob');
  c.adoptServer({ onboarding_v2: 'B' }, 'bob');
  assert.deepEqual(c.arms('ann'), {});
  assert.deepEqual(c.arms('bob'), { exp_workspace_setup: 'B', exp_onboarding_v2: 'B' });
  c.enroll({ exp_x: 'A' }, null);
  c.adoptServer({ x: 'A' }, undefined);
  assert.deepEqual(c.arms(null), {});
});

test('the old browser-wide map draws the UI until the stamp is read, rides no event, then is deleted', () => {
  const { s, c } = cacheOn({ [LEGACY_ARMS_KEY]: JSON.stringify({ exp_onboarding_v2: 'B', exp_workspace_setup: 'A' }) });
  assert.equal(c.arm('ann', 'onboarding_v2'), 'B', 'a returning user keeps the treatment App draws at first render');
  assert.equal(c.arm(null, 'onboarding_v2'), 'B');
  assert.deepEqual(c.arms('ann'), {}, 'never on an event: it may be another account\'s');
  c.adoptServer({ onboarding_v2: 'B' }, 'ann');
  assert.equal(s.getItem(LEGACY_ARMS_KEY), null);
  assert.equal(c.arm('ann', 'workspace_setup'), null, 'the stamp read retires it');
  assert.equal(c.arm('bob', 'onboarding_v2'), null);
  assert.equal(c.arm('ann', 'onboarding_v2'), 'B');
});

test('broken storage never throws, and memory still works', () => {
  const c = createArmCache(() => { throw new Error('denied'); });
  c.enroll({ exp_workspace_setup: 'B' }, 'ann');
  assert.deepEqual(c.arms('ann'), { exp_workspace_setup: 'B' });
  c.adoptServer({ onboarding_v2: 'B' }, 'ann');
  assert.deepEqual(c.arms('ann'), { exp_workspace_setup: 'B', exp_onboarding_v2: 'B' });
  const { c: bad } = cacheOn({ [ARMS_PREFIX + 'ann']: '{not json', [LEGACY_ARMS_KEY]: '[1]' });
  assert.deepEqual(bad.arms('ann'), {});
  assert.equal(bad.arm('ann', 'onboarding_v2'), null);
});

test('analytics.js keeps the arms per account and reads the stamp for the account that signed in', () => {
  const src = readFileSync(new URL('./analytics.js', import.meta.url), 'utf8');
  assert.match(src, /const armCache = createArmCache\(/);
  // Signed in, the account's own arms; signed out, only the device's visitor
  // arms (visitorArms.js), never an account's.
  assert.match(src, /function getExperiments\(\) \{\s*return cachedUserId \? armCache\.arms\(cachedUserId\) : visitorArms\(\);/);
  assert.match(src, /function visitorArms\(\) \{\s*try \{ return visitorArmProps\(localStorage\); \}/);
  assert.match(src, /export function setEnrolledExperiments\(map, uid = cachedUserId\) \{\s*if \(uid\) \{ armCache\.enroll\(map, uid\); return; \}/);
  assert.match(src, /getSession\(\)\.then\(\(\{ data \}\) => armCache\.enroll\(map, data\?\.session\?\.user\?\.id\)/,
    'an enrollment made before the auth callback lands on the session\'s account, never on none');
  assert.match(src, /export function getEnrolledArm\(key, uid = cachedUserId\) \{\s*return armCache\.arm\(uid, key\);/);
  assert.match(src, /primeEnrolledExperiments\(session\.user\.id\)/);
  const prime = src.slice(src.indexOf('async function primeEnrolledExperiments'), src.indexOf('function getSessionId'));
  assert.match(prime, /const \{ data, error \} = await supabase\.rpc\('get_my_experiments'\)/);
  assert.ok(prime.indexOf('if (error') < prime.indexOf('armCache.adoptServer'),
    'supabase-js resolves an error rather than throwing; an error must not reach adoptServer and empty the map');
  assert.doesNotMatch(src, /EXPERIMENTS_KEY|cachedExperiments/, 'no browser-wide map is read or written');
});
