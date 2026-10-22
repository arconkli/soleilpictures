import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GROUND_STEPS, smoothstep, dotRadius, dotLevels, lineLevels, parseColor,
  cameraFromTransform, isWheelClick, glideZoom, GLIDE_MS,
} from './canvasGround.js';

test('steps are four times apart', () => {
  for (let i = 1; i < GROUND_STEPS.length; i++) assert.equal(GROUND_STEPS[i] / GROUND_STEPS[i - 1], 4);
  assert.equal(smoothstep(9, 18, 9), 0);
  assert.equal(smoothstep(9, 18, 18), 1);
});

test('at 100% the dots are 20 apart, with the 80 and 320 points stacked brighter and a little bigger', () => {
  const lv = dotLevels(1);
  assert.deepEqual(lv.map((l) => l.step).slice(0, 3), [20, 80, 320]);
  assert.ok(lv.slice(0, 3).every((l) => l.a === 1), 'the steps in view are fully in');
  assert.equal(lv[0].r, 1);
  assert.ok(lv[1].r > lv[0].r && lv[2].r > lv[1].r, 'coarser points are bigger');
  assert.equal(lineLevels(1).length, 1);
  assert.equal(lineLevels(1)[0].step, 80, 'one grid, every four dots');
});

test('the finest dots on screen are never closer than 9px, at any zoom', () => {
  for (let z = 0.1; z <= 5; z *= 1.07) {
    const lv = dotLevels(z);
    assert.ok(lv.length > 0, `something shows at ${z.toFixed(2)}`);
    assert.ok(lv[0].s >= 9, `finest at ${z.toFixed(2)} is ${lv[0].s.toFixed(1)}px apart`);
    for (const l of lv) assert.ok(l.a > 0 && l.a <= 1);
  }
});

test('zooming changes the ground gradually: no step pops in or out', () => {
  // Each step's opacity moves by small amounts between nearby zooms.
  let prev = null;
  for (let z = 0.1; z <= 5; z *= 1.01) {
    const now = Object.fromEntries(dotLevels(z).map((l) => [l.step, l.a]));
    if (prev) {
      for (const step of GROUND_STEPS) {
        const d = Math.abs((now[step] || 0) - (prev[step] || 0));
        assert.ok(d < 0.12, `dots ${step} jumped by ${d.toFixed(3)} near ${z.toFixed(2)}`);
      }
    }
    prev = now;
  }
});

test('lines hand over between steps: never two full grids at once', () => {
  for (let z = 0.1; z <= 5; z *= 1.05) {
    const lv = lineLevels(z);
    const total = lv.reduce((s, l) => s + l.a, 0);
    assert.ok(total <= 1.0001, `lines at ${z.toFixed(2)} sum to ${total.toFixed(3)}`);
    for (const l of lv) assert.ok(l.s >= 40, 'no line grid denser than 40px');
  }
});

test('dots grow with the zoom, within bounds', () => {
  assert.equal(dotRadius(1), 1);
  assert.ok(dotRadius(4) > dotRadius(1) && dotRadius(4) <= 1.45);
  assert.ok(dotRadius(0.25) < 1 && dotRadius(0.1) >= 0.7);
});

test('theme colours parse', () => {
  assert.deepEqual(parseColor('rgba(245,245,247,.05)'), { rgb: '245,245,247', a: 0.05 });
  assert.deepEqual(parseColor(' rgba(10, 10, 12, 0.07) '), { rgb: '10,10,12', a: 0.07 });
  assert.deepEqual(parseColor('rgb(10 10 12 / 4%)'), { rgb: '10,10,12', a: 0.04 });
  assert.deepEqual(parseColor('#fff'), { rgb: '255,255,255', a: 1 });
  assert.equal(parseColor('nonsense'), null);
});

test('the camera of an element mid-transition', () => {
  assert.deepEqual(cameraFromTransform('matrix(0.5, 0, 0, 0.5, 120, -40)'), { z: 0.5, x: 120, y: -40 });
  assert.deepEqual(cameraFromTransform('matrix3d(2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, 30, 40, 0, 1)'), { z: 2, x: 30, y: 40 });
  assert.equal(cameraFromTransform('none'), null);
});

test("a mouse wheel's click glides; a trackpad's stream doesn't", () => {
  assert.equal(isWheelClick({ deltaMode: 1, deltaY: 3 }), true);
  assert.equal(isWheelClick({ deltaMode: 0, deltaY: 100 }), true);
  assert.equal(isWheelClick({ deltaMode: 0, deltaY: -120 }), true);
  assert.equal(isWheelClick({ deltaMode: 0, deltaY: 2.375 }), false);
  assert.equal(isWheelClick({ deltaMode: 0, deltaY: 12 }), false);
  assert.equal(isWheelClick({ deltaMode: 0, deltaY: 4.000244140625 }), true, "Chrome on a Mac, one click");
  assert.equal(isWheelClick({ deltaMode: 0, deltaY: -12.000732421875 }), true, 'three, accelerated');
  assert.equal(isWheelClick({ deltaMode: 0, deltaY: 4.5 }), false);
});

test('a glide eases out to its target and lands on it in GLIDE_MS', () => {
  const target = Math.exp(-100 * 0.0025);
  const seen = [];
  for (let t = 0; t <= GLIDE_MS + 16; t += 16) seen.push(glideZoom(1, target, t));
  assert.equal(seen[0], 1, 'starts where it was');
  assert.equal(seen.at(-1), target, 'lands exactly');
  assert.equal(glideZoom(1, target, GLIDE_MS), target);
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] <= seen[i - 1], 'never turns back');
  // Ease-out: most of the way in the first half.
  const half = glideZoom(1, target, GLIDE_MS / 2);
  assert.ok(Math.log(half) / Math.log(target) > 0.8);
  assert.ok(GLIDE_MS <= 200, 'short enough not to feel floaty');
});
