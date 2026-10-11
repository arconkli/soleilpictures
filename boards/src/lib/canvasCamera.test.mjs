// CanvasSurface camera / keyboard / paste wiring from the 2026-10 platform
// audit. Playwright is not in CI (tests/canvas-camera-fixes.spec.js drives the
// browser half), so the load-bearing lines are pinned here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const canvas = readFileSync(join(here, '../components/CanvasSurface.jsx'), 'utf8');
const between = (a, b) => {
  const i = canvas.indexOf(a);
  assert.ok(i >= 0, `missing: ${a}`);
  const j = canvas.indexOf(b, i + a.length);
  return canvas.slice(i, j < 0 ? undefined : j);
};

// CANVAS-A-04: every awareness change (our own cursor flush, ~60/s) rebuilt the
// peer-note map as a fresh object and re-rendered the whole canvas.
test('peer note edits ignore our own awareness changes and keep an unchanged map', () => {
  const fx = between('const [peerNoteEdits, setPeerNoteEdits] = useState({});', '// Peer live-drag state');
  assert.match(fx, /const refresh = \(_changes, origin\) => \{\s*if \(origin === 'local'\) return;/);
  assert.match(fx, /setPeerNoteEdits\(\(prev\) => \(sameStringMap\(prev, map\) \? prev : map\)\);/);
});

// CANVAS-A-01: use-gesture's pinch-on-wheel overrode the tuned ctrl+wheel zoom.
test('ctrl+wheel belongs to the custom wheel handler, not use-gesture', () => {
  assert.match(canvas, /pinch: \{ scaleBounds: \{[^}]*\}, rubberband: true, pinchOnWheel: false \}/);
});
