// captureIdentity.test.mjs — the persona, and the reason it is safe in prod.
//
// These functions are called from eight places in the signed-in app, including
// the name-resolution choke point every comment and message renders through.
// That is only an acceptable diff because of one property, which is the first
// thing asserted here: WITH CAPTURE OFF, EVERY FUNCTION RETURNS ITS INPUT BY
// IDENTITY. Not an equal copy — the same reference. An equal copy would still
// be a new object identity flowing through memoised React trees on every
// render, in production, for everyone.
//
// The second property is that masking actually masks: no output may contain any
// recognisable part of the real address. A persona that leaks the local part
// defeats the entire purpose while looking like it worked.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const cs = await import('./captureState.js');
const { maskName, maskEmail, maskProfile, personaFor, personaColor, PERSONAS } =
  await import('./captureIdentity.js');

const off = () => { cs.__resetForTests(); store.clear(); };
const on = () => { off(); cs.armCapture(true); cs.setCapture({ on: true, persona: true }); };

const REAL_EMAIL = 'andrew.conklin@soleilpictures.com';
const REAL_NAME = 'Andrew Conklin';

// ── Inert when off ─────────────────────────────────────────────────────────

test('with capture off, every masker returns its input BY IDENTITY', () => {
  off();
  const profile = { name: REAL_NAME, email: REAL_EMAIL, color: '#abc' };
  assert.equal(maskName(REAL_NAME), REAL_NAME);
  assert.equal(maskEmail(REAL_EMAIL), REAL_EMAIL);
  assert.equal(maskProfile('uid', profile), profile, 'a new object identity would re-render prod');
});

test('capture on but persona off is still inert', () => {
  off();
  cs.armCapture(true);
  cs.setCapture({ on: true, persona: false });
  assert.equal(maskEmail(REAL_EMAIL), REAL_EMAIL);
});

test('persona on but the master switch off is inert', () => {
  off();
  cs.armCapture(true);
  cs.setCapture({ on: false, persona: true });
  assert.equal(maskEmail(REAL_EMAIL), REAL_EMAIL);
});

test('an unarmed module cannot be talked into masking', () => {
  off();
  cs.setCapture({ on: true, persona: true });   // no-op: never armed
  assert.equal(maskEmail(REAL_EMAIL), REAL_EMAIL);
});

// ── Actually masks ─────────────────────────────────────────────────────────

test('nothing of the real address survives the mask', () => {
  on();
  const masked = maskEmail(REAL_EMAIL);
  assert.notEqual(masked, REAL_EMAIL);
  assert.ok(!masked.includes('andrew'), 'the local part leaked');
  assert.ok(!masked.includes('conklin'), 'the surname leaked');
  assert.ok(!masked.includes('soleilpictures'), 'the domain leaked');
  assert.ok(masked.includes('@'), 'the result must still read as an address on camera');
});

test('a real name is replaced, not merely reformatted', () => {
  on();
  const masked = maskName(REAL_NAME);
  assert.notEqual(masked, REAL_NAME);
  assert.ok(!masked.toLowerCase().includes('conklin'));
  assert.ok(masked.length > 2, 'an empty name reads as a broken build in a screenshot');
});

test('maskProfile replaces name, email and colour together', () => {
  on();
  const out = maskProfile('user-123', { name: REAL_NAME, email: REAL_EMAIL, color: '#ffa500', extra: 1 });
  assert.notEqual(out.name, REAL_NAME);
  assert.notEqual(out.email, REAL_EMAIL);
  assert.notEqual(out.color, '#ffa500', 'brand gold is reserved for your OWN selection');
  assert.equal(out.extra, 1, 'unrelated fields must survive');
});

// ── Stable ─────────────────────────────────────────────────────────────────

test('the same person is the same persona every time', () => {
  on();
  assert.equal(maskEmail(REAL_EMAIL), maskEmail(REAL_EMAIL));
  // Two rows in the share panel that are really one person must stay one
  // person on camera.
  assert.equal(maskEmail(REAL_EMAIL, 'uid-1'), maskEmail('other@x.com', 'uid-1'));
});

test('different people get different personas', () => {
  on();
  const seen = new Set();
  for (let i = 0; i < 8; i++) seen.add(personaFor(`user-${i}`).name);
  assert.ok(seen.size >= 4, `only ${seen.size} distinct personas across 8 users — too much collision`);
});

test('personaColor comes from the app palette and never brand gold', () => {
  on();
  for (let i = 0; i < 40; i++) {
    const c = personaColor(`seed-${i}`);
    assert.match(c, /^#[0-9a-f]{6}$/i);
    assert.notEqual(c.toLowerCase(), '#ffa500');
  }
});

// ── Edges ──────────────────────────────────────────────────────────────────

test('empty and missing values pass through rather than inventing a person', () => {
  on();
  assert.equal(maskName(''), '');
  assert.equal(maskName(null), null);
  assert.equal(maskEmail(undefined), undefined);
  assert.equal(maskProfile('u', null), null);
});

test('every persona is complete — no half-filled cast member', () => {
  for (const p of PERSONAS) {
    assert.ok(p.name && p.name.includes(' '), `"${p.name}" is not a full name`);
    assert.match(p.email, /^[^@]+@[^@]+\.[^@]+$/);
  }
});
