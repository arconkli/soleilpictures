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

// ---- the single-file return (/f/<token>) ----
import { parseFileReturn, fileReturnHref, stashFileReturn, readFileReturn, clearFileReturn } from './shareReturn.js';

test('a file return needs back=file beside a real file token', () => {
  assert.equal(parseFileReturn(new URL(`https://x/?back=file&file_token=${T}&utm_source=file_share`)), T);
  assert.equal(parseFileReturn(new URL(`https://x/?file_token=${T}`)), null, 'no marker → no return');
  assert.equal(parseFileReturn(new URL(`https://x/?back=share&file_token=${T}`)), null, 'the share marker is not the file marker');
  assert.equal(parseFileReturn(new URL(`https://x/?back=file&share_token=${T}`)), null);
  assert.equal(parseFileReturn(new URL('https://x/?back=file&file_token=nope')), null);
  assert.equal(parseFileReturn(null), null);
  assert.equal(parseShareReturn(new URL(`https://x/?back=file&file_token=${T}`)), null, 'a file link never stashes a share return');
});

test('the file return href goes to /f/<token>, or home for garbage', () => {
  assert.equal(fileReturnHref(T), `/f/${T}`);
  assert.equal(fileReturnHref('../../x'), '/');
  assert.equal(fileReturnHref(null), '/');
});

test('the file stash round-trips, is its own key, and never throws', () => {
  const s = mem();
  const T2 = '1f9a5c3e-1b2d-4e5f-8a9b-0c1d2e3f4a5b';
  stashShareReturn(T, s);
  stashFileReturn(T2, s);
  assert.equal(readFileReturn(s), T2);
  assert.equal(readShareReturn(s), null, 'stashing a file return clears the share return (newest wins)');
  stashShareReturn(T, s);
  assert.equal(readFileReturn(s), null, 'stashing a share return clears the file return');
  assert.equal(readShareReturn(s), T);
  stashFileReturn(T2, s);
  clearFileReturn(s);
  assert.equal(readFileReturn(s), null);
  stashFileReturn('garbage', s);
  assert.equal(readFileReturn(s), null);
  const broken = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => { throw new Error('x'); } };
  stashFileReturn(T, broken); clearFileReturn(broken);
  assert.equal(readFileReturn(broken), null);
});
