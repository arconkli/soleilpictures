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

// CANVAS-A-05: internal card paste used the last mousemove's canvas point,
// which a wheel pan or a cluster switch leaves out of view.
test('copied cards paste at a live, in-view position', () => {
  const resolve = between('const resolvePastePos = () => {', 'const notePasteCreate');
  assert.match(resolve, /const raw = client \? clientToCanvas\(client\.x, client\.y\) : lastMouseCanvasRef\.current;/);
  const paste = between('const onPaste = async (e) => {', "window.addEventListener('paste', onPaste);");
  assert.doesNotMatch(paste, /doPaste\(\);/, 'no bare doPaste() left in the paste handler');
  assert.equal((paste.match(/pasteCopiedCards\(\);/g) || []).length, 2, 'sentinel and fallback branches');
});

// CANVAS-A-07: a Finder drop, a pasted screenshot or the phone's + on an empty
// cluster let the first-card auto-fit zoom-frame what was just placed.
test('drops, picks and pastes settle the view before they place anything', () => {
  const ingest = between('const ingestFiles = useCallback(async (fileList, cx, cy, source = \'drop\') => {', 'const blockedForUpgrade = [];');
  assert.match(ingest, /markViewSettled\(\);/);
  assert.match(between('const notePasteCreate = (clamped) => {', '};'), /markViewSettled\(\);/);
  assert.match(between('const pasteCopiedCards = () => {', 'doPaste(pos);'), /markViewSettled\(\);/);
  // The picker behind the phone's + and the tour's "Add photos" lands in ingestFiles.
  assert.match(between('const pickPhotosAt = useCallback(', 'useEffect'), /await ingestFiles\(input\.files,/);
});

// CANVAS-A-08: the automatic open-fit magnified a sparse cluster up to 500%.
test('the opening fit never magnifies past 1:1', () => {
  assert.match(canvas, /const OPEN_FIT_MAX_ZOOM = 1;/);
  const fit = between('// 2) No saved view: fit everything into the viewport.', '// Phone rescue');
  assert.match(fit, /let z = Math\.max\(ZOOM_MIN, Math\.min\(OPEN_FIT_MAX_ZOOM, Math\.min\(/);
});

// CANVAS-A-11 / CANVAS-B-09: drag and resize deltas used the render-time zoom.
test('drags run in world space and resizes read the live zoom', () => {
  assert.match(canvas, /const startWorld = clientToCanvas\(startClient\.x, startClient\.y\);/);
  const moves = canvas.match(/const _origin = dragOriginWorld \|\| startWorld;\s*const _at = clientToCanvas\(ev\.clientX, ev\.clientY\);/g) || [];
  assert.equal(moves.length, 2, 'flushMove and the release commit agree');
  assert.doesNotMatch(canvas, /\(ev\.clientX - (_origin|startClient)\.x\) \/ zoom;/);
  assert.doesNotMatch(canvas, /\(mv\.clientX - startClient\.x\) \/ zoom;/);
});

// CANVAS-A-12: a cross-cluster paste read groups and comments from the board it
// pasted INTO, so the copies came out ungrouped and without their comments.
test('a paste takes groups and comments from the board it was copied from', () => {
  assert.match(between('const doCopy = useCallback(', 'const doCut = useCallback('), /setClipboard\(items, board\.id\);\s*noteCopiedGroups\(items, ydoc\);/);
  assert.match(between('const doCut = useCallback(', 'const doPaste = useCallback('), /noteCopiedGroups\(items, ydoc\);[^\n]*\n\s*mutators\.breakUndo/);
  const paste = between('const doPaste = useCallback(', 'const doDuplicate = useCallback(');
  assert.match(paste, /const fromCopy = copiedGroups\.at === clipboardCopiedAt\(\) \? copiedGroups\.byId : \{\};/);
  assert.match(paste, /const g = fromCopy\[gid\] \|\| sgm\.get\(gid\);/);
  assert.match(paste, /\.eq\('board_id', clipboardOrigin\(\) \|\| board\.id\)/);
  assert.match(paste, /const sameWs = srcComments\.filter\(c => c\.workspace_id === workspaceId\);/);
});

// CANVAS-A-14: a cleared project-name field stayed blank, reading as unnamed,
// while the project kept its name everywhere else. (Not reachable in the
// local harness, which never shows the fresh-project field.)
test('a cleared project name field puts the name back', () => {
  const commit = between('function ProjectNameField({ board, onRename }) {', 'return (');
  assert.match(commit, /if \(!t\) \{ setDraft\(named\); return; \}/);
});

// CANVAS-A-13 (canvas half): App hands down a fresh `cards` array on every
// render, so effects keyed on it re-armed their idle timers constantly.
test('the backfill, hotlink and sweep timers key on stable signatures, not on cards', () => {
  assert.match(canvas, /\}, \[board\.id, previewKeysSig, canEdit, isPublic, useLocalImages\]\);/);
  assert.match(canvas, /\}, \[board\?\.id, hotlinkSig, canEdit, isPublic, useLocalImages, boardSynced\]\);/);
  assert.match(canvas, /\}, \[board\?\.id, pendingUploadsSig, canEdit, isPublic, useLocalImages, boardSynced\]\);/);
  assert.doesNotMatch(canvas, /\}, \[board\??\.id, cards, canEdit, isPublic, useLocalImages/);
});

// MEDIA-13: every XHR progress event set top-level canvas state, so a
// multi-file upload re-rendered the whole canvas hundreds of times a second.
test('upload progress is coalesced per frame and only on a whole-percent change', () => {
  const fx = between('const reportUploadProgress = useCallback(', 'const clearUploadProgress = useCallback(');
  assert.match(fx, /requestAnimationFrame\(flush\)/);
  assert.match(fx, /Math\.round\(prev\[cid\] \* 100\) === Math\.round\(f \* 100\)\) continue;/);
  assert.match(fx, /return next \|\| prev;/);
  assert.equal((canvas.match(/setUploadProgressById\(/g) || []).length, 2, 'only the coalescer and the clear touch the state');
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
