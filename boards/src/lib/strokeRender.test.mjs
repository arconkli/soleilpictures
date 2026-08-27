// The stroke model + renderer, which four separate surfaces now share.
//
// The thing worth failing a build over is BACKWARD COMPATIBILITY. Every stroke
// ever drawn in this app is a plain [x, y] polyline with no pressure and no
// brush field, sitting in a Y.Doc that will never be migrated. If the shared
// renderer stops producing byte-identical output for those, every existing
// board silently redraws differently — and the thumbnail renderer, which runs
// on a different code path, drifts away from the live canvas.
//
// So: the legacy fast path is pinned to an exact string, and the layer
// flattening is pinned to "a card with no layers is indistinguishable from
// before layers existed".

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BRUSHES,
  cardLayers,
  eraseStrokes,
  hasPressure,
  isConstantWidth,
  pointInPolygon,
  pointPressure,
  readCardStrokes,
  splitStrokeByEraser,
  strokeBounds,
  strokeInPolygon,
  strokeWidth,
} from './strokeModel.js';
import { polylinePathD, strokeOpacity, toPathD, isFilledPath, drawStroke, outlinePoints } from './strokeRender.js';

const legacy = (points) => ({ color: '#f5f5f6', width: 3, points });

// ── Backward compatibility ────────────────────────────────────────────────

test('a legacy 2-tuple stroke renders to the exact pre-refactor path string', () => {
  const s = legacy([[10, 20], [30.44, 40.46], [50, 60]]);
  // This is verbatim what the four old copies produced: one decimal place,
  // "M" then space-separated "L" commands.
  assert.equal(toPathD(s), 'M10.0,20.0 L30.4,40.5 L50.0,60.0');
});

test('empty and single-point strokes degrade the way they always did', () => {
  assert.equal(toPathD(legacy([])), '');
  assert.equal(toPathD({ points: undefined }), '');
  assert.equal(toPathD(legacy([[5, 5]])), 'M5.0,5.0');
  assert.equal(polylinePathD(null), '');
});

test('a legacy stroke has no pressure, is constant width, and is stroked not filled', () => {
  const s = legacy([[0, 0], [1, 1]]);
  assert.equal(hasPressure(s), false);
  assert.equal(isConstantWidth(s), true);
  assert.equal(isFilledPath(s), false);
  assert.equal(strokeOpacity(s), 1, 'default pen brush must not tint legacy strokes');
});

test('a missing width falls back to 3, the pre-refactor default', () => {
  assert.equal(strokeWidth({}), 3);
  assert.equal(strokeWidth({ width: 0 }), 3);
  assert.equal(strokeWidth({ width: 8 }), 8);
});

// ── Pressure ──────────────────────────────────────────────────────────────

test('pressure is read from the optional third element, defaulting to full', () => {
  assert.equal(pointPressure([1, 2]), 1);
  assert.equal(pointPressure([1, 2, 0.4]), 0.4);
  assert.equal(pointPressure(undefined), 1);
});

test('pressure is detected by presence, not by variance', () => {
  // A pen held at dead-constant force still reported pressure — honour it.
  assert.equal(hasPressure({ points: [[0, 0, 0.5], [1, 1, 0.5]] }), true);
  assert.equal(hasPressure({ points: [[0, 0], [1, 1]] }), false);
  // Mixed: some samples carry it (a device that started reporting mid-stroke).
  assert.equal(hasPressure({ points: [[0, 0], [1, 1, 0.7]] }), true);
});

test('a zero-thinning brush stays on the constant-width path even with pressure', () => {
  // The highlighter must not taper — that is what makes it read as a marker.
  assert.equal(BRUSHES.highlighter.thinning, 0);
  assert.equal(isConstantWidth({ brush: 'highlighter', points: [[0, 0, 0.2], [1, 1, 0.9]] }), true);
  assert.equal(isConstantWidth({ brush: 'pen', points: [[0, 0, 0.2], [1, 1, 0.9]] }), false);
});

test('brush opacity and layer opacity multiply together', () => {
  assert.equal(strokeOpacity({ brush: 'pen' }), 1);
  assert.equal(strokeOpacity({ brush: 'highlighter' }), BRUSHES.highlighter.opacity);
  assert.equal(
    strokeOpacity({ brush: 'highlighter', layerOpacity: 0.5 }),
    BRUSHES.highlighter.opacity * 0.5,
  );
});

// ── Outline geometry ──────────────────────────────────────────────────────

test('a pressure stroke renders as a CLOSED filled outline, not a polyline', () => {
  const s = { color: '#fff', width: 8, points: [[0, 0, 0.2], [20, 0, 0.9], [40, 0, 0.3]] };
  assert.equal(isFilledPath(s), true, 'width varies, so stroke-width cannot express it');
  const d = toPathD(s);
  assert.match(d, /^M/);
  assert.match(d, /Z$/, 'an outline must close, or the fill leaks');
  assert.ok(d.includes('Q'), 'curved through the midpoints, not a faceted polygon');
});

test('pressure actually changes the outline', () => {
  const light = { color: '#fff', width: 20, points: [[0, 0, 0.1], [50, 0, 0.1]] };
  const heavy = { color: '#fff', width: 20, points: [[0, 0, 1], [50, 0, 1]] };
  const spread = (s) => {
    const ys = outlinePoints(s).map(p => p[1]);
    return Math.max(...ys) - Math.min(...ys);
  };
  assert.ok(spread(heavy) > spread(light) * 1.5,
    'a hard press must draw a visibly fatter line than a light one');
});

test('a zero-thinning brush ignores pressure entirely', () => {
  // The highlighter must read as a flat marker — that is the whole point of it.
  const s = { color: '#ff0', width: 20, brush: 'highlighter', points: [[0, 0, 0.1], [50, 0, 1]] };
  assert.equal(isFilledPath(s), false);
  assert.equal(toPathD(s), polylinePathD(s.points), 'stays on the cheap polyline path');
});

test('every brush produces geometry for a plain mouse stroke', () => {
  // No pressure recorded at all — perfect-freehand simulates it for the tapered
  // brushes. A brush that returned an empty path here would draw nothing.
  for (const brush of Object.keys(BRUSHES)) {
    const s = { color: '#fff', width: 6, brush, points: [[0, 0], [10, 4], [22, 2], [30, 8]] };
    assert.ok(toPathD(s).length > 0, `${brush} produced no path`);
  }
});

test('Canvas2D fills an outline stroke instead of stroking it', () => {
  const ctx = recordingCtx();
  drawStroke(ctx, { color: '#fff', width: 10, points: [[0, 0, 0.2], [20, 0, 0.9]] }, { ppu: 1 });
  const names = ctx.calls.map(c => c[0]);
  assert.ok(names.includes('fill'), 'a variable-width stroke must be filled');
  assert.ok(!names.includes('stroke'), 'stroking it would draw a hairline of the shape');
  assert.ok(names.includes('quadraticCurveTo'), 'same curve construction as the SVG path');
});

test('brush opacity and blend reach the Canvas2D context', () => {
  const ctx = recordingCtx();
  drawStroke(ctx, { color: '#ff0', width: 10, brush: 'highlighter', points: [[0, 0], [20, 0]] }, { ppu: 1 });
  const alpha = ctx.calls.find(c => c[0] === 'globalAlpha');
  const blend = ctx.calls.find(c => c[0] === 'globalCompositeOperation');
  assert.equal(alpha[1], BRUSHES.highlighter.opacity);
  assert.equal(blend[1], 'multiply', 'a highlighter that does not multiply just hides the text');
});

// ── Layers ────────────────────────────────────────────────────────────────

test('a card with no layers reads exactly as its flat strokes array', () => {
  const strokes = [legacy([[0, 0], [1, 1]])];
  const card = { kind: 'art', strokes };
  assert.equal(readCardStrokes(card), strokes, 'must be the SAME reference — memoization depends on it');
  assert.deepEqual(readCardStrokes({ kind: 'art' }), []);
  assert.deepEqual(readCardStrokes(null), []);
});

test('a card with no layers still presents one implicit visible layer', () => {
  const layers = cardLayers({ strokes: [legacy([[0, 0], [1, 1]])] });
  assert.equal(layers.length, 1);
  assert.equal(layers[0].visible, true);
  assert.equal(layers[0].strokes.length, 1);
});

test('layers flatten bottom-to-top and hidden layers drop out', () => {
  const a = legacy([[0, 0], [1, 1]]);
  const b = legacy([[2, 2], [3, 3]]);
  const c = legacy([[4, 4], [5, 5]]);
  const card = {
    layers: [
      { id: 'l1', visible: true, strokes: [a] },
      { id: 'l2', visible: false, strokes: [b] },
      { id: 'l3', visible: true, strokes: [c] },
    ],
  };
  const out = readCardStrokes(card);
  assert.equal(out.length, 2);
  assert.equal(out[0], a);
  assert.equal(out[1], c, 'bottom-to-top order must be preserved');
});

test('layers take precedence over a stale flat strokes array', () => {
  const inLayer = legacy([[9, 9], [8, 8]]);
  const out = readCardStrokes({
    strokes: [legacy([[0, 0], [1, 1]])],
    layers: [{ id: 'l1', visible: true, strokes: [inLayer] }],
  });
  assert.deepEqual(out, [inLayer]);
});

test('layer opacity below 1 is folded onto the stroke, not lost', () => {
  const out = readCardStrokes({
    layers: [{ id: 'l1', visible: true, opacity: 0.4, strokes: [legacy([[0, 0], [1, 1]])] }],
  });
  assert.equal(out[0].layerOpacity, 0.4);
  assert.equal(strokeOpacity(out[0]), 0.4);
});

// ── Eraser ────────────────────────────────────────────────────────────────

test('the eraser splits a stroke in two rather than deleting it', () => {
  // A long horizontal line, erased through the middle.
  const stroke = legacy([[0, 0], [100, 0]]);
  const pieces = splitStrokeByEraser(stroke, [[50, -10], [50, 10]], 8);
  assert.equal(pieces.length, 2, 'one cut through the middle yields two surviving runs');
  assert.ok(pieces[0].points.at(-1)[0] < 50);
  assert.ok(pieces[1].points[0][0] > 50);
  assert.equal(pieces[0].color, stroke.color, 'color/width carry to both halves');
  assert.equal(pieces[0].width, stroke.width);
});

test('an eraser that misses hands back the ORIGINAL stroke object', () => {
  // splitStrokeByEraser resamples to <=6px BEFORE it hit-tests, so a naive
  // implementation returns a denser rebuild even for a clean miss. Identity here
  // is what lets eraseStrokes tell a miss from a hit at all.
  const stroke = legacy([[0, 0], [100, 0]]);
  const pieces = splitStrokeByEraser(stroke, [[50, 500], [50, 600]], 8);
  assert.equal(pieces.length, 1, 'a clean miss must not split the stroke');
  assert.equal(pieces[0], stroke, 'and must not resample it either');
});

test('an eraser gesture too short to be a polyline is a no-op', () => {
  const stroke = legacy([[0, 0], [100, 0]]);
  const pieces = splitStrokeByEraser(stroke, [[50, 0]], 8);
  assert.equal(pieces.length, 1);
  assert.equal(pieces[0], stroke, 'the original object passes straight through');
});

test('an eraser swipe that covers everything removes the stroke entirely', () => {
  const stroke = legacy([[0, 0], [10, 0]]);
  const pieces = splitStrokeByEraser(stroke, [[-5, 0], [15, 0]], 20);
  assert.equal(pieces.length, 0);
});

test('erasing through a pressure stroke keeps pressure on both halves', () => {
  const stroke = { color: '#fff', width: 4, points: [[0, 0, 0.2], [100, 0, 0.9]] };
  const pieces = splitStrokeByEraser(stroke, [[50, -10], [50, 10]], 8);
  assert.equal(pieces.length, 2);
  for (const p of pieces) {
    assert.ok(hasPressure(p), 'a split half must not silently lose its taper');
  }
});

test('an eraser swipe that misses is a TRUE no-op, by identity', () => {
  // The trap: splitStrokeByEraser resamples before it tests, so it hands back a
  // rebuilt stroke even for a clean miss. Feeding that back would resample every
  // stroke on the surface on every swipe and burn an undo step each time.
  const a = legacy([[0, 0], [100, 0]]);
  const b = legacy([[0, 50], [100, 50]]);
  const { next, changed } = eraseStrokes([a, b], [[50, 500], [50, 600]], 8);
  assert.equal(changed, false, 'nothing was cut, so nothing changed');
  assert.equal(next[0], a, 'untouched strokes must pass through by IDENTITY');
  assert.equal(next[1], b);
});

test('an eraser swipe reports a change only for the strokes it cut', () => {
  const hit = legacy([[0, 0], [100, 0]]);
  const miss = legacy([[0, 400], [100, 400]]);
  const { next, changed } = eraseStrokes([hit, miss], [[50, -10], [50, 10]], 8);
  assert.equal(changed, true);
  assert.equal(next.length, 3, 'the cut stroke became two pieces, the other survived whole');
  assert.equal(next.at(-1), miss, 'the missed stroke is still the same object');
});

test('a swipe across the middle of a long two-point line still registers', () => {
  // Neither stored endpoint is near the eraser — only the interpolated middle
  // is. This is the case the resampling exists for, so the touch test has to
  // measure eraser samples against the stroke POLYLINE, not point-to-point.
  const line = legacy([[0, 0], [1000, 0]]);
  const { changed } = eraseStrokes([line], [[500, -5], [500, 5]], 8);
  assert.equal(changed, true);
});

test('eraseStrokes tolerates an empty surface and a degenerate swipe', () => {
  assert.deepEqual(eraseStrokes([], [[0, 0], [1, 1]], 8), { next: [], changed: false });
  const s = [legacy([[0, 0], [10, 0]])];
  assert.deepEqual(eraseStrokes(s, [[5, 0]], 8), { next: s, changed: false });
  assert.deepEqual(eraseStrokes(null, [[0, 0], [1, 1]], 8), { next: [], changed: false });
});

// ── Geometry ──────────────────────────────────────────────────────────────

test('strokeBounds is the centreline extent', () => {
  assert.deepEqual(strokeBounds(legacy([[0, 5], [10, -3]])), { minX: 0, minY: -3, maxX: 10, maxY: 5 });
  assert.equal(strokeBounds(legacy([])), null);
});

test('point-in-polygon uses even-odd and handles the boundary sanely', () => {
  const square = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.equal(pointInPolygon(5, 5, square), true);
  assert.equal(pointInPolygon(15, 5, square), false);
  assert.equal(pointInPolygon(-1, 5, square), false);
});

test('the lasso takes a stroke only when MOST of it is inside', () => {
  const square = [[0, 0], [10, 0], [10, 10], [0, 10]];
  // 3 of 4 points inside → taken.
  assert.equal(strokeInPolygon(legacy([[1, 1], [2, 2], [3, 3], [50, 50]]), square), true);
  // 1 of 4 inside → left alone. This mirrors pickStrokeTarget's majority rule,
  // so "mostly inside" means the same thing everywhere in the app.
  assert.equal(strokeInPolygon(legacy([[1, 1], [50, 50], [60, 60], [70, 70]]), square), false);
  assert.equal(strokeInPolygon(legacy([]), square), false);
});

// ── Canvas2D parity ───────────────────────────────────────────────────────

// A minimal recording 2D context: enough to prove drawStroke issues the same
// moveTo/lineTo sequence the SVG path describes, which is the actual guarantee
// that thumbnails match the live canvas.
function recordingCtx() {
  const calls = [];
  const rec = (name) => (...args) => calls.push([name, ...args]);
  return {
    calls,
    save: rec('save'), restore: rec('restore'), beginPath: rec('beginPath'),
    moveTo: rec('moveTo'), lineTo: rec('lineTo'), stroke: rec('stroke'),
    quadraticCurveTo: rec('quadraticCurveTo'), closePath: rec('closePath'), fill: rec('fill'),
    set fillStyle(v) { calls.push(['fillStyle', v]); },
    set strokeStyle(v) { calls.push(['strokeStyle', v]); },
    set lineWidth(v) { calls.push(['lineWidth', v]); },
    set lineCap(v) { calls.push(['lineCap', v]); },
    set lineJoin(v) { calls.push(['lineJoin', v]); },
    set globalAlpha(v) { calls.push(['globalAlpha', v]); },
    set globalCompositeOperation(v) { calls.push(['globalCompositeOperation', v]); },
  };
}

test('Canvas2D walks the same points the SVG path does', () => {
  const ctx = recordingCtx();
  drawStroke(ctx, legacy([[10, 20], [30, 40], [50, 60]]), { ppu: 1 });
  const moves = ctx.calls.filter(c => c[0] === 'moveTo' || c[0] === 'lineTo');
  assert.deepEqual(moves, [
    ['moveTo', 10, 20], ['lineTo', 30, 40], ['lineTo', 50, 60],
  ]);
});

test('card-local strokes are offset into board space', () => {
  const ctx = recordingCtx();
  drawStroke(ctx, legacy([[0, 0], [5, 5]]), { offX: 100, offY: 200, ppu: 1 });
  const moves = ctx.calls.filter(c => c[0] === 'moveTo' || c[0] === 'lineTo');
  assert.deepEqual(moves, [['moveTo', 100, 200], ['lineTo', 105, 205]]);
});

test('line width is floored so hairlines survive fit-to-content scale', () => {
  const ctx = recordingCtx();
  drawStroke(ctx, { color: '#fff', width: 0.1, points: [[0, 0], [1, 1]] }, { ppu: 0.5 });
  const lw = ctx.calls.find(c => c[0] === 'lineWidth')[1];
  assert.equal(lw, 1.2 / 0.5, 'must floor at 1.2 device px, exactly as before');
});

test('strokes too short to paint are skipped, as all four copies did', () => {
  const ctx = recordingCtx();
  drawStroke(ctx, legacy([[0, 0]]), {});
  drawStroke(ctx, legacy([]), {});
  drawStroke(ctx, {}, {});
  assert.equal(ctx.calls.length, 0);
});
