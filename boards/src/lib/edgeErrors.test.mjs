// edgeErrors.test.mjs — an edge function's failures as client_errors rows
// (supabase/functions/_shared/errorRowCore.mjs, imported directly): what they
// say, what they never say, how often, and that every function records the
// 5xx it answers.
//
//   node --test src/lib/edgeErrors.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import {
  edgeErrorRow, makeEdgeErrorState, describeEdgeError, scrubEdgeText, failureWords as edgeWords,
} from '../../../supabase/functions/_shared/errorRowCore.mjs';
import { failureWords, ERROR_CONTEXT_KEYS, ERROR_HTTP_KEYS } from './errorCore.js';

const FUNCTIONS = new URL('../../../supabase/functions/', import.meta.url).pathname;
const read = (f) => readFileSync(FUNCTIONS + f, 'utf8');
const post = { method: 'POST', url: 'https://ehlhlmbpwwalmeisvmdp.supabase.co/functions/v1/x?email=a%40b.co' };

test("a failure reads alike from every source: the browser's words", () => {
  for (const pg of ['57014', '42501', '23505', '23503', '23502', '23514', '22P02', '42P01', '42883', '42703',
    '42P10', '40001', '40P01', '53300', '53400', 'P0001', 'PGRST116', 'PGRST202', 'PGRST204', 'PGRST301', 'PGRST303']) {
    assert.equal(edgeWords(500, pg), failureWords(500, pg), pg);
  }
  for (const s of [0, 400, 401, 403, 404, 405, 406, 408, 409, 413, 415, 422, 429, 500, 502, 503, 504, 507, 418]) {
    assert.equal(edgeWords(s), failureWords(s), String(s));
  }
});

test("a database error is its code, never what it quoted", () => {
  const row = edgeErrorRow('stripe-webhook', {
    what: 'insert discount_redemptions',
    error: { message: 'duplicate key value violates unique constraint "x"', details: 'Key (email)=(person@example.com) already exists.', hint: null, code: '23505' },
  }, makeEdgeErrorState(), 0);
  assert.equal(row.source, 'edge');
  assert.equal(row.kind, 'stripe-webhook');
  assert.equal(row.severity, 'error');
  assert.equal(row.message, 'insert discount_redemptions: duplicate key (23505)');
  assert.equal(row.name, 'PostgrestError');
  assert.equal(row.stack, null);
  assert.equal(row.path, '/functions/v1/stripe-webhook');
  assert.equal(row.env, 'prod');
  assert.equal(row.user_agent, null);
  assert.deepEqual(row.context, { op: 'stripe-webhook', code: '23505', tag: 'insert discount_redemptions' });
  assert.doesNotMatch(JSON.stringify(row), /person@|example\.com|unique constraint/);
  assert.equal(describeEdgeError({ code: 'XX000', message: 'internal', details: null }).words, 'database error (XX000)');
  // A socket's code is not the database's.
  assert.doesNotMatch(describeEdgeError(Object.assign(new Error('Broken pipe'), { code: 'EPIPE' })).words, /database/);
});

test("a Stripe error is its type, code, status and parameter; a decline is the person's", () => {
  const ours = describeEdgeError({ type: 'StripeInvalidRequestError', code: 'resource_missing', statusCode: 404, param: 'customer',
    message: "No such customer: 'cus_Q1w2E3r4T5y6U7'", raw: { message: 'x' } });
  assert.equal(ours.words, 'stripe invalid request error resource_missing 404 (customer)');
  assert.equal(ours.severity, null);
  const declined = edgeErrorRow('storage-addon', { status: 502, request: post,
    error: { type: 'StripeCardError', code: 'card_declined', decline_code: 'insufficient_funds', statusCode: 402, message: 'Your card was declined.' } },
  makeEdgeErrorState(), 0);
  assert.equal(declined.severity, 'warning', 'no rule counts a decline');
  assert.equal(declined.message, 'stripe card error card_declined 402');
  assert.deepEqual(declined.context, { op: 'storage-addon', code: 'card_declined', http: { method: 'POST', svc: 'functions', route: 'storage-addon', status: 502 } });
  assert.equal(describeEdgeError({ type: 'StripeConnectionError', message: 'An error occurred with our connection to Stripe.' }).words, 'stripe connection error');
  assert.equal(describeEdgeError({ type: 'StripeAuthenticationError', statusCode: 401 }).words, 'stripe authentication error 401');
});

test('anything else loses its addresses, emails, quotes, ids and tokens', () => {
  const s = scrubEdgeText('error sending request for url (https://api.stripe.com/v1/customers?email=a@b.co): connection reset; '
    + 'Unexpected token \'h\', "hello my plan" is not valid JSON; for person@example.com on cus_Q1w2E3r4T5y6U7 '
    + 'at https://ehlhlmbpwwalmeisvmdp.supabase.co/rest/v1/profiles?id=eq.1 token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abc');
  assert.match(s, /request for url \(<stripe>\)/);
  assert.match(s, /"…" is not valid JSON/);
  assert.match(s, /<email>/);
  assert.match(s, /<stripe id>/);
  assert.match(s, /at <supabase>/);
  assert.match(s, /<token>/);
  assert.doesNotMatch(s, /hello my plan|person@|cus_Q1w2|eyJhbGci|profiles\?id|a@b\.co/);
  const timeout = edgeErrorRow('create-checkout-session', {
    what: 'stripe customers.create', error: Object.assign(new Error('Signal timed out.'), { name: 'TimeoutError' }),
  }, makeEdgeErrorState(), 0);
  assert.equal(timeout.message, 'stripe customers.create: timed out');
  const auth = describeEdgeError(Object.assign(new Error('User not found'), { name: 'AuthApiError', status: 404, code: 'user_not_found' }));
  assert.equal(auth.words, 'auth user_not_found 404');
});

test('a thrown error keeps its frames and loses its first line', () => {
  const e = new TypeError('Cannot read properties of undefined (reading \'id\') for "My Film"');
  e.stack = 'TypeError: Cannot read properties of undefined (reading \'id\') for "My Film"\n'
    + '    at handleCheckout (file:///var/tmp/sb-compile-edge-runtime/source/index.ts:140:22)\n'
    + '    at async file:///var/tmp/sb-compile-edge-runtime/source/index.ts:60:12';
  const row = edgeErrorRow('create-checkout-session', { error: e, request: post, status: 500, phase: 'tail', ms: 812.4 }, makeEdgeErrorState(), 0);
  assert.equal(row.name, 'TypeError');
  assert.equal(row.message, 'Cannot read properties of undefined (reading \'id\') for "…"');
  assert.match(row.stack, /^TypeError: Cannot read properties of undefined \(reading 'id'\) for "…"\n {4}at handleCheckout/);
  assert.deepEqual(row.context, { op: 'create-checkout-session', phase: 'tail', ms: 812,
    http: { method: 'POST', svc: 'functions', route: 'create-checkout-session', status: 500 } });
  assert.doesNotMatch(JSON.stringify(row), /My Film|a%40b/);
  for (const k of Object.keys(row.context)) assert.ok(ERROR_CONTEXT_KEYS.includes(k), `${k} survives 0580's allowlist`);
  for (const k of Object.keys(row.context.http)) assert.ok(ERROR_HTTP_KEYS.includes(k), `http.${k} survives too`);
});

test('a 5xx with nothing handed over says the answer', () => {
  const row = edgeErrorRow('delete-own-account', { status: 500, request: post }, makeEdgeErrorState(), 0);
  assert.equal(row.message, 'answered 500: server error');
  assert.equal(row.severity, 'error');
});

test('the same failure is written once a minute, and 30 a minute at most', () => {
  const state = makeEdgeErrorState();
  const info = { what: 'mirror subscription', error: { code: '57014', message: 'canceling statement', details: null } };
  assert.ok(edgeErrorRow('stripe-webhook', info, state, 0));
  assert.equal(edgeErrorRow('stripe-webhook', info, state, 30_000), null);
  // A minute later it is written again: 0581 emails payments at two failures
  // in an hour, and an edge isolate lives minutes.
  assert.ok(edgeErrorRow('stripe-webhook', info, state, 60_001));
  // A number in a message is the same failure.
  const s2 = makeEdgeErrorState();
  assert.ok(edgeErrorRow('gsc-sync', { error: new Error('page 3 failed') }, s2, 0));
  assert.equal(edgeErrorRow('gsc-sync', { error: new Error('page 4 failed') }, s2, 1), null);
  const s3 = makeEdgeErrorState();
  let n = 0;
  for (let i = 0; i < 50; i++) if (edgeErrorRow('gsc-sync', { what: `step ${'x'.repeat(i)}`, error: new Error('x') }, s3, 10)) n++;
  assert.equal(n, 30);
  assert.equal(edgeErrorRow('Not A Function', { error: new Error('x') }, makeEdgeErrorState(), 0), null);
});

test("0581's payments rule reads these rows by the function's name", () => {
  const breaking = readFileSync(new URL('../../../supabase/migrations/0581_only_breaking_problems_email.sql', import.meta.url), 'utf8');
  const rule = /e\.source = 'edge' and e\.severity in \('crash', 'error'\)\s+and e\.kind in \(([^)]*)\)\) then 'payments'/.exec(breaking);
  assert.ok(rule, 'the payments rule is still read');
  const kinds = [...rule[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
  assert.deepEqual(kinds.sort(), ['create-checkout-session', 'storage-addon', 'stripe-webhook', 'team-billing', 'verify-checkout-session']);
  for (const k of kinds) {
    assert.ok(existsSync(FUNCTIONS + `${k}/index.ts`), `${k} is a function`);
    assert.match(read(`${k}/index.ts`), new RegExp(`Deno\\.serve\\(reported\\("${k}", `), `${k} reports as ${k}`);
  }
});

test('in the payments functions, only what stops a payment can email', () => {
  // A 5xx answer is a payment failing, and the door records it. Of the
  // failures a function catches and carries on from, these can be errors,
  // which 0581 emails at two an hour; everything else there is a warning.
  const PAGES = {
    'stripe-webhook': ['checkout completed', 'signature verification'],
    'verify-checkout-session': ['stripe checkout.sessions.retrieve'],
    'create-checkout-session': [],
    'storage-addon': [],
    'team-billing': [],
  };
  for (const [fn, pages] of Object.entries(PAGES)) {
    const calls = [...read(`${fn}/index.ts`).matchAll(/reportEdgeError\("([a-z-]+)", \{([\s\S]*?)\}\);/g)];
    for (const [, kind] of calls) assert.equal(kind, fn, `${fn} reports as itself`);
    const can = calls.filter(([, , body]) => !/,\s*severity: "warning"\s*$/.test(body))
      .map(([, , body]) => /what: "([^"]+)"/.exec(body)?.[1]).sort();
    assert.deepEqual(can, pages, `${fn}: what can email`);
  }
  // A Stripe-shaped signature refused is our secret; any other header is
  // somebody else's request.
  assert.match(read('stripe-webhook/index.ts'), /severity: stripeShaped \? "error" : "warning"/);
});

// The three email functions wait for the update email (another session's
// hold), and backfill-image-refs only answers 410.
const UNWATCHED = new Set(['send-transactional-email', 'lifecycle-email-cron', 'billing-reconcile-cron', 'backfill-image-refs']);

test('every function records the 5xx it answers, by its own name', () => {
  const fns = readdirSync(FUNCTIONS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_') && existsSync(FUNCTIONS + `${d.name}/index.ts`))
    .map((d) => d.name);
  assert.ok(fns.length >= 20, 'the functions are still read');
  for (const fn of fns) {
    const src = read(`${fn}/index.ts`);
    if (UNWATCHED.has(fn)) { assert.doesNotMatch(src, /reportError\.ts/, `${fn} is left as it is`); continue; }
    assert.match(src, /import \{[^}]*\breported\b[^}]*\} from "\.\.\/_shared\/reportError\.ts";/, `${fn} imports the door`);
    assert.equal([...src.matchAll(/^Deno\.serve\(/gm)].length, 1, `${fn} serves once`);
    assert.match(src, new RegExp(`^Deno\\.serve\\(reported\\("${fn}", async \\(req(?:, info)?\\) => \\{`, 'm'), `${fn} serves through its door`);
  }
  // The door: a 5xx once, with the cause its answer carries; a throw
  // recorded, then thrown on.
  const door = read('_shared/reportError.ts');
  assert.match(door, /if \(res\.status >= 500\) \{\s*void reportEdgeError\(fn, \{ request: req, status: res\.status, ms: Date\.now\(\) - t0, \.\.\.CAUSES\.get\(res\) \}\);/);
  assert.match(door, /await reportEdgeError\(fn, \{ error: e, request: req, status: 500, phase: "tail", ms: Date\.now\(\) - t0 \}\);\s*throw e;/);
  assert.match(door, /signal: AbortSignal\.timeout\(5_000\)/);
  assert.match(door, /er\?\.waitUntil\?\.\(p\)/);
});
