// signedImage.test.mjs — a picture's address without a session (P3b's keep
// page; later P3's inline view).
//
//   node --test src/lib/signedImage.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  imageSecret, signImageKey, verifySignedImage, servedTypeFor, SIGNED_IMAGE_PATH, SIGNED_IMAGE_TTL_S,
} from './signedImage.js';

const KEY = 'u/5a4b3c2d/1e0f/photo one.jpg';
const NOW = 1_800_000_000;

test('an address opens its one key until its time, and says which key and when', async () => {
  const secret = await imageSecret('service-key');
  const signed = await signImageKey(secret, KEY, NOW + 60);
  assert.match(signed, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/, 'base64url payload, a 128-bit signature');
  assert.deepEqual(await verifySignedImage(secret, signed, NOW), { key: KEY, expiresAt: NOW + 60 });
  assert.equal(await verifySignedImage(secret, signed, NOW + 60), null, 'not at its last second');
  assert.equal(await verifySignedImage(secret, signed, NOW + 3600), null);
  assert.equal(SIGNED_IMAGE_PATH, '/api/img/');
  assert.equal(SIGNED_IMAGE_TTL_S, 3600);
});

test('nothing but the exact signed address opens anything', async () => {
  const secret = await imageSecret('service-key');
  const signed = await signImageKey(secret, KEY, NOW + 60);
  const [payload, sig] = signed.split('.');
  const other = await signImageKey(secret, 'u/someone/else.jpg', NOW + 60);
  const flip = (s, i) => s.slice(0, i) + (s[i] === 'A' ? 'B' : 'A') + s.slice(i + 1);
  for (const forged of [
    `${other.split('.')[0]}.${sig}`,                     // another key under this signature
    `${payload}.${flip(sig, 3)}`,                         // one character of the signature
    `${flip(payload, 5)}.${sig}`,                         // one character of the payload
    `${payload}.${sig.slice(0, -2)}`,                     // a shorter signature
    `${payload}`, `.${sig}`, '', 'x.y', `${payload}.${sig}=`, `${payload}.${sig}/`,
    `${'a'.repeat(2100)}.${sig}`,                         // past the length any key needs
  ]) {
    assert.equal(await verifySignedImage(secret, forged, NOW), null, forged.slice(0, 40));
  }
  assert.equal(await verifySignedImage(secret, null, NOW), null);
  // Another service key (a rotation) retires every address.
  assert.equal(await verifySignedImage(await imageSecret('rotated'), signed, NOW), null);
});

test('a payload that verifies must still be a key and a whole second', async () => {
  const secret = await imageSecret('service-key');
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  // Sign an arbitrary payload the way signImageKey signs its own.
  const sign = async (payload) => {
    const sig = (await crypto.subtle.sign('HMAC', secret, new TextEncoder().encode(payload))).slice(0, 16);
    return `${payload}.${Buffer.from(sig).toString('base64url')}`;
  };
  for (const p of [{ k: '', e: NOW + 60 }, { k: 7, e: NOW + 60 }, { k: KEY, e: NOW + 60.5 }, { k: KEY, e: String(NOW + 60) }, { k: KEY }]) {
    assert.equal(await verifySignedImage(secret, await sign(b64(p)), NOW), null, JSON.stringify(p));
  }
  assert.deepEqual(await verifySignedImage(secret, await sign(b64({ k: KEY, e: NOW + 60 })), NOW), { key: KEY, expiresAt: NOW + 60 });
  await assert.rejects(signImageKey(secret, '', NOW), /no key/);
  await assert.rejects(imageSecret(''), /SUPABASE_SERVICE_ROLE_KEY/);
});

test('only pictures, video and sound go out to be shown; anything else is a download', () => {
  assert.deepEqual(servedTypeFor('a/b.jpg', 'image/jpeg'), { type: 'image/jpeg', inline: true });
  assert.deepEqual(servedTypeFor('a/b', 'video/mp4'), { type: 'video/mp4', inline: true });
  assert.deepEqual(servedTypeFor('a/b.WEBP', null), { type: 'image/webp', inline: true });
  assert.deepEqual(servedTypeFor('a/b.m4a', ''), { type: 'audio/mp4', inline: true });
  // What a browser would run, by type or by name, is bytes to save.
  for (const [key, type] of [['a/b.html', 'text/html'], ['a/b.js', 'text/javascript'], ['a/b.pdf', 'application/pdf'],
    ['a/b.jpg', 'text/html'], ['a/page', undefined], ['a/b.xml', 'application/xml'], ['a/b.svg', 'image/svg+xml; charset=utf-8']]) {
    const served = servedTypeFor(key, type);
    if (key.endsWith('.svg') || key.endsWith('.jpg')) assert.equal(served.inline, true, `${key} by its name`);
    else assert.deepEqual(served, { type: 'application/octet-stream', inline: false }, `${key} ${type}`);
  }
  assert.equal(servedTypeFor('a/b.jpg', 'text/html').type, 'image/jpeg', 'a recorded type that is not media is not trusted');
});
