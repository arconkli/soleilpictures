// shareReturn.test.mjs — a sign-up that began on a /share page goes back there.
//
//   node --test src/lib/shareReturn.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseShareReturn, withShareReturn, shareReturnHref, stashShareReturn, readShareReturn, clearShareReturn } from './shareReturn.js';

const T = '0f9a5c3e-1b2d-4e5f-8a9b-0c1d2e3f4a5b';
function mem() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; }

test('parses the marker only beside a real share token', () => {
  assert.equal(parseShareReturn(new URL(`https://x/?share_token=${T}&back=share`)), T);
  assert.equal(parseShareReturn(new URL(`https://x/?share_token=${T}`)), null, 'no marker → no return');
  assert.equal(parseShareReturn(new URL('https://x/?share_token=not-a-uuid&back=share')), null);
  assert.equal(parseShareReturn(new URL('https://x/?back=share')), null);
  assert.equal(parseShareReturn(null), null);
});

test('builds the outbound and return hrefs', () => {
  assert.equal(withShareReturn('/?utm_source=share_link'), '/?utm_source=share_link&back=share');
  assert.equal(withShareReturn('/'), '/?back=share');
  assert.equal(shareReturnHref(T), `/share/${T}`);
  assert.equal(shareReturnHref('nope'), '/');
});

test('the stash round-trips and never throws on broken storage', () => {
  const s = mem();
  stashShareReturn(T, s);
  assert.equal(readShareReturn(s), T);
  clearShareReturn(s);
  assert.equal(readShareReturn(s), null);
  stashShareReturn('garbage', s);
  assert.equal(readShareReturn(s), null, 'only a uuid is ever stashed');
  const broken = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => { throw new Error('x'); } };
  stashShareReturn(T, broken); clearShareReturn(broken);
  assert.equal(readShareReturn(broken), null);
});
