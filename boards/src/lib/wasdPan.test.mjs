// W A S D movement (lib/wasdPan.js), and the wiring that keeps it opt-in.
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
  DEFAULT_WASD_PAN, getWasdPan, applyWasdPanNow, WASD_CODES, wasdCodeOf,
  wasdDirection, wasdStep, WASD_SPEED, WASD_FAST, WASD_EASE, WASD_REST,
} from './wasdPan.js';

const src = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const key = (code, over = {}) => ({ code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...over });

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

test('the four movement keys are physical positions, each with a direction', () => {
  assert.deepEqual(Object.keys(WASD_CODES).sort(), ['KeyA', 'KeyD', 'KeyS', 'KeyW']);
  for (const code of Object.keys(WASD_CODES)) assert.equal(wasdCodeOf(key(code)), code);
  // e.code, never e.key: on AZERTY the KeyW key prints "z", and it still moves.
  assert.equal(wasdCodeOf({ ...key('KeyW'), key: 'z' }), 'KeyW');
  // And the key PRINTED "a" there is KeyQ, which stays the Arrow tool's.
  assert.equal(wasdCodeOf({ ...key('KeyQ'), key: 'a' }), null);
  for (const other of ['KeyQ', 'KeyE', 'KeyV', 'Space', 'ArrowUp', 'Digit1', '', undefined]) {
    assert.equal(wasdCodeOf(key(other)), null, `${other} is not a movement key`);
  }
  assert.equal(wasdCodeOf(), null, 'no event at all');
});

test('Shift is the faster gear; ⌘, Ctrl and Alt are never movement', () => {
  assert.equal(wasdCodeOf(key('KeyD', { shiftKey: true })), 'KeyD');
  for (const code of Object.keys(WASD_CODES)) {
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
  assert.deepEqual(wasdDirection(new Set(['KeyQ'])), { x: 0, y: 0 });
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
});

test('the canvas: movement listener guards, and A and D stand down while it is on', () => {
  const c = src('../components/CanvasSurface.jsx');
  assert.match(c, /import \{ getWasdPan, wasdCodeOf, wasdDirection, wasdStep, WASD_SPEED, WASD_FAST, WASD_EASE, WASD_REST \} from '\.\.\/lib\/wasdPan\.js';/);
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
  assert.match(effect, /window\.addEventListener\('blur', onBlur\);\s+document\.addEventListener\('visibilitychange', onHidden\);/);
  assert.match(effect, /applyCanvasTransform\(true\);/, 'drawn in the frame it moves, ground included');
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
  assert.match(tab, /value=\{wasdPan\}/);
  assert.match(tab, /applyWasdPanNow\(v\);\s+setUi\(\{ wasdPan: v \}\);\s+try \{ logEvent\(EV\.WASD_PAN_SET, \{ on: v \}\); \} catch \(_\) \{\}/);
  // A new device learns it from the account, like the wheel.
  assert.match(src('../App.jsx'), /setWheelModeState\(applyWheelModeNow\(ui\.wheelMode\)\);[\s\S]{0,240}applyWasdPanNow\(ui\.wasdPan\);/);
  assert.match(src('../hooks/useResolvedDefaults.js'), /wasdPan: false,/);
  // The shortcuts overlay names it, and where to turn it on.
  assert.match(src('../components/ShortcutsOverlay.jsx'), /\[\['W', 'A', 'S', 'D'\], 'Move around, Shift for faster — turn on in Settings → Appearance'\]/);
});
