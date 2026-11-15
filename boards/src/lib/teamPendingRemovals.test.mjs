// teamPendingRemovals.test.mjs — the Team page's undo queue: a removal waits
// `delay`, Undo before it sends nothing, flush sends what waits, a failure
// brings the row back. Timers are injected, so nothing here waits.
//
//   node --import ./scripts/linguiNode.mjs --test src/lib/teamPendingRemovals.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPendingRemovals, personKey, domainKey, withoutPending, UNDO_MS } from './teamPendingRemovals.js';

// A clock the test moves by hand.
function clock() {
  let now = 0;
  let next = 1;
  const timers = new Map();
  return {
    setTimer: (fn, ms) => { const id = next++; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimer: (id) => { timers.delete(id); },
    tick(ms) {
      now += ms;
      for (const [id, t] of [...timers]) {
        if (t.at <= now && timers.has(id)) { timers.delete(id); t.fn(); }
      }
    },
    count: () => timers.size,
  };
}

const settle = () => new Promise((r) => setImmediate(r));

function make(over = {}) {
  const c = clock();
  const commits = [];
  const fails = [];
  const q = createPendingRemovals({
    delay: 6000,
    commit: (item) => { commits.push(item); return Promise.resolve({ ok: true }); },
    onFail: (item, res) => fails.push([item, res]),
    setTimer: c.setTimer,
    clearTimer: c.clearTimer,
    ...over,
  });
  return { c, q, commits, fails };
}

test('the default wait is the Undo toast\'s six seconds', () => {
  assert.equal(UNDO_MS, 6000);
});

test('a removal commits when the delay ends, not before', async () => {
  const { c, q, commits } = make();
  q.add('u1', { type: 'remove', personId: 'u1' });
  assert.ok(q.has('u1'));
  assert.deepEqual(q.keys(), ['u1']);
  c.tick(5999);
  assert.deepEqual(commits, []);
  c.tick(1);
  assert.deepEqual(commits, [{ type: 'remove', personId: 'u1' }]);
  await settle();
  assert.ok(!q.has('u1'));
  assert.deepEqual(q.keys(), []);
});

test('a key stays hidden while its commit is in flight, and goes when it answers', async () => {
  let answer;
  const { c, q } = make({ commit: () => new Promise((r) => { answer = r; }) });
  q.add('u1', {});
  c.tick(6000);
  assert.ok(q.has('u1'), 'in flight: still hidden');
  assert.equal(q.undo('u1'), false, 'too late to undo');
  answer({ ok: true });
  await settle();
  assert.ok(!q.has('u1'));
});

test('Undo before the delay cancels it and sends nothing', async () => {
  const { c, q, commits, fails } = make();
  q.add('u1', { type: 'remove' });
  assert.equal(q.undo('u1'), true);
  assert.ok(!q.has('u1'));
  assert.equal(c.count(), 0, 'the timer is gone');
  c.tick(60000);
  await settle();
  assert.deepEqual(commits, []);
  assert.deepEqual(fails, []);
  assert.equal(q.undo('u1'), false, 'nothing left to undo');
  assert.equal(q.undo('never-added'), false);
});

test('flush commits everything waiting at once and cancels the timers', async () => {
  const { c, q, commits } = make();
  q.add('a', { n: 1 });
  q.add('b', { n: 2 });
  q.add('domain:x.co', { n: 3 });
  const done = q.flush();
  assert.deepEqual(commits.map((i) => i.n), [1, 2, 3]);
  assert.equal(c.count(), 0);
  await done;
  assert.deepEqual(q.keys(), []);
  c.tick(60000);
  assert.equal(commits.length, 3, 'nothing is committed twice');
});

test('flush with nothing waiting is a no-op', async () => {
  const { q, commits } = make();
  await q.flush();
  assert.deepEqual(commits, []);
});

test('a refused commit calls onFail with the result and the row comes back', async () => {
  const refused = { ok: false, refusal: { code: 'team_not_admin' } };
  const { c, q, fails } = make({ commit: () => Promise.resolve(refused) });
  q.add('u1', { type: 'remove' });
  c.tick(6000);
  await settle();
  assert.deepEqual(fails, [[{ type: 'remove' }, refused]]);
  assert.ok(!q.has('u1'));
});

test('a throwing commit calls onFail too, with the error', async () => {
  const boom = new Error('offline');
  const { c, q, fails } = make({ commit: () => { throw boom; } });
  q.add('u1', { type: 'remove' });
  c.tick(6000);
  await settle();
  assert.equal(fails.length, 1);
  assert.equal(fails[0][1].ok, false);
  assert.equal(fails[0][1].error, boom);
  assert.ok(!q.has('u1'));
});

test('a rejected commit promise is a failure', async () => {
  const { c, q, fails } = make({ commit: () => Promise.reject(new Error('x')) });
  q.add('u1', {});
  c.tick(6000);
  await settle();
  assert.equal(fails.length, 1);
});

test('a commit that returns nothing counts as done', async () => {
  const { c, q, fails } = make({ commit: () => {} });
  q.add('u1', {});
  c.tick(6000);
  await settle();
  assert.deepEqual(fails, []);
  assert.ok(!q.has('u1'));
});

test('the row is back before onFail runs, so the toast never says it while the row is hidden', async () => {
  let hiddenAtFail = null;
  let q;
  ({ q } = make({
    commit: () => Promise.resolve({ ok: false }),
    onFail: () => { hiddenAtFail = q.has('u1'); },
  }));
  q.add('u1', {});
  await q.flush();
  assert.equal(hiddenAtFail, false);
});

test('adding the same key again replaces the item and restarts the wait', async () => {
  const { c, q, commits } = make();
  q.add('u1', { v: 1 });
  c.tick(4000);
  q.add('u1', { v: 2 });
  assert.equal(c.count(), 1, 'one timer for one key');
  c.tick(4000);
  assert.deepEqual(commits, [], 'the first wait no longer counts');
  c.tick(2000);
  assert.deepEqual(commits, [{ v: 2 }]);
});

test('different keys wait on their own timers', async () => {
  const { c, q, commits } = make();
  q.add('a', { v: 'a' });
  c.tick(3000);
  q.add('b', { v: 'b' });
  c.tick(3000);
  assert.deepEqual(commits, [{ v: 'a' }]);
  q.undo('b');
  c.tick(6000);
  assert.deepEqual(commits, [{ v: 'a' }]);
});

test('a listener hears every change, and version moves with it', async () => {
  const { c, q } = make();
  const seen = [];
  const off = q.subscribe(() => seen.push(q.version()));
  const v0 = q.version();
  q.add('u1', {});
  q.undo('u1');
  q.add('u2', {});
  c.tick(6000);
  await settle();
  assert.ok(seen.length >= 4, 'add, undo, add, settled');
  assert.deepEqual(seen, [...seen].sort((a, b) => a - b), 'the version only goes up');
  assert.ok(q.version() > v0);
  off();
  const before = seen.length;
  q.add('u3', {});
  assert.equal(seen.length, before, 'an unsubscribed listener hears nothing');
});

test('dispose drops what is waiting without sending it', async () => {
  const { c, q, commits } = make();
  q.add('u1', {});
  q.dispose();
  assert.equal(c.count(), 0);
  c.tick(60000);
  await settle();
  assert.deepEqual(commits, []);
  q.add('u2', {});
  assert.ok(!q.has('u2'), 'a disposed queue takes nothing new');
});

test('the default timers are the real ones', async () => {
  const commits = [];
  const q = createPendingRemovals({ delay: 5, commit: (i) => { commits.push(i); return { ok: true }; } });
  q.add('u1', { v: 1 });
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(commits, [{ v: 1 }]);
});

// ── Drawing the snapshot while removals wait ────────────────────────────
const team = () => ({
  id: 'o1',
  people: [{ id: 'u1', name: 'A' }, { id: 'invite:i1', name: 'b@x.co' }, { id: 'u2', name: 'C' }],
  joining: { link: { on: true }, domains: [{ domain: 'x.co' }, { domain: 'y.co' }] },
});

test('withoutPending leaves out the pending people, invites and domains', () => {
  const t = team();
  const pending = new Set([personKey('u2'), personKey('invite:i1'), domainKey('y.co')]);
  const out = withoutPending(t, (k) => pending.has(k));
  assert.deepEqual(out.people.map((p) => p.id), ['u1']);
  assert.deepEqual(out.joining.domains.map((d) => d.domain), ['x.co']);
  assert.deepEqual(out.joining.link, { on: true });
  assert.equal(out.id, 'o1');
  assert.equal(t.people.length, 3, 'the snapshot itself is untouched');
});

test('withoutPending hands back the same object when nothing is pending', () => {
  const t = team();
  assert.equal(withoutPending(t, () => false), t);
});

test('withoutPending keeps what did not change by identity', () => {
  const t = team();
  const onlyPerson = withoutPending(t, (k) => k === 'u1');
  assert.equal(onlyPerson.joining, t.joining);
  const onlyDomain = withoutPending(t, (k) => k === 'domain:x.co');
  assert.equal(onlyDomain.people, t.people);
});

test('withoutPending copes with a team that has no joining', () => {
  const t = { id: 'o1', people: [{ id: 'u1' }], joining: null };
  assert.equal(withoutPending(t, () => false), t);
  assert.deepEqual(withoutPending(t, (k) => k === 'u1').people, []);
});

test('a domain key never meets a person key', () => {
  assert.notEqual(domainKey('u1'), personKey('u1'));
  assert.equal(personKey('invite:abc'), 'invite:abc');
});
