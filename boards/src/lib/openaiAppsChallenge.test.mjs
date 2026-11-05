// openaiAppsChallenge.test.mjs — the domain-verification path OpenAI's plugin
// portal fetches, and that the Worker really calls it before the generic
// /.well-known/ handling.
//
//   node --test src/lib/openaiAppsChallenge.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openaiAppsChallengeResponse, OPENAI_APPS_CHALLENGE_PATH } from './openaiAppsChallenge.js';

const env = { OPENAI_APPS_CHALLENGE: '  tok_abc123\n' };

test('other paths are not answered', () => {
  assert.equal(openaiAppsChallengeResponse('/.well-known/other', 'GET', env), null);
  assert.equal(openaiAppsChallengeResponse('/', 'GET', env), null);
  assert.equal(openaiAppsChallengeResponse(`${OPENAI_APPS_CHALLENGE_PATH}/`, 'GET', env), null);
});

test('an unset, non-string or blank secret answers nothing', () => {
  assert.equal(openaiAppsChallengeResponse(OPENAI_APPS_CHALLENGE_PATH, 'GET', undefined), null);
  assert.equal(openaiAppsChallengeResponse(OPENAI_APPS_CHALLENGE_PATH, 'GET', {}), null);
  assert.equal(openaiAppsChallengeResponse(OPENAI_APPS_CHALLENGE_PATH, 'GET', { OPENAI_APPS_CHALLENGE: 42 }), null);
  assert.equal(openaiAppsChallengeResponse(OPENAI_APPS_CHALLENGE_PATH, 'GET', { OPENAI_APPS_CHALLENGE: ' \n\t ' }), null);
});

test('only GET and HEAD are answered', () => {
  assert.equal(openaiAppsChallengeResponse(OPENAI_APPS_CHALLENGE_PATH, 'POST', env), null);
});

test('GET returns exactly the trimmed token as plain text', async () => {
  const res = openaiAppsChallengeResponse(OPENAI_APPS_CHALLENGE_PATH, 'GET', env);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'tok_abc123');
  assert.equal(res.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('HEAD returns 200 with an empty body', async () => {
  const res = openaiAppsChallengeResponse(OPENAI_APPS_CHALLENGE_PATH, 'HEAD', env);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '');
});

test('the Worker calls it inside the /.well-known/ block, before the generic handler', () => {
  const src = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
  assert.match(src, /import \{ openaiAppsChallengeResponse \} from '\.\/lib\/openaiAppsChallenge\.js'/);
  const block = src.indexOf("if (url.pathname.startsWith('/.well-known/'))");
  assert.ok(block > -1, 'the /.well-known/ block exists');
  const call = src.indexOf('openaiAppsChallengeResponse(url.pathname, request.method, env)');
  const generic = src.indexOf('wellKnownResponse(url, request.method)', block);
  assert.ok(call > block, 'the challenge is checked inside the block');
  assert.ok(generic > call, 'and before the generic /.well-known/ handler');
});
