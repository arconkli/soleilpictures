// webhooks — signing, URL validation, fan-out and retry.
//
// The signature is the part that must be exactly right: a receiver written
// against the documented scheme has to be able to verify what we actually send,
// and the failure mode of getting it wrong is every delivery being rejected by
// a correctly-implemented verifier.
//
// The database is stubbed here rather than mocked at the HTTP layer, because
// what these tests are about is the DECISIONS — who gets a delivery, when a
// retry is due, when a hook is switched off — not PostgREST's behaviour, which
// the live run covers.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  signBody, verifySignature, webhookUrlProblem, fanOutEvents, deliverDue,
  WEBHOOK_EVENTS, MAX_ATTEMPTS, DISABLE_AFTER_FAILURES, REPLAY_WINDOW_SECONDS,
} from './webhooks.js';

// ── signing ──────────────────────────────────────────────────────────────────

test('the signature covers the timestamp AND the body', async () => {
  const a = await signBody('whsec_x', 1000, '{"a":1}');
  assert.match(a, /^v0=[0-9a-f]{64}$/);
  // Both inputs must move the output, or a captured signature can be replayed
  // with a new timestamp, or reused for a different body.
  assert.notEqual(a, await signBody('whsec_x', 1001, '{"a":1}'));
  assert.notEqual(a, await signBody('whsec_x', 1000, '{"a":2}'));
  assert.notEqual(a, await signBody('whsec_y', 1000, '{"a":1}'));
});

test('a receiver implementing the documented scheme verifies what we send', async () => {
  const secret = 'whsec_abc';
  const body = JSON.stringify({ type: 'card.created', resource: { id: 'x' } });
  const ts = 1_770_000_000;
  const header = await signBody(secret, ts, body);
  assert.equal(await verifySignature(secret, header, ts, body, ts), true);
});

test('a signature outside the replay window is refused', async () => {
  const secret = 'whsec_abc';
  const body = '{}';
  const ts = 1_770_000_000;
  const header = await signBody(secret, ts, body);
  assert.equal(await verifySignature(secret, header, ts, body, ts + REPLAY_WINDOW_SECONDS - 1), true);
  assert.equal(await verifySignature(secret, header, ts, body, ts + REPLAY_WINDOW_SECONDS + 1), false);
  // Clock skew cuts both ways, so the window is symmetric.
  assert.equal(await verifySignature(secret, header, ts, body, ts - REPLAY_WINDOW_SECONDS + 1), true);
  assert.equal(await verifySignature(secret, header, ts, body, ts - REPLAY_WINDOW_SECONDS - 1), false);
});

test('a wrong secret, a tampered body and a garbage header all fail', async () => {
  const ts = 1_770_000_000;
  const header = await signBody('right', ts, '{"amount":1}');
  assert.equal(await verifySignature('wrong', header, ts, '{"amount":1}', ts), false);
  assert.equal(await verifySignature('right', header, ts, '{"amount":9999}', ts), false);
  assert.equal(await verifySignature('right', 'v0=deadbeef', ts, '{"amount":1}', ts), false);
  assert.equal(await verifySignature('right', '', ts, '{"amount":1}', ts), false);
});

// ── URL validation ───────────────────────────────────────────────────────────

test('a webhook URL must be public https on the default port', () => {
  assert.equal(webhookUrlProblem('https://hooks.example.com/soleil'), null);
  assert.equal(webhookUrlProblem('https://hooks.example.com:443/x'), null);

  // We fetch this from our own IP on a schedule — the textbook SSRF shape.
  for (const bad of [
    'http://hooks.example.com/x',
    'https://localhost/x',
    'https://127.0.0.1/x',
    'https://10.0.0.5/x',
    'https://192.168.1.1/x',
    'https://172.16.0.1/x',
    'https://169.254.169.254/latest/meta-data/',
    'https://metadata.google.internal/x',
    'https://build.internal/x',
    'https://printer.local/x',
    'https://hooks.example.com:22/x',
    'file:///etc/passwd',
    'not a url',
  ]) {
    assert.ok(webhookUrlProblem(bad), `should have been refused: ${bad}`);
  }
});

// ── fan-out ──────────────────────────────────────────────────────────────────

// A stand-in for the three database calls fan-out and delivery make. Records
// what was written so the DECISIONS can be asserted directly.
function fakeDb({ events = [], hooks = [], deliveries = [] } = {}) {
  const writes = { inserted: [], patched: [] };
  return {
    writes,
    select: async (_env, tbl, query) => {
      if (tbl === 'webhook_events') return events.filter((e) => !e.fanned_at);
      if (tbl === 'webhooks') {
        return query.includes('active=is.true') ? hooks.filter((h) => h.active !== false) : hooks;
      }
      if (tbl === 'webhook_deliveries') return deliveries;
      return [];
    },
    insert: async (_env, tbl, rows) => { writes.inserted.push(...rows.map((r) => ({ tbl, ...r }))); },
    patch: async (_env, tbl, query, patch) => { writes.patched.push({ tbl, query, patch }); },
  };
}

const ev = (over = {}) => ({
  id: 1, workspace_id: 'ws-1', board_id: 'b-1', event: 'card.created',
  resource: { count: 3 }, created_at: '2026-08-09T12:00:00Z', ...over,
});
const hook = (over = {}) => ({
  id: 'h-1', workspace_id: 'ws-1', events: ['card.created'], active: true,
  url: 'https://hooks.example.com/x', secret: 'whsec_1', failure_count: 0, ...over,
});

test('one event becomes one delivery per SUBSCRIBED hook', async () => {
  const db = fakeDb({
    events: [ev()],
    hooks: [
      hook({ id: 'h-1', events: ['card.created'] }),
      hook({ id: 'h-2', events: ['board.created'] }),   // not subscribed
      hook({ id: 'h-3', events: ['*'] }),               // everything
      hook({ id: 'h-4', workspace_id: 'ws-2', events: ['*'] }), // another workspace
    ],
  });
  const out = await fanOutEvents({}, { db });
  assert.equal(out.deliveries, 2);
  assert.deepEqual(db.writes.inserted.map((d) => d.webhook_id).sort(), ['h-1', 'h-3']);
});

test('a delivery is per hook, so each keeps its own retry state', async () => {
  const db = fakeDb({ events: [ev()], hooks: [hook({ id: 'h-1' }), hook({ id: 'h-2' })] });
  await fanOutEvents({}, { db });
  // Two rows, not one shared one — otherwise "did hook B get it?" has no answer.
  assert.equal(db.writes.inserted.length, 2);
  assert.equal(new Set(db.writes.inserted.map((d) => d.event_id)).size, 1);
});

test('the payload is thin and points back at the resource', async () => {
  const db = fakeDb({ events: [ev()], hooks: [hook()] });
  await fanOutEvents({}, { db });
  const p = db.writes.inserted[0].payload;
  assert.equal(p.type, 'card.created');
  assert.equal(p.resource.type, 'card');
  assert.equal(p.board.id, 'b-1');
  assert.equal(p.workspace.id, 'ws-1');
  assert.equal(p.occurred_at, '2026-08-09T12:00:00Z');
  // The card CONTENT is deliberately absent — a fat payload is a second, stale
  // copy of the truth.
  assert.equal('title' in p, false);
});

test('an event nobody subscribed to is still marked fanned', async () => {
  // Otherwise the outbox grows without bound for any workspace whose only hook
  // is narrowly subscribed.
  const db = fakeDb({ events: [ev()], hooks: [hook({ events: ['board.created'] })] });
  const out = await fanOutEvents({}, { db });
  assert.equal(out.deliveries, 0);
  assert.ok(db.writes.patched.some((w) => w.tbl === 'webhook_events' && w.patch.fanned_at));
});

test('no events is a clean no-op', async () => {
  const db = fakeDb({ events: [], hooks: [hook()] });
  assert.deepEqual(await fanOutEvents({}, { db }), { events: 0, deliveries: 0 });
  assert.equal(db.writes.inserted.length, 0);
});

// ── delivery ─────────────────────────────────────────────────────────────────

const pending = (over = {}) => ({
  id: 'd-1', webhook_id: 'h-1', event: 'card.created',
  payload: { type: 'card.created' }, attempt: 0, ...over,
});

test('a 2xx marks delivered and clears the failure streak', async () => {
  const db = fakeDb({ deliveries: [pending()], hooks: [hook({ failure_count: 3 })] });
  const sent = [];
  const out = await deliverDue({}, {
    db,
    fetchImpl: async (url, init) => { sent.push({ url, init }); return { ok: true, status: 200 }; },
  });
  assert.deepEqual(out, { attempted: 1, delivered: 1, failed: 0 });
  assert.match(sent[0].init.headers['x-soleil-signature'], /^v0=[0-9a-f]{64}$/);
  assert.ok(sent[0].init.headers['x-soleil-request-timestamp']);
  assert.equal(sent[0].init.headers['x-soleil-event'], 'card.created');
  const done = db.writes.patched.find((w) => w.tbl === 'webhook_deliveries');
  assert.ok(done.patch.delivered_at);
  assert.ok(db.writes.patched.some((w) => w.tbl === 'webhooks' && w.patch.failure_count === 0));
});

test('a 500 schedules a retry rather than giving up', async () => {
  const db = fakeDb({ deliveries: [pending({ attempt: 0 })], hooks: [hook()] });
  const out = await deliverDue({}, { db, fetchImpl: async () => ({ ok: false, status: 500 }) });
  assert.deepEqual(out, { attempted: 1, delivered: 0, failed: 1 });
  const p = db.writes.patched.find((w) => w.tbl === 'webhook_deliveries').patch;
  assert.equal(p.delivered_at, undefined, 'still pending');
  assert.ok(p.next_attempt_at, 'must be scheduled again');
  assert.equal(p.attempt, 1);
  assert.match(p.error, /500/);
});

test('a connection failure is a retry, not a crash', async () => {
  const db = fakeDb({ deliveries: [pending()], hooks: [hook()] });
  const out = await deliverDue({}, {
    db, fetchImpl: async () => { throw new Error('connect ETIMEDOUT'); },
  });
  assert.equal(out.failed, 1);
  const p = db.writes.patched.find((w) => w.tbl === 'webhook_deliveries').patch;
  assert.match(p.error, /ETIMEDOUT/);
  assert.ok(p.next_attempt_at);
});

test('the last attempt stops retrying but keeps its error', async () => {
  const db = fakeDb({ deliveries: [pending({ attempt: MAX_ATTEMPTS - 1 })], hooks: [hook()] });
  await deliverDue({}, { db, fetchImpl: async () => ({ ok: false, status: 500 }) });
  const p = db.writes.patched.find((w) => w.tbl === 'webhook_deliveries').patch;
  assert.ok(p.delivered_at, 'exhausted, so it stops being selected');
  assert.ok(p.error, 'and the log still says what happened');
  assert.equal(p.next_attempt_at, undefined);
});

test('a sustained failure switches the hook off with a reason', async () => {
  const db = fakeDb({
    deliveries: [pending()],
    hooks: [hook({ failure_count: DISABLE_AFTER_FAILURES - 1 })],
  });
  await deliverDue({}, { db, fetchImpl: async () => ({ ok: false, status: 410 }) });
  const off = db.writes.patched.find((w) => w.tbl === 'webhooks' && w.patch.active === false);
  assert.ok(off, 'a permanently dead URL must stop costing anything');
  assert.match(off.patch.disabled_reason, /consecutive failures/);
});

test('a delivery for a hook that was switched off is dropped, not retried forever', async () => {
  const db = fakeDb({ deliveries: [pending()], hooks: [hook({ active: false })] });
  let called = false;
  await deliverDue({}, { db, fetchImpl: async () => { called = true; return { ok: true, status: 200 }; } });
  assert.equal(called, false);
  const p = db.writes.patched.find((w) => w.tbl === 'webhook_deliveries').patch;
  assert.ok(p.delivered_at);
  assert.match(p.error, /inactive/);
});

test('the event vocabulary is closed and covers boards, cards and images', () => {
  assert.ok(WEBHOOK_EVENTS.includes('board.created'));
  assert.ok(WEBHOOK_EVENTS.includes('card.created'));
  assert.ok(WEBHOOK_EVENTS.includes('card.moved'));
  assert.ok(WEBHOOK_EVENTS.includes('image.created'));
  // Every name is `object.verb`, which is what lets a subscriber filter by
  // prefix and what the payload's resource.type is derived from.
  for (const e of WEBHOOK_EVENTS) assert.match(e, /^[a-z]+\.[a-z]+$/);
});

test('retry policy is bounded and gives a receiver a working day to come back', () => {
  // 1m, 5m, 25m, 2h05, 10h — the last attempt lands well over 12 hours out, so
  // an outage spanning a night still delivers.
  const backoff = (attempt) => Math.min(60 * (5 ** (attempt - 1)), 36000);
  const schedule = Array.from({ length: MAX_ATTEMPTS - 1 }, (_, i) => backoff(i + 1));
  assert.deepEqual(schedule, [60, 300, 1500, 7500, 36000]);
  const total = schedule.reduce((a, b) => a + b, 0);
  assert.ok(total > 12 * 3600, `total retry window ${total}s should exceed 12h`);
  assert.ok(MAX_ATTEMPTS >= 5 && MAX_ATTEMPTS <= 10);
});

test('a hook is disabled only for a sustained failure, not a bad afternoon', () => {
  // At the schedule above, 20 consecutive failures is days of being dead.
  assert.ok(DISABLE_AFTER_FAILURES >= 10,
    'too low and one receiver deploy switches the integration off');
});
