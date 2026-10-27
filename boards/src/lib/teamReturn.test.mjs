import test from 'node:test';
import assert from 'node:assert/strict';
import { readTeamReturn, verifyWithRetry, VERIFY_RETRY_MS } from './teamReturn.js';

test('readTeamReturn reads only /team', () => {
  assert.equal(readTeamReturn('/', '?checkout=cs_1'), null);
  assert.equal(readTeamReturn('/team/new', ''), null);
  assert.deepEqual(readTeamReturn('/team', ''), { kind: 'open' });
  assert.deepEqual(readTeamReturn('/team/', ''), { kind: 'open' });
  assert.deepEqual(readTeamReturn('/team', '?checkout=cs_test_9'), { kind: 'checkout', sessionId: 'cs_test_9' });
  assert.deepEqual(readTeamReturn('/team', '?checkout=canceled'), { kind: 'canceled' });
  assert.deepEqual(readTeamReturn('/team', '?billing=1'), { kind: 'billing' });
  assert.deepEqual(readTeamReturn('/team', '?checkout=nope'), { kind: 'open' });
});

test('verifyWithRetry waits 2, 4, 8 s then gives up', async () => {
  const delays = [];
  let calls = 0;
  const verify = async () => { calls++; return { ok: false, error: 'not_complete' }; };
  const out = await verifyWithRetry(verify, 'cs_1', async (ms) => { delays.push(ms); });
  assert.deepEqual(delays, VERIFY_RETRY_MS);
  assert.equal(calls, 4);
  assert.equal(out.gaveUp, true);
});

test('verifyWithRetry returns the first settled answer', async () => {
  const delays = [];
  const answers = [{ ok: false, error: 'not_complete' }, { ok: true, created: true }];
  const out = await verifyWithRetry(async () => answers.shift(), 'cs_1', async (ms) => { delays.push(ms); });
  assert.deepEqual(delays, [2000]);
  assert.deepEqual(out, { ok: true, created: true });
  const bad = await verifyWithRetry(async () => ({ ok: false, error: 'network' }), 'cs_1', async () => { throw new Error('no wait'); });
  assert.equal(bad.error, 'network');
});
