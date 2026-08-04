// checkoutErrors.test.mjs
//
// Unit test for checkoutErrorMessage. Run with:
//   cd boards && node src/lib/checkoutErrors.test.mjs
//
// Plain Node ESM, no test framework — exit code 0 on pass, non-zero on failure
// (matches demoCardCap.test.mjs). The mapper is pure, so no backend.

import { checkoutErrorMessage, checkoutSupportHref, SUPPORT_EMAIL } from './checkoutErrors.js';

let failed = 0;
let passed = 0;
function assert(cond, msg) {
  if (!cond) { console.error(`FAIL: ${msg}`); failed++; } else { passed++; }
}

// The whole point: a raw server/HTTP string must never reach the user.
const RAW_STRINGS = [
  'HTTP 500', 'HTTP 404', 'HTTP 400', 'already_subscribed', 'auth required',
  'invalid token', 'invalid json', 'POST only', 'no subscription found',
  "plan must be 'monthly' or 'annual'", 'Not signed in.',
  'No such price: price_1234', '', '   ', undefined, null,
];
for (const raw of RAW_STRINGS) {
  const out = checkoutErrorMessage(raw === undefined || raw === null ? raw : new Error(raw));
  assert(typeof out === 'string' && out.length > 12, `maps ${JSON.stringify(raw)} to real copy`);
  const leaked = typeof raw === 'string' && raw.trim() && out.includes(raw.trim());
  assert(!leaked, `does not echo the raw string ${JSON.stringify(raw)} back at the user`);
}

// Recoverable auth states tell the user to sign in.
for (const s of ['Not signed in.', 'auth required', 'invalid token']) {
  assert(/sign in/i.test(checkoutErrorMessage(new Error(s))), `${s} → tells the user to sign in`);
}

// already_subscribed is good news, not an error shout.
const already = checkoutErrorMessage(new Error('already_subscribed'));
assert(/already have Creator/i.test(already), 'already_subscribed reads as already-having-access');
assert(/Manage billing/i.test(already), 'already_subscribed points at Manage billing');

// Portal with no Stripe customer (comped accounts).
assert(
  /complimentary|no Stripe subscription/i.test(checkoutErrorMessage(new Error('no subscription found'))),
  'no subscription found explains comped access',
);

// Network failures get their own actionable line, not the generic server one.
for (const s of ['Failed to fetch', 'NetworkError when attempting to fetch resource', 'Load failed']) {
  assert(/connection/i.test(checkoutErrorMessage(new Error(s))), `${s} → connection copy`);
}

// 5xx and unmapped Stripe messages both fall to the generic line, which must
// name support so the user has somewhere to go.
for (const s of ['HTTP 500', 'No such price: price_1234']) {
  assert(checkoutErrorMessage(new Error(s)).includes(SUPPORT_EMAIL), `${s} → generic copy names support`);
}

// Accepts plain strings as well as Errors.
assert(
  checkoutErrorMessage('already_subscribed') === already,
  'a bare string maps the same as an Error carrying it',
);

// Support href is a well-formed, encoded mailto.
const href = checkoutSupportHref('Clusters: checkout failed', 'User: a@b.c');
assert(href.startsWith(`mailto:${SUPPORT_EMAIL}?subject=`), 'support href targets the support inbox');
assert(href.includes('&body=') && !href.includes(' '), 'support href encodes its body');

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
