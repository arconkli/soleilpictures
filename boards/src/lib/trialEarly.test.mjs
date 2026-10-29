// trialEarly.test.mjs — the trial_early test, server and client held equal.
//
//   node --test src/lib/trialEarly.test.mjs
//
// The edge (supabase/functions/_shared/trialEarly.mjs) decides the arm from the
// JWT user id; the client (lib/trialEarly.js via experiments.js) decides the
// same arm to show the offer. This file keeps the two in lockstep.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import * as server from '../../../supabase/functions/_shared/trialEarly.mjs';
import * as client from './trialEarly.js';
import { EXPERIMENTS, assignArm } from './experiments.js';

const here = new URL('.', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, here), 'utf8');

test('the server switch equals the registry switch', () => {
  assert.equal(server.TRIAL_EARLY_ON, EXPERIMENTS.trial_early.enabled,
    'flip TRIAL_EARLY_ON and EXPERIMENTS.trial_early.enabled together');
});

test('the key and the arms are the same on both sides', () => {
  assert.equal(server.TRIAL_EARLY_KEY, client.TRIAL_EARLY_KEY);
  assert.deepEqual(server.TRIAL_EARLY_ARMS, EXPERIMENTS.trial_early.arms);
});

test('server and client pick the same arm for every id, about half and half', () => {
  const was = EXPERIMENTS.trial_early.enabled;
  EXPERIMENTS.trial_early.enabled = true;
  try {
    const N = 2000;
    let b = 0;
    for (let i = 0; i < N; i += 1) {
      const id = randomUUID();
      const pick = server.trialEarlyPick(id);
      assert.equal(pick, assignArm('trial_early', id), `server pick matches assignArm for ${id}`);
      assert.equal(client.trialEarlyArm(id), pick, `client arm matches for ${id}`);
      if (pick === 'B') b += 1;
    }
    const share = b / N;
    assert.ok(share > 0.45 && share < 0.55, `B share ${share} is about half`);
    assert.equal(server.trialEarlyPick(''), null);
    assert.equal(server.trialEarlyPick(null), null);
  } finally {
    EXPERIMENTS.trial_early.enabled = was;
  }
});

test('while the test is off nobody is in B, on either side', () => {
  if (!server.TRIAL_EARLY_ON) {
    const id = randomUUID();
    assert.equal(server.trialEarlyArm(id), null);
    assert.equal(client.trialEarlyArm(id), null);
    assert.equal(client.trialEarlyOn(id), false);
  }
});

test('the edge decides the arm from the JWT user id and passes it to the rule and the session', () => {
  const src = read('../../../supabase/functions/create-checkout-session/index.ts');
  assert.match(src, /import \{ trialEarlyArm \} from "\.\.\/_shared\/trialEarly\.mjs"/);
  assert.match(src, /creatorTrialEligibility\(\{[^}]*\bearly:\s*earlyArm === "B"[^}]*\}\)/,
    'eligibility takes early from the edge-decided arm, never the request body');
  assert.ok(src.includes('exp_trial_early'), 'the checkout session metadata names the arm');
});

// ── The stamp (same contract as setupGate.stampSetupArm) ────────────────────

function mem() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m };
}

// The server's answers, in order: { error } objects, rejections, throws.
function rpcOf(...answers) {
  const calls = [];
  const rpc = () => {
    const a = answers[Math.min(calls.length, answers.length - 1)];
    calls.push(a);
    if (a === 'throw') throw new Error('offline');
    if (a === 'reject') return { then: (_ok, fail) => fail(new Error('offline')) };
    return { then: (ok) => ok(a) };   // a thenable, like the PostgREST builder
  };
  return { rpc, calls };
}
const noWait = async () => {};

test('the arm is marked and logged once the server has it, and only once', async () => {
  const s = mem();
  const logs = [];
  const { rpc, calls } = rpcOf({ error: null });
  assert.equal(await client.stampTrialEarlyArm({ uid: 'me', arm: 'B', rpc, storage: s, log: () => logs.push(1), wait: noWait }), 'stamped');
  assert.equal(s.getItem(`${client.TRIAL_EARLY_MARK_PREFIX}me`), 'B');
  assert.equal(logs.length, 1);
  assert.equal(await client.stampTrialEarlyArm({ uid: 'me', arm: 'B', rpc, storage: s, log: () => logs.push(1), wait: noWait }), 'already');
  assert.equal(calls.length, 1, 'a stamped account is never stamped again');
  assert.equal(logs.length, 1);
});

test('a failed stamp is tried again, and never marked or logged until it lands', async () => {
  const s = mem();
  const logs = [];
  const flaky = rpcOf({ error: { message: 'Failed to fetch' } }, 'reject', { error: null });
  assert.equal(await client.stampTrialEarlyArm({ uid: 'me', arm: 'A', rpc: flaky.rpc, storage: s, log: () => logs.push(1), wait: noWait }), 'stamped');
  assert.equal(flaky.calls.length, 3);
  assert.equal(logs.length, 1);

  const s2 = mem();
  const down = rpcOf('throw');
  const waits = [];
  assert.equal(await client.stampTrialEarlyArm({ uid: 'you', arm: 'A', rpc: down.rpc, storage: s2, log: () => logs.push(1), wait: async (ms) => { waits.push(ms); } }), 'failed');
  assert.equal(down.calls.length, 3);
  assert.deepEqual(waits, [3000, 3000], 'a pause between tries, none after the last');
  assert.equal(s2.getItem(`${client.TRIAL_EARLY_MARK_PREFIX}you`), null, 'unmarked, so the next load tries again');
  assert.equal(logs.length, 1, 'no enrollment logged for a stamp that never landed');
});

test('the stamp works without storage, and refuses to run without an account or an arm', async () => {
  const { rpc, calls } = rpcOf({ error: null });
  assert.equal(await client.stampTrialEarlyArm({ uid: 'me', arm: 'B', rpc, storage: null, wait: noWait }), 'stamped');
  assert.equal(await client.stampTrialEarlyArm({ uid: null, arm: 'B', rpc, wait: noWait }), 'failed');
  assert.equal(await client.stampTrialEarlyArm({ uid: 'me', arm: null, rpc, wait: noWait }), 'failed');
  assert.equal(calls.length, 1);
});

test('its mark is its own, not the setup test\'s', async () => {
  const { STAMP_MARK_PREFIX } = await import('./setupGate.js');
  assert.ok(client.TRIAL_EARLY_MARK_PREFIX.startsWith('soleil.trialEarly.'));
  assert.notEqual(client.TRIAL_EARLY_MARK_PREFIX, STAMP_MARK_PREFIX);
  const s = mem();
  await client.stampTrialEarlyArm({ uid: 'me', arm: 'B', rpc: rpcOf({ error: null }).rpc, storage: s, wait: noWait });
  const keys = [...s._m.keys()];
  assert.equal(keys.length, 1);
  assert.ok(keys[0].startsWith(client.TRIAL_EARLY_MARK_PREFIX));
  assert.ok(!keys[0].startsWith(STAMP_MARK_PREFIX));
});
