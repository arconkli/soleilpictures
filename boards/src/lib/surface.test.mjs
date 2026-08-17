// surface.test.mjs — the precedence order IS the design.
//
//   node --test src/lib/surface.test.mjs
//
// Every case here is a way per-surface time could be quietly wrong. A surface
// that wins when it shouldn't doesn't error — it just credits minutes to the
// wrong place, and the resulting chart looks entirely plausible.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSurface, surfaceBoardId, isPublicPath, SURFACES } from './surface.js';

const app = (over = {}) => ({
  pathname: '/', currentSurface: 'board', view: 'canvas',
  docOpen: false, settingsOpen: false, ...over,
});

test('the default signed-in surface is the canvas', () => {
  assert.equal(resolveSurface(app()), 'canvas');
});

test('the board view mode decides between canvas and list', () => {
  assert.equal(resolveSurface(app({ view: 'list' })), 'list');
  assert.equal(resolveSurface(app({ view: 'canvas' })), 'canvas');
});

test('home and tag surfaces are distinct from the board', () => {
  assert.equal(resolveSurface(app({ currentSurface: 'home' })), 'universe');
  assert.equal(resolveSurface(app({ currentSurface: 'tag' })), 'tag');
});

test('an open doc card occludes the canvas underneath it', () => {
  assert.equal(resolveSurface(app({ docOpen: true })), 'doc');
  assert.equal(resolveSurface(app({ docOpen: true, view: 'list' })), 'doc',
    'the doc is what is on screen, whatever the board view was');
});

test('settings outranks everything inside the app', () => {
  assert.equal(resolveSurface(app({ settingsOpen: true, docOpen: true })), 'settings');
  assert.equal(resolveSurface(app({ settingsOpen: true, currentSurface: 'home' })), 'settings');
});

test('a public route is never counted as app usage', () => {
  for (const p of ['/share/abc', '/c/my-board', '/explore', '/pricing', '/docs/api', '/legal/privacy']) {
    assert.equal(resolveSurface(app({ pathname: p })), 'public', `${p} should be public`);
  }
  assert.equal(resolveSurface(app({ pathname: '/share/x', settingsOpen: true })), 'public',
    'a public page is not the app, whatever state the app is in behind it');
});

test('"/" is the app, not a public page', () => {
  assert.equal(isPublicPath('/'), false,
    'for a signed-in user the root IS the product — treating it as public would erase most usage');
  assert.equal(resolveSurface(app({ pathname: '/' })), 'canvas');
});

test('a path that merely starts with a public word is still matched by prefix', () => {
  // '/pricing' and '/pricing/' both belong to the public funnel.
  assert.equal(isPublicPath('/pricing'), true);
  assert.equal(isPublicPath('/pricing/'), true);
  assert.equal(isPublicPath('/boards'), false);
});

test('isPublicPath tolerates junk instead of throwing into the emitter', () => {
  for (const bad of [null, undefined, 42, {}, '']) {
    assert.equal(isPublicPath(bad), false);
  }
  assert.equal(resolveSurface(), 'canvas', 'no arguments must not throw');
  assert.equal(resolveSurface({}), 'canvas');
});

test('every resolvable surface is in the published list', () => {
  const cases = [
    app(), app({ view: 'list' }), app({ docOpen: true }), app({ currentSurface: 'home' }),
    app({ currentSurface: 'tag' }), app({ settingsOpen: true }), app({ pathname: '/share/x' }),
  ];
  for (const c of cases) {
    assert.ok(SURFACES.includes(resolveSurface(c)), `${resolveSurface(c)} missing from SURFACES`);
  }
});

test('surfaces match the column constraint the RPC enforces', () => {
  // record_usage_slice rewrites anything outside /^[a-z_]{1,24}$/ to 'unknown',
  // so a surface name that fails this would silently stop being distinguishable.
  for (const s of SURFACES) {
    assert.match(s, /^[a-z_]{1,24}$/, `'${s}' would be normalised away server-side`);
  }
});

// ── board attribution ──────────────────────────────────────────────────

test('board-shaped surfaces keep the board id', () => {
  for (const s of ['canvas', 'list', 'doc']) {
    assert.equal(surfaceBoardId(s, 'b1'), 'b1');
  }
});

test('non-board surfaces drop it, so their time is not blamed on a board', () => {
  for (const s of ['universe', 'tag', 'settings', 'public']) {
    assert.equal(surfaceBoardId(s, 'b1'), null,
      `${s} time must not be attributed to whatever board was open behind it`);
  }
});

test('a missing board id stays null rather than becoming a string', () => {
  assert.equal(surfaceBoardId('canvas', null), null);
  assert.equal(surfaceBoardId('canvas', undefined), null);
  assert.equal(surfaceBoardId('canvas', ''), null);
});
