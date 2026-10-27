// keepDraft.test.mjs — a draft's keep page (pages/KeepPage.jsx), its rules
// apart from React (P3b).
//
//   node --test src/lib/keepDraft.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  KEEP_BUNDLE_PATH, KeepBundleError, firstClusterOf, keepPath, hostName, fetchKeepBundle,
  keepFailure, roomLeft, deleteDay, signInWords, signupFirstSource, keepFailReason,
} from './keepDraft.js';
import { EV } from './analyticsEvents.js';
import { latestDefinition } from './migrationText.mjs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const TOKEN = '0a1b2c3d-0000-4000-8000-00000000aaaa';
const BOARD = '5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d';

test('the cluster to open first is ?b= when it is an id, and the address drops it for the main one', () => {
  assert.equal(firstClusterOf(`?b=${BOARD.toUpperCase()}`), BOARD);
  assert.equal(firstClusterOf(`?x=1&b=${BOARD}`), BOARD);
  for (const s of ['', '?b=', '?b=main', `?b=${BOARD}x`, '?b=../../etc', undefined]) assert.equal(firstClusterOf(s), null, String(s));
  assert.equal(keepPath(TOKEN, BOARD, BOARD), `/keep/${TOKEN}`);
  assert.equal(keepPath(TOKEN, null, BOARD), `/keep/${TOKEN}`);
  assert.equal(keepPath(TOKEN, 'other', BOARD), `/keep/${TOKEN}?b=other`);
});

test('the host by name, or none (mcp_drafts.host)', () => {
  assert.equal(hostName('chatgpt'), 'ChatGPT');
  assert.equal(hostName('claude'), 'Claude');
  for (const h of ['other', null, undefined, 'ChatGPT']) assert.equal(hostName(h), null);
  // The values 0705 stores.
  assert.match(read('../../../supabase/migrations/0705_mcp_drafts.sql'),
    /case when p_host in \('chatgpt', 'claude'\) then p_host else 'other' end/);
});

test('the bundle is asked for with the token in the body, never the address', async () => {
  const calls = [];
  const fake = (status, body, headers = {}) => async (url, init) => {
    calls.push({ url, init });
    return new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
  };
  const live = await fetchKeepBundle(TOKEN, BOARD, { fetchImpl: fake(200, { state: 'live', board: { id: BOARD } }) });
  assert.equal(live.state, 'live');
  assert.equal(calls[0].url, KEEP_BUNDLE_PATH);
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), { token: TOKEN, board_id: BOARD });
  assert.ok(!calls[0].url.includes(TOKEN));
  await fetchKeepBundle(TOKEN, null, { fetchImpl: fake(200, { state: 'live' }) });
  assert.deepEqual(JSON.parse(calls[1].init.body), { token: TOKEN });

  assert.equal((await fetchKeepBundle(TOKEN, null, { fetchImpl: fake(200, { state: 'kept', host: 'claude' }) })).state, 'kept');
  assert.equal((await fetchKeepBundle(TOKEN, null, { fetchImpl: fake(200, { state: 'expired' }) })).state, 'expired');
  assert.equal((await fetchKeepBundle(TOKEN, null, { fetchImpl: fake(404, { state: 'unknown' }) })).state, 'unknown');
  assert.equal((await fetchKeepBundle(TOKEN, null, { fetchImpl: fake(200, { state: 'weird' }) })).state, 'unknown');

  // Retryable: the page offers Retry, never "gone".
  await assert.rejects(fetchKeepBundle(TOKEN, null, { fetchImpl: fake(429, { code: 'rate_limited' }, { 'retry-after': '60' }) }),
    (e) => e instanceof KeepBundleError && e.status === 429 && e.retryAfter === 60);
  await assert.rejects(fetchKeepBundle(TOKEN, null, { fetchImpl: fake(503, {}) }), (e) => e.status === 503);
  await assert.rejects(fetchKeepBundle(TOKEN, null, { fetchImpl: async () => { throw new TypeError('offline'); } }),
    (e) => e instanceof KeepBundleError && e.status === 0);
});

test("keep_mcp_draft's refusals, as the page answers them", () => {
  assert.equal(keepFailure({ hint: 'draft_kept', code: '42501' }), 'kept');
  assert.equal(keepFailure({ hint: 'draft_expired', code: 'P0002' }), 'expired');
  assert.equal(keepFailure({ hint: 'draft_unknown', code: 'P0002' }), 'unknown');
  assert.equal(keepFailure({ hint: 'not_a_person', code: '42501' }), 'not_a_person');
  assert.equal(keepFailure({ code: '42501', message: 'this account is suspended' }), 'suspended');
  for (const e of [null, { code: '42501', message: 'sign in to keep a draft' }, { message: 'Failed to fetch' }, { code: '57014' }]) {
    assert.equal(keepFailure(e), 'retry', JSON.stringify(e));
  }
  // Every hint the function raises is one the page knows.
  const def = latestDefinition('keep_mcp_draft');
  const hints = [...new Set([...def.body.matchAll(/hint = '([a-z_]+)'/g)].map((m) => m[1]))].sort();
  assert.deepEqual(hints, ['draft_expired', 'draft_kept', 'draft_unknown', 'not_a_person']);
  assert.match(def.body, /raise exception 'this account is suspended' using errcode = '42501'/);
});

test('room left on the free plan, and the day an untouched draft goes', () => {
  assert.equal(roomLeft(32, 50), 18);
  assert.equal(roomLeft(60, 50), 0);
  assert.equal(roomLeft(10, null), null, 'no plan limit (keep_mcp_draft answers card_limit only for demo)');
  assert.equal(roomLeft(undefined, 50), null);
  assert.equal(deleteDay('2026-11-25T14:00:00+00:00', 'en-GB'), '25 Nov');
  assert.equal(deleteDay('2026-11-25T14:00:00+00:00', 'en-US'), 'Nov 25');
  assert.equal(deleteDay(null), null);
  assert.equal(deleteDay('soon'), null);
});

test("the sign-in words are the sign-in page's, word for word", () => {
  const bodyOf = (src, header) => {
    const at = src.indexOf(header);
    assert.ok(at >= 0, header);
    const end = src.indexOf('\n}\n', at);
    return src.slice(at + header.length, end)
      .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n').replace(/\s+/g, ' ').trim();
  };
  const gate = bodyOf(read('../auth/AuthGate.jsx'), 'function humanError(e, { resent = false } = {}) {');
  const keep = bodyOf(read('./keepDraft.js'), 'export function signInWords(e, { resent = false } = {}) {');
  assert.equal(keep, gate, "AuthGate's humanError changed: say the same in keepDraft.js signInWords");
  assert.equal(signInWords({ message: 'Token has expired or is invalid' }, { resent: true }),
    "That code didn't match. Only the newest code works — use the one in the latest email.");
  assert.equal(signInWords({ message: 'captcha verification process failed' }).startsWith("We couldn't confirm"), true);
});

test("a new account's first touch: the page's own bag, capped as the sign-in page caps it", () => {
  assert.equal(signupFirstSource({}), null);
  assert.equal(signupFirstSource(null), null);
  const bag = { landing_path: '/keep/:token', utm_source: 'chatgpt.com' };
  assert.equal(signupFirstSource(bag), JSON.stringify(bag));
  assert.equal(signupFirstSource({ referrer: 'x'.repeat(2100) }), null);
  assert.match(read('../auth/AuthGate.jsx'), /if \(json\.length <= 2000\) firstSourceMeta = json;/);
});

test('the page keeps the draft the way the database expects, and opens it where the app looks', () => {
  const page = read('../pages/KeepPage.jsx');
  assert.match(page, /await supabase\.rpc\('keep_mcp_draft', \{ p_token: token \}\);/);
  assert.doesNotMatch(page, /\.rpc\([^)]*\)\s*\.catch\(/, 'an rpc builder is a thenable; .catch swallows the query');
  assert.match(page, /href=\{kept\.boardId \? `\/\?to=b:\$\{kept\.boardId\}` : '\/'\}/);
  assert.match(read('./entityUrl.js'), /case 'b':\s+return \{ kind: 'board', id: rest \};/);
  // The token reaches the server in a body only.
  assert.doesNotMatch(page, /fetch\([^)]*token/);
  assert.match(page, /fetchKeepBundle\(token, /);
});

test("a failure's reason is a code, a status or 'network', never the words", () => {
  assert.equal(keepFailReason({ code: 'otp_expired', status: 403, message: 'Token has expired or is invalid' }), 'otp_expired');
  assert.equal(keepFailReason({ code: 'over_email_send_rate_limit', status: 429 }), 'over_email_send_rate_limit');
  assert.equal(keepFailReason(new KeepBundleError(503)), 'http_503');
  assert.equal(keepFailReason(new KeepBundleError(429, 60)), 'http_429');
  assert.equal(keepFailReason(new KeepBundleError(0)), 'network');
  assert.equal(keepFailReason(new TypeError('Failed to fetch')), 'network');
  // Anything that isn't a plain code falls back, so a typed address can't ride along.
  assert.equal(keepFailReason({ code: 'invalid for you@example.com', status: 400 }), 'http_400');
  assert.equal(keepFailReason({ code: '42501', message: 'sign in to keep a draft' }), 'error');
  assert.equal(keepFailReason({ status: null }), 'error');
  assert.equal(keepFailReason(null), 'error');
});

test('the page records its four steps, and never the token, the address or the draft', () => {
  const page = read('../pages/KeepPage.jsx');
  const calls = [...page.matchAll(/logEvent(?:Now|Once)?\(([\s\S]*?)\);/g)].map((m) => m[1]);
  assert.ok(calls.length >= 7, `found ${calls.length} event calls`);
  for (const c of calls) assert.doesNotMatch(c, /token|email|address|name|title/i, c);
  for (const key of ['KEEP_PAGE_VIEW', 'KEEP_CODE_SENT', 'KEEP_KEPT', 'KEEP_FAILED']) {
    assert.ok(EV[key], key);
    assert.match(page, new RegExp(`EV\\.${key}\\b`), `the page sends ${key}`);
  }
  // A view once per page load, StrictMode or not; kept beaconed, since Open it leaves the page.
  assert.match(page, /logEventOnce\('keep_view', EV\.KEEP_PAGE_VIEW,/);
  assert.match(page, /logEventNow\(EV\.KEEP_KEPT, \{ host: draft\?\.host \|\| 'other', via, beside_own: !!data\.beside_own \}\);/);
});
