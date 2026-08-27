// describeReason.test.mjs — rejection reasons must stay diagnosable.
//
//   node --test src/lib/describeReason.test.mjs
//
// Every case here is a shape that actually rejected in production and landed
// in client_errors as the literal string "Unhandled rejection: [object Object]"
// — a row with no code, no status, no URL and a stack pointing at the listener.
// The assertions are about information SURVIVING, so they check for the
// specific fields, not just that some string came out.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeReason } from './describeReason.js';

// ── real Errors pass through untouched ─────────────────────────────────

test('an Error is returned as-is so its stack survives', () => {
  const original = new TypeError('boom');
  const out = describeReason(original);
  assert.equal(out, original, 'must be the same object, not a copy');
  assert.equal(out.stack, original.stack);
});

test('an Error subclass is not rewrapped', () => {
  class Postgrestish extends Error {}
  const original = new Postgrestish('nope');
  assert.equal(describeReason(original), original);
});

// ── the shapes that used to stringify to [object Object] ───────────────

test('a Supabase PostgrestError keeps code, details and hint', () => {
  const out = describeReason({
    message: 'permission denied for table boards',
    code: '42501', details: 'RLS', hint: 'check policy',
  });
  assert.match(out.message, /permission denied for table boards/);
  assert.match(out.message, /code=42501/);
  assert.match(out.message, /details=RLS/);
  assert.match(out.message, /hint=check policy/);
  assert.equal(out.name, 'PostgrestError');
  assert.doesNotMatch(out.message, /\[object Object\]/);
});

test('a fetch Response keeps status and url', () => {
  const out = describeReason(new Response('', { status: 503, statusText: 'Service Unavailable' }));
  assert.match(out.message, /503/);
  assert.equal(out.name, 'HttpError');
  assert.doesNotMatch(out.message, /\[object Object\]/);
});

test('a socket CloseEvent keeps the close code', () => {
  const out = describeReason({ code: 1006, wasClean: false, reason: 'abnormal' });
  assert.match(out.message, /1006/);
  assert.match(out.message, /abnormal/);
  assert.equal(out.name, 'SocketClosed');
});

test('a plain object falls back to real JSON, not [object Object]', () => {
  const out = describeReason({ status: 'failed', attempt: 3 });
  assert.match(out.message, /"status":"failed"/);
  assert.match(out.message, /"attempt":3/);
  assert.doesNotMatch(out.message, /\[object Object\]/);
});

test('a circular object does not throw', () => {
  const a = { name: 'loop' };
  a.self = a;
  const out = describeReason(a);
  assert.ok(out instanceof Error);
  assert.match(out.message, /Circular/);
});

// ── degenerate inputs still produce a usable row ───────────────────────

test('Promise.reject() with no reason says undefined, and does not throw', () => {
  const out = describeReason(undefined);
  assert.ok(out instanceof Error);
  assert.match(out.message, /Unhandled rejection: undefined/);
});

test('null and primitives are reported verbatim', () => {
  assert.match(describeReason(null).message, /Unhandled rejection: null/);
  assert.match(describeReason('just a string').message, /just a string/);
  assert.match(describeReason(42).message, /42/);
});

// ── stack + prefix behaviour ───────────────────────────────────────────

test('a thrown non-Error carrying a stack keeps that stack, not the listener frame', () => {
  const out = describeReason({ message: 'thrown', stack: 'at theRealCallSite (app.js:1:1)' });
  assert.equal(out.stack, 'at theRealCallSite (app.js:1:1)');
});

test('the prefix is caller-supplied so non-rejection uses read correctly', () => {
  const out = describeReason({ message: 'nope' }, 'referral code');
  assert.match(out.message, /^referral code: nope/);
});

// ── the regression this module exists for ──────────────────────────────

test('no input shape produces the literal [object Object]', () => {
  const reasons = [
    {}, { a: 1 }, new Response('', { status: 500 }),
    { code: 1001, wasClean: true }, { message: 'x', code: 'PGRST116' },
    Object.create(null),
  ];
  for (const r of reasons) {
    assert.doesNotMatch(describeReason(r).message, /\[object Object\]/,
      `leaked [object Object] for ${JSON.stringify(Object.keys(r))}`);
  }
});
