// Self-test for worker-ring.js cookie mint/verify. Run: node scripts/ring-selftest.mjs
import {
  mintRingCookieValue, isRingCanary, ringSetCookieHeader, ringClearCookieHeader,
} from '../src/worker-ring.js';

const env = { RING_COOKIE_SECRET: 'test-secret-0123456789abcdef0123456789abcdef' };
const reqWith = (cookie) => ({ headers: { get: (k) => (k.toLowerCase() === 'cookie' ? cookie : null) } });

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.error('FAIL:', name); } };

const now = Math.floor(Date.now() / 1000);

// 1. fresh cookie verifies
const { value } = await mintRingCookieValue(env, 'user-1', now);
ok('fresh cookie verifies', await isRingCanary(reqWith(`soleil_ring=${value}`), env) === true);

// 2. survives other cookies around it
ok('verifies amid other cookies',
  await isRingCanary(reqWith(`ph_session=x; soleil_ring=${value}; theme=dark`), env) === true);

// 3. tampered signature fails
const tampered = value.slice(0, -2) + (value.slice(-2) === 'AA' ? 'BB' : 'AA');
ok('tampered signature fails', await isRingCanary(reqWith(`soleil_ring=${tampered}`), env) === false);

// 4. tampered payload fails
const [p, s] = value.split('.');
const badPayload = (p.slice(0, -2) === '' ? 'AAAA' : p.slice(0, -2) + 'ZZ') + '.' + s;
ok('tampered payload fails', await isRingCanary(reqWith(`soleil_ring=${badPayload}`), env) === false);

// 5. wrong secret fails
ok('wrong secret fails',
  await isRingCanary(reqWith(`soleil_ring=${value}`), { RING_COOKIE_SECRET: 'different-secret' }) === false);

// 6. expired cookie fails (mint with exp in the past)
const expired = await mintRingCookieValue(env, 'user-1', now - 8 * 24 * 60 * 60);
ok('expired cookie fails', await isRingCanary(reqWith(`soleil_ring=${expired.value}`), env) === false);

// 7. no cookie fails
ok('no cookie fails', await isRingCanary(reqWith(''), env) === false);
ok('missing cookie header fails', await isRingCanary(reqWith(null), env) === false);

// 8. missing secret in env fails (dormant)
ok('no secret configured fails', await isRingCanary(reqWith(`soleil_ring=${value}`), {}) === false);

// 9. header shapes
ok('set-cookie has HttpOnly+Secure+SameSite', /HttpOnly/.test(ringSetCookieHeader('x', 60)) && /Secure/.test(ringSetCookieHeader('x', 60)) && /SameSite=Lax/.test(ringSetCookieHeader('x', 60)));
ok('clear-cookie has Max-Age=0', /Max-Age=0/.test(ringClearCookieHeader()));

console.log(`\nworker-ring self-test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
