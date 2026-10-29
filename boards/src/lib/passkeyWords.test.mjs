// passkeyWords.test.mjs — where passkeys show, what a failure says, and when
// the save offer is due (lib/passkeyWords.js, lib/passkeyGate.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passkeyCancelled, passkeyErrorWords, passkeyFailReason, passkeyDeviceLabel } from './passkeyWords.js';
import { passkeyHostOk, passkeyOfferDue } from './passkeyGate.js';

test('passkeys show only on the production host', () => {
  assert.equal(passkeyHostOk('clusters.soleilpictures.com'), true);
  assert.equal(passkeyHostOk('CLUSTERS.soleilpictures.com'), true);
  assert.equal(passkeyHostOk('localhost'), false);
  assert.equal(passkeyHostOk('soleil-boards.andrew.workers.dev'), false);
  assert.equal(passkeyHostOk('evilclusters.soleilpictures.com'), false);
  assert.equal(passkeyHostOk('clusters.soleilpictures.com.evil.io'), false);
  assert.equal(passkeyHostOk(''), false);
});

test('a closed or aborted ceremony says nothing', () => {
  const aborted = { code: 'ERROR_CEREMONY_ABORTED' };
  const closed = { code: 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY', cause: { name: 'NotAllowedError' } };
  const raw = Object.assign(new Error('x'), { name: 'AbortError' });
  for (const e of [aborted, closed, raw]) {
    assert.equal(passkeyCancelled(e), true);
    assert.equal(passkeyErrorWords(e), null);
    assert.equal(passkeyFailReason(e), 'cancelled');
  }
  assert.equal(passkeyErrorWords(null), null);
});

test('server codes become plain words', () => {
  assert.match(passkeyErrorWords({ code: 'webauthn_credential_not_found' }), /isn't on your account/);
  assert.match(passkeyErrorWords({ code: 'webauthn_challenge_expired' }), /too long/);
  assert.match(passkeyErrorWords({ code: 'passkey_disabled' }), /switched off/);
  assert.match(passkeyErrorWords({ code: 'too_many_passkeys' }), /Remove one/);
  assert.match(passkeyErrorWords({ code: 'webauthn_credential_exists' }), /already has a passkey/);
  assert.match(passkeyErrorWords({ code: 'x', cause: { name: 'InvalidStateError' } }), /already has a passkey/);
  assert.match(passkeyErrorWords({ status: 429 }), /Too many tries/);
  assert.match(passkeyErrorWords({ name: 'AuthRetryableFetchError', message: 'Failed to fetch' }), /Couldn't reach/);
  assert.match(passkeyErrorWords({ code: 'something_new' }), /use your email/);
  assert.match(passkeyErrorWords({ code: 'something_new' }, { saving: true }), /couldn't be saved/);
});

test('event reasons are short codes, never messages', () => {
  assert.equal(passkeyFailReason({ code: 'webauthn_verification_failed', message: 'a@b.co' }), 'webauthn_verification_failed');
  assert.equal(passkeyFailReason({ code: 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY', cause: { name: 'SecurityError' } }), 'SecurityError');
  assert.equal(passkeyFailReason({ message: 'someone@example.com' }), 'error');
  assert.equal(passkeyFailReason(null), 'error');
});

test('a new passkey is named after the device', () => {
  assert.equal(passkeyDeviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'), 'iPhone · Safari');
  assert.equal(passkeyDeviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'), 'Mac · Chrome');
  assert.equal(passkeyDeviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0'), 'Windows · Edge');
  assert.equal(passkeyDeviceLabel(''), 'Passkey');
});

test('the save offer is due right after a code sign-in on an older account, once', () => {
  const now = Date.parse('2026-10-29T12:00:00Z');
  const base = { otpAt: String(now - 30_000), createdAt: '2026-10-01T00:00:00Z', offered: false, hostname: 'clusters.soleilpictures.com', now };
  assert.equal(passkeyOfferDue(base), true);
  assert.equal(passkeyOfferDue({ ...base, offered: true }), false);
  assert.equal(passkeyOfferDue({ ...base, hostname: 'localhost' }), false);
  assert.equal(passkeyOfferDue({ ...base, otpAt: String(now - 5 * 60_000) }), false);   // a session restored later
  assert.equal(passkeyOfferDue({ ...base, otpAt: null }), false);                     // Number(null) is 0
  assert.equal(passkeyOfferDue({ ...base, otpAt: 'x' }), false);
  assert.equal(passkeyOfferDue({ ...base, createdAt: '2026-10-29T08:00:00Z' }), false); // first day
  assert.equal(passkeyOfferDue({ ...base, createdAt: undefined }), false);
});
