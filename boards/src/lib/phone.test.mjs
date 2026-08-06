// phone.test.mjs — plain-node unit tests for the Scout routing key.
//
//   node --test src/lib/phone.test.mjs
//
// This module has no imports at all, so it tests without a browser or a build.
// It is worth testing directly because its failure mode is invisible: a number
// that normalizes one way on the landing page and another way when Photon
// reports it doesn't error, it just quietly gives one person two accounts —
// with the invite stranded on a row their inbound message will never match.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHandle, isTextablePhone, formatPhone } from './phone.js';

test('every way a person types a US number collapses to one key', () => {
  const forms = [
    '+15551234567',
    '555 123 4567',
    '(555) 123-4567',
    '+1 555-123-4567',
    '15551234567',
    '  555.123.4567  ',
    '+1 (555) 123 4567',
  ];
  for (const f of forms) {
    assert.equal(normalizeHandle(f), '+15551234567', `${JSON.stringify(f)} must normalize`);
  }
});

test('the landing page and the provider agree on the same person', () => {
  // What someone types into the box, vs. what Photon reports for that sender.
  assert.equal(normalizeHandle('(555) 123-4567', 'US'), normalizeHandle('+15551234567', 'US'));
  assert.equal(normalizeHandle('07911 123456', 'GB'), normalizeHandle('+447911123456', 'GB'));
});

test('a country hint is what makes non-US numbers safe', () => {
  // Without the hint this UK mobile looks like a valid US number, and we would
  // text a complete stranger.
  assert.equal(normalizeHandle('07911123456', 'GB'), '+447911123456');
  assert.notEqual(normalizeHandle('07911123456', 'GB'), '+17911123456');
});

test('a number that already carries its country code is not doubled', () => {
  assert.equal(normalizeHandle('15551234567', 'US'), '+15551234567');
  assert.equal(normalizeHandle('447911123456', 'GB'), '+447911123456');
});

test('Italy keeps its leading zero; elsewhere it is a trunk prefix', () => {
  assert.equal(normalizeHandle('0212345678', 'IT'), '+390212345678');
  assert.equal(normalizeHandle('0612345678', 'FR'), '+33612345678');
});

test('emails and Apple IDs pass through lowercased', () => {
  assert.equal(normalizeHandle('Person@Example.com'), 'person@example.com');
});

test('an unguessable number gets a stable sentinel, never an invented one', () => {
  const out = normalizeHandle('12345');
  assert.ok(out.startsWith('unknown:'), `got ${out}`);
  // Stable: the same input must always produce the same routing key, or the
  // person gets a new account per message.
  assert.equal(out, normalizeHandle('1 23 45'));
});

test('isTextablePhone refuses everything we must not text', () => {
  assert.equal(isTextablePhone('+15551234567'), true);
  assert.equal(isTextablePhone('+447911123456'), true);
  // The sentinel is a routing key, not a phone number — texting it is impossible
  // and treating it as valid is how a signup silently never gets a message.
  assert.equal(isTextablePhone('unknown:12345'), false);
  assert.equal(isTextablePhone('person@example.com'), false);
  assert.equal(isTextablePhone('+1555'), false);              // too short
  assert.equal(isTextablePhone('+1234567890123456'), false);  // past E.164's 15 digits
  assert.equal(isTextablePhone(''), false);
  assert.equal(isTextablePhone(null), false);
});

test('isTextablePhone matches the CHECK in scout_request_invite exactly', () => {
  // The RPC enforces ^\+[1-9][0-9]{7,14}$. Anything this accepts and Postgres
  // rejects surfaces to the visitor as a generic server error instead of "check
  // the number", so the looser of the two is a bug even though nothing crashes.
  const sqlCheck = (s) => /^\+[1-9][0-9]{7,14}$/.test(s);
  const probes = [
    '+15551234567', '+447911123456', '+0123456789', '+123456789012345',
    '+1234567890123456', '+1555', '+', '+12345678', '+1234567',
  ];
  for (const p of probes) {
    assert.equal(isTextablePhone(p), sqlCheck(p), `disagreement on ${p}`);
  }
});

test('typed input round-trips through normalize into something textable', () => {
  for (const f of ['(555) 123-4567', '555 123 4567', '+44 7911 123456']) {
    assert.equal(isTextablePhone(normalizeHandle(f)), true, f);
  }
  // ...and a typo does not.
  assert.equal(isTextablePhone(normalizeHandle('55512')), false);
});

test('formatPhone prettifies NANP and leaves everything else alone', () => {
  assert.equal(formatPhone('+15550123456'), '+1 (555) 012-3456');
  assert.equal(formatPhone('+447911123456'), '+447911123456');
});
