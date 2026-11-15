import test from 'node:test';
import assert from 'node:assert/strict';
import { createHaptics, createSnapTicker } from './haptics.js';

function setup(opts = {}) {
  const win = new EventTarget();
  const vibrations = [];
  const nav = opts.noVibrate ? {} : { vibrate: (p) => { vibrations.push(p); return true; } };
  const store = new Map();
  const storage = opts.badStorage
    ? { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } }
    : { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  const calls = [];
  const reject = !!opts.reject;
  const ret = (name) => (args) => { calls.push([name, args]); return reject ? Promise.reject(new Error('UNIMPLEMENTED')) : Promise.resolve(); };
  const plugin = {
    Haptics: {
      impact: ret('impact'), notification: ret('notification'),
      selectionStart: ret('selectionStart'), selectionChanged: ret('selectionChanged'),
    },
    ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM' },
    NotificationType: { Warning: 'WARNING' },
  };
  const capacitor = opts.native
    ? { isNativePlatform: () => true, isPluginAvailable: () => opts.pluginAvailable !== false }
    : { isNativePlatform: () => false, isPluginAvailable: () => false };
  const clock = { t: 1000 };
  const h = createHaptics({ win, nav, storage, capacitor, loadPlugin: async () => plugin, now: () => clock.t });
  const down = (pointerType) => { const e = new Event('pointerdown'); e.pointerType = pointerType; win.dispatchEvent(e); };
  const flush = () => new Promise((r) => setTimeout(r, 5));
  return { h, win, vibrations, calls, clock, down, flush, store };
}

test('mouse never buzzes, touch and pen do', () => {
  const s = setup();
  s.down('mouse');
  assert.equal(s.h.haptic('lift'), false);
  s.down('touch');
  assert.equal(s.h.haptic('lift'), true);
  s.clock.t += 100;
  s.down('pen');
  assert.equal(s.h.haptic('lift'), true);
  assert.equal(s.vibrations.length, 2);
});

test('keydown after touch stops buzzing', () => {
  const s = setup();
  s.down('touch');
  s.win.dispatchEvent(new Event('keydown'));
  assert.equal(s.h.haptic('tick'), false);
});

test('off switch blocks, notifies, and can be turned back on', () => {
  const s = setup();
  let n = 0;
  const off = s.h.subscribeHaptics(() => { n++; });
  s.down('touch');
  s.h.setHapticsEnabled(false);
  assert.equal(s.h.hapticsEnabled(), false);
  assert.equal(s.h.haptic('lift'), false);
  assert.equal(n, 1);
  s.h.setHapticsEnabled(true);
  assert.equal(s.h.hapticsEnabled(), true);
  assert.equal(s.h.haptic('lift'), true);
  assert.equal(n, 2);
  off();
  s.h.setHapticsEnabled(false);
  assert.equal(n, 2);
});

test('rate limit is 60 ms', () => {
  const s = setup();
  s.down('touch');
  assert.equal(s.h.haptic('tick'), true);
  s.clock.t += 10;
  assert.equal(s.h.haptic('tick'), false);
  s.clock.t += 51;
  assert.equal(s.h.haptic('tick'), true);
});

test('vibrate patterns per kind', () => {
  const s = setup();
  s.down('touch');
  const want = { tick: 10, lift: 15, delete: 15, drop: [18, 40, 18], warn: [22, 60, 22] };
  for (const [kind, pattern] of Object.entries(want)) {
    s.clock.t += 100;
    assert.equal(s.h.haptic(kind), true);
    assert.deepEqual(s.vibrations.at(-1), pattern);
  }
});

test('unknown kind returns false', () => {
  const s = setup();
  s.down('touch');
  assert.equal(s.h.haptic('nope'), false);
  assert.equal(s.h.haptic(undefined), false);
  assert.equal(s.vibrations.length, 0);
});

test('no vibrate and not native returns false', () => {
  const s = setup({ noVibrate: true });
  s.down('touch');
  assert.equal(s.h.haptic('lift'), false);
});

test('native shell maps kinds to the plugin, never vibrates', async () => {
  const s = setup({ native: true });
  s.down('touch');
  for (const kind of ['lift', 'drop', 'delete', 'warn', 'tick', 'tick', 'tick']) {
    s.clock.t += 100;
    assert.equal(s.h.haptic(kind), true);
    await s.flush();
  }
  assert.deepEqual(s.calls, [
    ['impact', { style: 'LIGHT' }],
    ['impact', { style: 'MEDIUM' }],
    ['impact', { style: 'LIGHT' }],
    ['notification', { type: 'WARNING' }],
    ['selectionStart', undefined],
    ['selectionChanged', undefined],
    ['selectionChanged', undefined],
    ['selectionChanged', undefined],
  ]);
  assert.equal(s.vibrations.length, 0);
});

test('plugin unavailable falls back to vibrate', () => {
  const s = setup({ native: true, pluginAvailable: false });
  s.down('touch');
  assert.equal(s.h.haptic('lift'), true);
  assert.equal(s.vibrations.length, 1);
  assert.equal(s.calls.length, 0);
});

test('rejecting plugin calls leave no unhandled rejection', async () => {
  const s = setup({ native: true, reject: true });
  let unhandled = 0;
  const onUnhandled = () => { unhandled++; };
  process.on('unhandledRejection', onUnhandled);
  s.down('touch');
  for (const kind of ['lift', 'tick', 'warn']) {
    s.clock.t += 100;
    assert.doesNotThrow(() => s.h.haptic(kind));
  }
  await s.flush();
  await s.flush();
  process.off('unhandledRejection', onUnhandled);
  assert.equal(unhandled, 0);
});

test('throwing storage is treated as on', () => {
  const s = setup({ badStorage: true });
  s.down('touch');
  assert.equal(s.h.hapticsEnabled(), true);
  assert.doesNotThrow(() => s.h.setHapticsEnabled(false));
  assert.equal(s.h.haptic('lift'), true);
});

test('importing the module with no window does not throw', async () => {
  const m = await import('./haptics.js');
  assert.equal(m.haptic('lift'), false);
  assert.equal(m.hapticsEnabled(), true);
  assert.equal(m.usesSwitchTrick(), false);
});

test('hapticsAvailable: vibrate, native plugin, iPhone switch; never an iPad', () => {
  const mk = (nav, capacitor, doc) => createHaptics({
    win: doc ? Object.assign(new EventTarget(), { document: doc }) : new EventTarget(),
    nav, storage: null,
    capacitor: capacitor || { isNativePlatform: () => false, isPluginAvailable: () => false },
    loadPlugin: async () => ({}), now: () => 0,
  });
  const switchDoc = { createElement: () => ({ switch: false }) };
  const app = (plugin) => ({ isNativePlatform: () => true, isPluginAvailable: () => plugin });
  assert.equal(mk({ vibrate() {} }).hapticsAvailable(), true);
  assert.equal(mk({}).hapticsAvailable(), false);
  assert.equal(mk({}, app(true)).hapticsAvailable(), true);
  assert.equal(mk({}, app(false)).hapticsAvailable(), false);
  assert.equal(mk({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' }, null, switchDoc).hapticsAvailable(), true);
  assert.equal(mk({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)', vibrate() {} }).hapticsAvailable(), false);
  assert.equal(mk({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 }, app(true)).hapticsAvailable(), false);
});

test('the hidden switch has no tabindex and never keeps focus', () => {
  const appended = [];
  const makeEl = () => {
    const el = new EventTarget();
    el.attrs = {}; el.style = {}; el.blurred = 0;
    el.setAttribute = (k, v) => { el.attrs[k] = v; };
    el.blur = () => { el.blurred++; };
    return el;
  };
  const doc = { getElementById: () => null, createElement: makeEl, body: { appendChild: (el) => appended.push(el) } };
  const win = Object.assign(new EventTarget(), { document: doc });
  const h = createHaptics({ win, nav: {}, storage: null, capacitor: { isNativePlatform: () => false }, loadPlugin: async () => ({}), now: () => 0 });
  const el = h.ensureHapticSwitch();
  assert.equal(appended.length, 1);
  assert.equal(el.id, 'soleil-haptic-switch');
  assert.equal(el.attrs.switch, '');
  assert.equal('tabindex' in el.attrs, false);
  el.dispatchEvent(new Event('focus'));
  assert.equal(el.blurred, 1);
  assert.equal(h.ensureHapticSwitch(), el);
});

test('snap ticker: once per new alignment, not for losing one, re-arms after 200ms', () => {
  let n = 0; let t = 0;
  const tick = createSnapTicker(() => { n++; }, () => t);
  const H = (xs = [], ys = []) => ({ xs: xs.map((x) => ({ x })), ys: ys.map((y) => ({ y })) });
  tick(H()); assert.equal(n, 0);
  tick(H([100])); assert.equal(n, 1);
  t += 16; tick(H([100])); assert.equal(n, 1);
  t += 16; tick(H([100], [50])); assert.equal(n, 2);
  t += 16; tick(H([100])); assert.equal(n, 2);
  t += 50; tick(H([100], [50])); assert.equal(n, 2);
  t += 16; tick(H([]));
  t += 300; tick(H([100])); assert.equal(n, 3);
  t += 16; tick(H([120])); assert.equal(n, 4);
  tick(null); assert.equal(n, 4);
});
