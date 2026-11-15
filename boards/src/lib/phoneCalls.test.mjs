// The phone admin panel's call table: the waves, the pages, and what a call
// may keep in this browser for the next visit.
// Run: node --test src/lib/phoneCalls.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  CALLS, FIRST, SECOND, PAGE_CALLS, SNAP_KEYS, snapName, snapOf, holdsPersonal,
} from '../pages/admin/phone/phoneCalls.js';
import { SHARED_REPORTS } from './adminReport.js';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(resolve(SRC, rel), 'utf8');

test('the two waves are known calls and share none', () => {
  for (const k of [...FIRST, ...SECOND]) assert.ok(CALLS[k], k);
  assert.deepEqual(FIRST.filter((k) => SECOND.includes(k)), []);
  assert.equal(new Set([...FIRST, ...SECOND]).size, FIRST.length + SECOND.length);
});

test('Paying is in the first wave: it is in the top row of Today', () => {
  assert.ok(FIRST.includes('moneyPeople'));
  assert.ok(!SECOND.includes('moneyPeople'));
});

test('the heavy reports wait for the first wave', () => {
  const heavy = Object.keys(CALLS).filter((k) => SHARED_REPORTS.includes(CALLS[k].rpc));
  assert.ok(heavy.length >= 3);
  for (const k of heavy) assert.ok(!FIRST.includes(k), k);
});

test('every page reads known calls', () => {
  for (const [page, keys] of Object.entries(PAGE_CALLS)) {
    assert.ok(keys.length > 0, page);
    for (const k of keys) assert.ok(CALLS[k], `${page}: ${k}`);
  }
});

test('the heavy reports go through adminReport, and a forced refresh asks for a new one', () => {
  const s = read('pages/admin/phone/phoneData.js');
  assert.match(s, /SHARED_REPORTS\.includes\(call\.rpc\)\s*\? adminReport\(supabase, call\.rpc, call\.args, \{ fresh: force \}\)/);
  // The hour's hold stays around the two slowest.
  assert.match(s, /cachedReport\(call\.rpc, call\.args, read\)/);
  assert.ok(!/\.catch\(/.test(s.replace(/^\s*(\/\/|\*).*$/gm, '')));
});

test('people and link paths are never kept', () => {
  assert.equal(snapOf('signups', [{ created_at: '2026-01-01' }]), undefined);
  assert.equal(snapOf('aiReferrals', [{ day: '2026-01-01', n: 1 }]), undefined);
  assert.ok(!SNAP_KEYS.includes('signups'));
  assert.ok(!SNAP_KEYS.includes('aiReferrals'));
  assert.equal(SNAP_KEYS.length, Object.keys(CALLS).length - 2);
});

test('nothing is kept for an unknown call or an empty answer', () => {
  assert.equal(snapOf('nope', { a: 1 }), undefined);
  assert.equal(snapOf('kpi', null), undefined);
  assert.equal(snapOf('kpi', undefined), undefined);
  assert.deepEqual(snapOf('kpi', { signups: 3 }), { signups: 3 });
  assert.equal(snapOf('active', 0), 0);
});

test('a report that still holds a personal field is not kept', () => {
  assert.equal(snapOf('kpi', { rows: [{ user_id: 'u1', n: 2 }] }), undefined);
  assert.equal(snapOf('sharing', { top: [{ who: 'someone@example.com' }] }), undefined);
  assert.equal(holdsPersonal({ a: [{ b: { email: null } }] }), true);
  assert.equal(holdsPersonal({ path: '/vs/thing', day: '2026-01-01', n: 4 }), false);
  assert.equal(holdsPersonal('a plain line'), false);
  assert.equal(holdsPersonal(12), false);
});

test('what each pick leaves can be kept', () => {
  const money = CALLS.moneyPeople.pick({
    paying: 2, paid_plan: 2, near_cap: 1, past_due: 0, comped: 0, paid_ever: 3,
    trials: [{ email: 'a@example.com', user_id: 'u1' }],
    cap_hits: { since: '2026-01-01', rows: [{ email: 'b@example.com', user_id: 'u2' }] },
  });
  assert.equal(holdsPersonal(money), false);
  assert.equal(money.trial_count, 1);
  assert.equal(money.cap_hits.people, 1);
  assert.deepEqual(snapOf('moneyPeople', money), money);

  const sharing = CALLS.sharing.pick({ days: 30, top_sharers: [{ email: 'a@example.com' }] });
  assert.deepEqual(sharing, { days: 30 });

  const referrals = CALLS.referrals.pick({ sent: 1, top_referrers: [{ user_id: 'u1' }] });
  assert.deepEqual(referrals, { sent: 1 });

  const contacts = CALLS.contacts.pick([
    { status: 'new', name: 'A', email: 'a@example.com', message: 'hello' }, { status: 'done', name: 'B' },
  ]);
  assert.deepEqual(contacts, { new: 1 });

  for (const key of ['errors', 'problems']) {
    const kept = CALLS[key].pick({ days: 2, since: 'x', totals: { groups: 1 }, groups: [{ message: 'raw text', user_id: 'u1' }] });
    assert.deepEqual(kept, { days: 2, since: 'x', totals: { groups: 1 } });
  }
});

test('snapshots are kept under phone:<key>, and the panel seeds from the same names', () => {
  assert.equal(snapName('kpi'), 'phone:kpi');
  const s = read('pages/admin/phone/phoneData.js');
  assert.match(s, /readSnap\(owner, snapName\(key\)\)/);
  assert.match(s, /writeSnap\(uid, snapName\(key\), keep\)/);
});

test('signing out forgets what the panel holds and every snapshot', () => {
  const s = read('pages/admin/phone/phoneData.js');
  assert.match(s, /if \(event !== 'SIGNED_OUT'\) return;\s*clearPhoneData\(\);\s*forgetSnaps\(\);/);
  const gate = read('auth/AuthGate.jsx');
  assert.match(gate, /event === 'SIGNED_OUT'\s*\? import\('\.\.\/lib\/adminSnapshot\.js'\)\.then\(\(m\) => m\.forgetSnaps\(\)/);
  // On demand: a static import would put the module in the entry chunk.
  assert.ok(!/^import[^;]*from '\.\.\/lib\/adminSnapshot\.js';/m.test(gate));
});

test('Posts loads nothing until it is opened', () => {
  const s = read('pages/admin/phone/AdminPhonePanel.jsx');
  assert.match(s, /\{postsOpened\.current && \(\s*<div hidden=\{tab !== 'posts'\}>\s*<PhonePosts /);
  assert.match(s, /if \(tab === 'posts'\) postsOpened\.current = true;/);
});
