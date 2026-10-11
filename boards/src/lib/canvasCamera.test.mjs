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

// CARDS-01 / CARDS-02: the PDF viewer, the lightbox and a schedule card's own
// panes sit inside .canvas-wrap, whose wheel listener panned the board over them.
test('the wheel stands down over the viewers and over a selected schedule pane', () => {
  const wheel = between('const onWheel = (e) => {', "e.preventDefault();\n      perf.bump('wheel.events');");
  assert.match(wheel, /e\.target\.closest\('[^']*\.pdfv, \.lightbox'\)\) return;/);
  assert.match(canvas, /const SCHEDULE_SCROLL_PANES = '\.rd-body, \.schedt, \.schedc-rail-body';/);
  assert.match(wheel, /const pane = wheelMode === 'pan' && e\.target\.closest\(SCHEDULE_SCROLL_PANES\);/);
  assert.match(wheel, /pane\.closest\('\.card'\)\?\.classList\.contains\('is-selected'\)\) return;/);
  const ts = readFileSync(join(here, 'touchScroll.js'), 'utf8');
  for (const sel of ['.rd-body', '.schedt', '.schedc-rail-body']) {
    assert.ok(ts.includes(`{ sel: '${sel}', requireActive: true }`), sel);
  }
  assert.ok(ts.includes("{ sel: '.pdfv-scroll', requireActive: false }"));
});
