// W A S D movement and Q / E zoom (lib/wasdPan.js), and the wiring that keeps
// them opt-in.
//
// Two things are worth failing a build over.
//
//   1. It is OFF unless somebody turned it on. A and D are the Arrow and
//      Free-draw keys for everyone else, and a default (or a corrupt cached
//      value) that quietly took them away would be a regression wearing a
//      feature's clothes.
//
//   2. A key pressed with ⌘, Ctrl or Alt is never a movement key. ⌘A and ⌘D are
//      select-all and duplicate, and macOS drops the keyup of a letter let go
//      while ⌘ is held, so a modified key that started a glide could never
//      stop it.
//
// The glide itself runs on the ?local=1 harness: tests/wasd-pan.spec.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_WASD_PAN, getWasdPan, applyWasdPanNow, WASD_CODES, ZOOM_CODES, wasdCodeOf,
  wasdDirection, wasdZoomDirection, wasdStep, wasdEase,
  WASD_SPEED, WASD_FAST, WASD_EASE, WASD_REST, WASD_ZOOM_RATE, WASD_ZOOM_REST,
} from './wasdPan.js';

const src = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const key = (code, over = {}) => ({ code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...over });
const SIX = ['KeyA', 'KeyD', 'KeyE', 'KeyQ', 'KeyS', 'KeyW'];

test('off by default, and only a real true turns it on', () => {
  assert.equal(DEFAULT_WASD_PAN, false);
  assert.equal(getWasdPan(), false, 'no storage at all (node) reads as off');
  for (const bogus of [undefined, null, '', 'true', 1, {}, [], 'on']) {
    assert.equal(applyWasdPanNow(bogus), false, `${JSON.stringify(bogus)} must not turn it on`);
    assert.equal(getWasdPan(), false);
  }
  assert.equal(applyWasdPanNow(true), true);
  assert.equal(getWasdPan(), true);
  assert.equal(applyWasdPanNow(false), false);
  assert.equal(getWasdPan(), false);
});

test('the six keys are physical positions: four that move, two that zoom', () => {
  assert.deepEqual(Object.keys(WASD_CODES).sort(), ['KeyA', 'KeyD', 'KeyS', 'KeyW']);
  assert.deepEqual(Object.keys(ZOOM_CODES).sort(), ['KeyE', 'KeyQ']);
  for (const code of SIX) assert.equal(wasdCodeOf(key(code)), code);
  // e.code, never e.key: on AZERTY the KeyW key prints "z", and it still moves.
  assert.equal(wasdCodeOf({ ...key('KeyW'), key: 'z' }), 'KeyW');
  // And the key printed "a" there is KeyQ: it zooms in.
  assert.equal(wasdCodeOf({ ...key('KeyQ'), key: 'a' }), 'KeyQ');
  for (const other of ['KeyR', 'KeyF', 'KeyV', 'Space', 'ArrowUp', 'Digit1', '', undefined]) {
    assert.equal(wasdCodeOf(key(other)), null, `${other} is not a movement key`);
  }
  assert.equal(wasdCodeOf(), null, 'no event at all');
});

test('Shift is the faster gear; ⌘, Ctrl and Alt are never movement', () => {
  assert.equal(wasdCodeOf(key('KeyD', { shiftKey: true })), 'KeyD');
  assert.equal(wasdCodeOf(key('KeyE', { shiftKey: true })), 'KeyE');
  for (const code of SIX) {
    for (const mod of ['metaKey', 'ctrlKey', 'altKey']) {
      assert.equal(wasdCodeOf(key(code, { [mod]: true })), null, `${mod} + ${code} belongs to a shortcut`);
      assert.equal(wasdCodeOf(key(code, { [mod]: true, shiftKey: true })), null);
    }
  }
  assert.ok(WASD_FAST > 1, 'Shift goes faster, not slower');
});

test('direction: one key straight, two at a right angle diagonal, opposites cancel', () => {
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  assert.deepEqual(wasdDirection(new Set(['KeyW'])), { x: 0, y: -1 }, 'W looks up the board');
  assert.deepEqual(wasdDirection(new Set(['KeyS'])), { x: 0, y: 1 });
  assert.deepEqual(wasdDirection(new Set(['KeyA'])), { x: -1, y: 0 });
  assert.deepEqual(wasdDirection(new Set(['KeyD'])), { x: 1, y: 0 });
  const diag = wasdDirection(new Set(['KeyW', 'KeyD']));
  assert.ok(near(Math.hypot(diag.x, diag.y), 1), 'a diagonal is not √2 faster');
  assert.ok(diag.x > 0 && diag.y < 0);
  assert.deepEqual(wasdDirection(new Set(['KeyW', 'KeyS'])), { x: 0, y: 0 });
  assert.deepEqual(wasdDirection(new Set(['KeyA', 'KeyD'])), { x: 0, y: 0 });
  assert.deepEqual(wasdDirection(new Set(['KeyW', 'KeyA', 'KeyD'])), { x: 0, y: -1 });
  assert.deepEqual(wasdDirection(new Set()), { x: 0, y: 0 });
  assert.deepEqual(wasdDirection(), { x: 0, y: 0 });
  assert.deepEqual(wasdDirection(new Set(['KeyQ', 'KeyE'])), { x: 0, y: 0 }, 'the zoom keys do not move');
});

test('zoom: Q in, E out, both at once neither, and the movement keys never zoom', () => {
  assert.equal(wasdZoomDirection(new Set(['KeyQ'])), 1);
  assert.equal(wasdZoomDirection(new Set(['KeyE'])), -1);
  assert.equal(wasdZoomDirection(new Set(['KeyQ', 'KeyE'])), 0);
  assert.equal(wasdZoomDirection(new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD'])), 0);
  assert.equal(wasdZoomDirection(new Set(['KeyD', 'KeyQ'])), 1, 'move and zoom together');
  assert.equal(wasdZoomDirection(new Set()), 0);
  assert.equal(wasdZoomDirection(), 0);
});

test('zoom rate: 2.5× a second, the whole 0.1–5 range in about four seconds, under two with Shift', () => {
  assert.ok(Math.abs(Math.exp(WASD_ZOOM_RATE) - 2.5) < 1e-9);
  const whole = Math.log(5 / 0.1) / WASD_ZOOM_RATE;
  assert.ok(whole > 3 && whole < 5, `${whole.toFixed(2)}s for the whole range`);
  assert.ok(whole / WASD_FAST < 2, 'Shift crosses it in under two seconds');
  // It eases in and out like the movement, and rests below its own line.
  let r = 0;
  for (let i = 0; i < 6; i += 1) r = wasdEase(r, WASD_ZOOM_RATE, 1 / 60);
  assert.ok(r > WASD_ZOOM_RATE * 0.7 && r <= WASD_ZOOM_RATE);
  let frames = 0;
  while (Math.abs(r) >= WASD_ZOOM_REST && frames < 600) { r = wasdEase(r, 0, 1 / 60); frames += 1; }
  assert.ok(frames > 3 && frames < 60, `${frames} frames to rest`);
});

test('easing: gets up to speed in about a tenth of a second, and comes to rest', () => {
  const target = { x: WASD_SPEED, y: 0 };
  let v = { x: 0, y: 0 };
  let prev = 0;
  for (let i = 0; i < 6; i += 1) {          // 6 frames at 60Hz = 100ms
    v = wasdStep(v, target, 1 / 60);
    assert.ok(v.x > prev && v.x <= WASD_SPEED, 'climbs toward the target, never past it');
    prev = v.x;
  }
  assert.ok(v.x > WASD_SPEED * 0.7, `most of the way there after 100ms (${v.x.toFixed(0)})`);
  // Let go: it eases to a stop below the rest line in well under a second.
  let frames = 0;
  while (Math.hypot(v.x, v.y) >= WASD_REST && frames < 600) { v = wasdStep(v, { x: 0, y: 0 }, 1 / 60); frames += 1; }
  assert.ok(frames > 3, 'not a dead stop');
  assert.ok(frames < 60, `at rest within a second (${frames} frames)`);
  assert.ok(WASD_EASE > 0);
});

test('Reduce Motion: no easing, and a frame of no time changes nothing', () => {
  assert.deepEqual(wasdStep({ x: 0, y: 0 }, { x: 900, y: -900 }, 1 / 60, 0), { x: 900, y: -900 });
  assert.deepEqual(wasdStep({ x: 900, y: 0 }, { x: 0, y: 0 }, 1 / 60, 0), { x: 0, y: 0 });
  assert.deepEqual(wasdStep({ x: 300, y: 0 }, { x: 900, y: 0 }, 0), { x: 300, y: 0 });
  assert.deepEqual(wasdStep({ x: 300, y: 0 }, { x: 900, y: 0 }, -1), { x: 300, y: 0 });
  assert.equal(wasdEase(0, WASD_ZOOM_RATE, 1 / 60, 0), WASD_ZOOM_RATE);
  assert.equal(wasdEase(0.5, 0, 0), 0.5);
});

test('the canvas: movement listener guards, and A and D stand down while it is on', () => {
  const c = src('../components/CanvasSurface.jsx');
  assert.match(c, /import \{\s+getWasdPan, wasdCodeOf, wasdDirection, wasdZoomDirection, wasdStep, wasdEase,\s+WASD_SPEED, WASD_FAST, WASD_EASE, WASD_REST, WASD_ZOOM_RATE, WASD_ZOOM_REST,\s+\} from '\.\.\/lib\/wasdPan\.js';/);
  // The listener: never on a public page, asks the module on every key (no
  // re-bind on a settings change), and the same guards as every canvas key.
  const start = c.indexOf('// ── W A S D: hold a key to move around the board');
  const end = c.indexOf('}, [isPublic, hasSplit, paneId]);', start);
  assert.ok(start > 0 && end > start, 'the movement effect is where it was');
  const effect = c.slice(start, end);
  assert.match(effect, /useEffect\(\(\) => \{\s+if \(isPublic\) return undefined;/);
  assert.match(effect, /if \(e\.metaKey \|\| e\.ctrlKey \|\| e\.altKey\) \{ held\.clear\(\); return; \}/);
  assert.match(effect, /if \(!getWasdPan\(\)\) return;\s+const code = wasdCodeOf\(e\);/);
  assert.match(effect, /if \(boardKeysBlocked\(\)\) return;\s+if \(hasSplit && getActivePane\(\) !== paneId\) return;\s+if \(isEditorTarget\(e\) \|\| inInfoDrawer\(e\)\) return;/);
  assert.match(effect, /if \(e\.target\?\.closest\?\.\('\.msg-panel'\)\) return;/, 'E edits a message there');
  assert.match(effect, /window\.addEventListener\('blur', onBlur\);\s+document\.addEventListener\('visibilitychange', onHidden\);/);
  assert.match(effect, /applyCanvasTransform\(true\);/, 'drawn in the frame it moves, ground included');
  // Zoom stays inside the canvas's limits, around the middle of the view.
  assert.match(effect, /Math\.max\(ZOOM_MIN, Math\.min\(ZOOM_MAX, z0 \* Math\.exp\(vz \* dt\)\)\)/);
  assert.match(effect, /const sx = wrapWHRef\.current\.w \/ 2, sy = wrapWHRef\.current\.h \/ 2;/);
  // Its own Reduce Motion read: nothing here may lean on the board ground's
  // reduceMotionMq, which production does not have, so a promote of this
  // effect alone cannot throw on the first key press.
  assert.match(effect, /const reduceMotion = window\.matchMedia\?\.\('\(prefers-reduced-motion: reduce\)'\) \?\? null;/);
  assert.doesNotMatch(effect, /reduceMotionMq/);
  // The shortcut handler: the movement keys return BEFORE the bare-key tools.
  const skip = c.indexOf('if (!isPublic && getWasdPan() && wasdCodeOf(e)) return;');
  const draw = c.indexOf("if (e.key === 'd' || e.key === 'D') { e.preventDefault(); setSelectedTool('draw'); return; }");
  const arrow = c.indexOf("if (e.key === 'a' || e.key === 'A') { e.preventDefault(); setSelectedTool('arrow'); return; }");
  assert.ok(skip > 0 && draw > skip && arrow > skip, 'A and D are skipped before they can pick a tool');
});

test('settings: the toggle applies at once and saves to the account', () => {
  const tab = src('../components/settings/AppearanceTab.jsx');
  assert.match(tab, /import \{ getWasdPan, applyWasdPanNow \} from '\.\.\/\.\.\/lib\/wasdPan\.js';/);
  assert.match(tab, /label="Move with W A S D"/);
  assert.match(tab, /desc="Hold W, A, S or D to move around a board and Q or E to zoom in or out, with Shift to go faster\./);
  assert.match(tab, /value=\{wasdPan\}/);
  assert.match(tab, /applyWasdPanNow\(v\);\s+setUi\(\{ wasdPan: v \}\);\s+try \{ logEvent\(EV\.WASD_PAN_SET, \{ on: v \}\); \} catch \(_\) \{\}/);
  // A new device learns it from the account, like the wheel.
  assert.match(src('../App.jsx'), /setWheelModeState\(applyWheelModeNow\(ui\.wheelMode\)\);[\s\S]{0,240}applyWasdPanNow\(ui\.wasdPan\);/);
  assert.match(src('../hooks/useResolvedDefaults.js'), /wasdPan: false,/);
  // The shortcuts overlay names both rows, and where to turn them on.
  const overlay = src('../components/ShortcutsOverlay.jsx');
  assert.match(overlay, /\[\['W', 'A', 'S', 'D'\], 'Move around, Shift for faster — turn on in Settings → Appearance'\]/);
  assert.match(overlay, /\[\['Q', 'E'\], 'Zoom in · out, with W A S D turned on'\]/);
});
