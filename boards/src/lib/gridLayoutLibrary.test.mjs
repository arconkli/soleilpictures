// gridLayoutLibrary.test.mjs
//
// Covers the Templates library catalogue and the three gridLayout functions it
// leans on: instantiateLayout (fresh ids), sanitizeLayout (the trust boundary for
// layouts other people authored) and rehomeCells (carrying content across a
// layout change).
// Run with:  cd boards && node src/lib/gridLayoutLibrary.test.mjs
// Plain Node ESM, no framework — exit 0 on pass, non-zero on failure.

import {
  PRESETS, presetTree, presetById, instantiateLayout, sanitizeLayout,
  rehomeCells, readingOrder, computeCellRects, normalizeTree, leafIds,
  LAYOUT_LIMITS,
} from './gridLayout.js';
import {
  BUILT_IN_LAYOUTS, SOURCES, rowFromRecord, rowsFromRecords,
  mergeSections, filterSections, bodyFromGrid, sanitizeHints, hintsToCellMap,
  HINT_LIMITS,
} from './gridLayoutLibrary.js';

let failed = 0, passed = 0;
function assertEq(actual, expected, msg) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) { console.error(`FAIL: ${msg}\n  expected: ${b}\n  actual:   ${a}`); failed++; }
  else passed++;
}
function assert(cond, msg) { assertEq(!!cond, true, msg); }

const BOX = { x: 0, y: 0, w: 100, h: 100 };
const counter = () => { let n = 0; return () => 'c' + (++n); };
const cellIds = (tree) => computeCellRects(tree, BOX).map((r) => r.id);

// ── instantiateLayout ───────────────────────────────────────────────────────

// gridQa.seedGridLayout documents c1 = top, c2 = bottom-left, c3 = bottom-right,
// and tests/grids.spec.js addresses cells by those ids. Leaf order is therefore a
// contract, not an implementation detail: presets became data in a refactor and
// this is what proves the refactor didn't renumber them.
{
  const t = presetTree('storyboard-1-2', counter());
  const rects = computeCellRects(t, BOX);
  assertEq(rects.map((r) => r.id), ['c1', 'c2', 'c3'], 'storyboard leaf order is c1/c2/c3');
  assertEq([rects[0].y, rects[1].x, rects[2].x], [0, 0, 50], 'c1 top, c2 bottom-left, c3 bottom-right');
}
assertEq(presetTree('nope', counter()), { type: 'leaf', id: 'c1', frac: 1 }, 'unknown preset falls back to a single cell');
assertEq(presetById('nope'), null, 'presetById returns null for an unknown id');
assert(presetById('2x2').tree, 'presetById finds a known preset');

// Instantiating twice must not collide — a stamped neighbour reuses the same tree.
{
  const a = leafIds(instantiateLayout(presetById('2x2').tree));
  const b = leafIds(instantiateLayout(presetById('2x2').tree));
  assertEq(a.filter((id) => b.includes(id)), [], 'two instantiations share no leaf ids');
}
// The catalogue's source trees are templates, not live layouts — instantiating
// must never write back into them.
{
  const before = JSON.stringify(presetById('3up').tree);
  instantiateLayout(presetById('3up').tree, counter());
  assertEq(JSON.stringify(presetById('3up').tree), before, 'instantiateLayout does not mutate the preset');
}
assertEq(instantiateLayout(null), null, 'instantiateLayout(null) is null');

// Every shipped preset must be well-formed: unique leaves, and already normalized
// (so the panel thumbnail and the placed grid render identically).
for (const p of PRESETS) {
  const inst = instantiateLayout(p.tree, counter());
  const ids = leafIds(inst);
  assert(ids.length >= 1, `${p.id}: has at least one cell`);
  assertEq(new Set(ids).size, ids.length, `${p.id}: leaf ids are unique`);
  assertEq(JSON.stringify(normalizeTree(inst)), JSON.stringify(inst), `${p.id}: already normalized`);
  assert(typeof p.label === 'string' && p.label.length > 0, `${p.id}: has a label`);
}
assertEq(new Set(PRESETS.map((p) => p.id)).size, PRESETS.length, 'preset ids are unique');

// ── sanitizeLayout — the trust boundary ─────────────────────────────────────

// Anything that isn't a tree at all.
for (const junk of [null, undefined, 'hello', 42, [], {}, { type: 'wat', children: [] }]) {
  assertEq(sanitizeLayout(junk), null, `sanitizeLayout rejects ${JSON.stringify(junk)}`);
}
assertEq(sanitizeLayout({ type: 'row', children: [] }), null, 'a split with no children is unusable');
assertEq(sanitizeLayout({ type: 'row', children: [{ type: 'bogus' }] }), null, 'a split whose children all fail is unusable');

// Numeric junk is REPAIRED, not rejected — one bad frac shouldn't cost the layout.
{
  const bad = { type: 'row', children: [
    { type: 'leaf', id: 'a', frac: NaN },
    { type: 'leaf', id: 'b', frac: Infinity },
    { type: 'leaf', id: 'c', frac: -5 },
  ] };
  const widths = computeCellRects(sanitizeLayout(bad), BOX).map((r) => Math.round(r.w));
  assertEq(widths, [33, 33, 33], 'NaN / Infinity / negative fracs become equal shares');
  assert(widths.every((w) => Number.isFinite(w)), 'no NaN survives into the rects');
}
{
  const s = sanitizeLayout({ type: 'row', children: [
    { type: 'leaf', id: 'a', frac: '0.75' },
    { type: 'leaf', id: 'b', frac: 0.25 },
  ] });
  assertEq(computeCellRects(s, BOX).map((r) => Math.round(r.w)), [75, 25], 'numeric strings coerce');
}

// A single root leaf is a legitimate layout, not a degenerate one.
assert(sanitizeLayout({ type: 'leaf', id: 'a', frac: 1 }), 'a lone root leaf survives');

// Resource guards. These are the reason sanitizeLayout exists: a community
// template is JSON somebody else wrote, and computeCellRects recurses without a
// depth guard.
{
  let deep = { type: 'leaf', id: 'x', frac: 1 };
  for (let i = 0; i < 40; i++) deep = { type: 'col', frac: 1, children: [deep, { type: 'leaf', id: 'p' + i, frac: 1 }] };
  const s = sanitizeLayout(deep);
  assert(s, 'an over-deep tree is trimmed, not rejected outright');
  assert(leafIds(s).length <= LAYOUT_LIMITS.MAX_NODES, 'trimmed tree respects the node cap');
}
{
  // JSON can't hold a cycle, but a hand-built object can — and an unguarded walk
  // would never terminate.
  const cyc = { type: 'row', frac: 1, children: [{ type: 'leaf', id: 'a', frac: 1 }] };
  cyc.children.push(cyc);
  let threw = false, out = null;
  try { out = sanitizeLayout(cyc); } catch (_) { threw = true; }
  assertEq(threw, false, 'a cyclic tree terminates instead of blowing the stack');
  assert(out, 'a cyclic tree still yields a usable layout');
}
{
  const huge = { type: 'row', frac: 1, children: Array.from({ length: 5000 }, (_, i) => ({ type: 'leaf', id: 'h' + i, frac: 1 })) };
  const s = sanitizeLayout(huge);
  assert(leafIds(s).length <= LAYOUT_LIMITS.MAX_NODES, '5000 children clamp to the node cap');
}

// ── readingOrder ────────────────────────────────────────────────────────────

// 2x2 is built as row[ col[a,b], col[c,d] ] — depth-first that is a,b,c,d
// (column-major). Reading order must re-sort it to a,c,b,d (row-major).
{
  const t = presetTree('2x2', counter());
  assertEq(cellIds(t), ['c1', 'c2', 'c3', 'c4'], '2x2 tree order is column-major');
  assertEq(readingOrder(computeCellRects(t, BOX)), ['c1', 'c3', 'c2', 'c4'], 'reading order is row-major');
}
assertEq(readingOrder([]), [], 'readingOrder([]) is empty');
{
  const t = presetTree('contact-sheet-3x3', counter());
  assertEq(readingOrder(computeCellRects(t, BOX)), cellIds(t), '3x3 is already in reading order');
}

// ── rehomeCells ─────────────────────────────────────────────────────────────

// Reading order for 2x2 is TL, TR, BL, BR. Fill TL and BL with images, TR with
// text, leave BR empty → in reading order that is [image, text, image, empty].
function fixture() {
  const old = presetTree('2x2', counter());
  const [tl, bl, tr, br] = cellIds(old); // depth-first: a, b, c, d
  return {
    old,
    ids: { tl, tr, bl, br },
    cells: {
      [tl]: { type: 'image', src: 'A' },
      [tr]: { type: 'text', html: '<p>B</p>' },
      [bl]: { type: 'image', src: 'C' },
      [br]: { type: 'empty' },
    },
  };
}
{
  const f = fixture();
  const next = presetTree('contact-sheet-3x3', counter());
  const { mapped, dropped } = rehomeCells(f.old, next, f.cells, BOX);
  const order = readingOrder(computeCellRects(next, BOX));
  assertEq(order.slice(0, 3).map((id) => mapped[id]?.src || mapped[id]?.html), ['A', '<p>B</p>', 'C'],
    'growing the grid keeps content in reading order');
  assertEq(dropped, 0, 'nothing is dropped when the new layout is bigger');
  assertEq(Object.keys(mapped).length, 3, 'the empty cell is not carried');
}
{
  const f = fixture();
  const next = presetTree('single', counter());
  const { mapped, dropped } = rehomeCells(f.old, next, f.cells, BOX);
  assertEq(Object.keys(mapped).length, 1, '4 cells into 1 keeps the first');
  assertEq(dropped, 2, 'the other two filled cells are counted as dropped');
}
// Index is preserved, NOT compacted: a gap in the middle stays a gap.
{
  const f = fixture();
  const next = presetTree('3up', counter());
  const holed = { ...f.cells, [f.ids.tr]: { type: 'empty' } }; // reading-order slot 1
  const { mapped } = rehomeCells(f.old, next, holed, BOX);
  const order = readingOrder(computeCellRects(next, BOX));
  assertEq(order.map((id) => mapped[id]?.src || null), ['A', null, 'C'],
    'an empty slot stays empty rather than pulling later content forward');
}
// A half-built cell is carried but not counted — dropping an in-flight upload
// would be a real bug, while counting it would inflate the toast.
{
  const f = fixture();
  const pending = { ...f.cells, [f.ids.br]: { type: 'image' } }; // no src yet
  const grown = rehomeCells(f.old, presetTree('contact-sheet-3x3', counter()), pending, BOX);
  assertEq(Object.keys(grown.mapped).length, 4, 'a src-less image record is still carried');
  const shrunk = rehomeCells(f.old, presetTree('3up', counter()), pending, BOX);
  assertEq(shrunk.dropped, 0, 'losing a src-less image is not reported as a loss');
}
assertEq(rehomeCells(null, presetTree('3up', counter()), {}, BOX), { mapped: {}, dropped: 0 }, 'null old layout is inert');
assertEq(rehomeCells(presetTree('3up', counter()), null, {}, BOX), { mapped: {}, dropped: 0 }, 'null new layout is inert');
assertEq(rehomeCells(presetTree('3up', counter()), presetTree('2x2', counter()), null, BOX), { mapped: {}, dropped: 0 }, 'null cells is inert');
// Applying the same shape to itself still re-ids, so content must follow.
{
  const f = fixture();
  const same = presetTree('2x2', counter());
  const { mapped, dropped } = rehomeCells(f.old, same, f.cells, BOX);
  assertEq(dropped, 0, 're-applying the same shape drops nothing');
  assertEq(Object.keys(mapped).length, 3, 're-applying the same shape carries every filled cell');
}

// ── the catalogue ───────────────────────────────────────────────────────────

assertEq(BUILT_IN_LAYOUTS.length, PRESETS.length, 'every preset is in the catalogue');
assert(BUILT_IN_LAYOUTS.every((r) => r.source === SOURCES.BUILTIN), 'built-ins are marked builtin');
assertEq(new Set(BUILT_IN_LAYOUTS.map((r) => r.key)).size, BUILT_IN_LAYOUTS.length, 'catalogue keys are unique');
assert(BUILT_IN_LAYOUTS.every((r) => r.name && r.tree), 'every catalogue row has a name and a tree');

// rowFromRecord is the database boundary — a corrupt row must drop out quietly
// rather than take the panel with it.
assertEq(rowFromRecord(null, SOURCES.USER), null, 'null record → null');
assertEq(rowFromRecord({ id: 'x', body: {} }, SOURCES.USER), null, 'record with no layout → null');
assertEq(rowFromRecord({ id: 'x', body: { layout: 'junk' } }, SOURCES.USER), null, 'record with a junk layout → null');
assertEq(rowFromRecord({ name: 'no id', body: { layout: { type: 'leaf', id: 'a', frac: 1 } } }, SOURCES.USER), null, 'record with no id → null');
{
  const rec = {
    id: 'gl1', name: 'My storyboard', created_by: 'u1', workspace_id: 'w1', share_token: 'tok',
    body: { layout: presetById('2x2').tree, textStyle: { fontSize: 14 } },
  };
  const r = rowFromRecord(rec, SOURCES.USER);
  assertEq(r.id, 'gl1', 'record id carries');
  assertEq(r.name, 'My storyboard', 'record name carries');
  assertEq(r.key, 'user:gl1', 'key namespaces by source');
  assertEq(r.shareToken, 'tok', 'share token carries');
  assertEq(r.textStyle, { fontSize: 14 }, 'text style carries');
  assertEq(leafIds(r.tree).length, 4, 'the stored tree survives sanitizing');
  // A future body may carry `cells`; today's reader must ignore it, not fail.
  const withCells = rowFromRecord({ ...rec, body: { ...rec.body, cells: { a: { type: 'image' } } } }, SOURCES.USER);
  assert(withCells, 'an unknown body field is ignored rather than fatal');
}
assertEq(rowsFromRecords([null, { id: 'x', body: {} }], SOURCES.USER), [], 'bad records filter out');
assertEq(rowsFromRecords(null, SOURCES.USER), [], 'null record list → empty');
assertEq(rowFromRecord({ id: 'x', body: { layout: presetById('single').tree } }, SOURCES.USER).name, 'Untitled', 'a nameless record gets a fallback');

// ── sections ────────────────────────────────────────────────────────────────

// Local mode and signed-out both land here: built-ins only, and crucially no
// hollow "My templates" header sitting above nothing.
assertEq(mergeSections().map((s) => s.id), [SOURCES.BUILTIN], 'with no data, only Built-in shows');
assertEq(mergeSections({ mine: [], workspace: [], community: [] }).map((s) => s.id), [SOURCES.BUILTIN], 'empty sections are dropped');
{
  const mine = [{ key: 'user:1', id: '1', name: 'Mine', tree: presetById('3up').tree, source: SOURCES.USER }];
  const sections = mergeSections({ mine });
  assertEq(sections.map((s) => s.id), [SOURCES.BUILTIN, SOURCES.USER], 'a populated section appears');
  assertEq(sections[1].title, 'My templates', 'section title');
}
{
  const mine = [{ key: 'user:1', id: '1', name: 'Shot list', tree: presetById('3up').tree, source: SOURCES.USER }];
  const sections = mergeSections({ mine });
  assertEq(filterSections(sections, 'shot').map((s) => s.id), [SOURCES.USER], 'search finds a saved template');
  assertEq(filterSections(sections, 'SHOT').map((s) => s.id), [SOURCES.USER], 'search is case-insensitive');
  assertEq(filterSections(sections, 'storyboard').map((s) => s.id), [SOURCES.BUILTIN], 'search matches built-ins too');
  assertEq(filterSections(sections, 'zzzz'), [], 'no matches → no sections');
  assertEq(filterSections(sections, '   ').length, sections.length, 'a blank query is not a filter');
  assertEq(filterSections(sections, '').length, sections.length, 'an empty query is not a filter');
}

// ── bodyFromGrid ────────────────────────────────────────────────────────────

assertEq(bodyFromGrid(null), null, 'no layout → nothing to save');
assertEq(bodyFromGrid('junk'), null, 'junk layout → nothing to save');
{
  const b = bodyFromGrid(presetById('2x2').tree);
  assertEq(Object.keys(b), ['layout'], 'no text style → layout only');
  assertEq(leafIds(b.layout).length, 4, 'the saved layout keeps its cells');
  const styled = bodyFromGrid(presetById('2x2').tree, { fontSize: 12 });
  assertEq(Object.keys(styled).sort(), ['layout', 'textStyle'], 'a text style is saved alongside');
  // Layout only, by design — no image refs means no cross-workspace R2 grants.
  assert(!JSON.stringify(b).includes('src'), 'a saved body carries no image references');
  assert(JSON.stringify(b).length < 16384, 'a saved body fits the column size check in 0265');
}

// ── cell hints ──────────────────────────────────────────────────────────────

// A hint is guidance, not content. These bounds are mirrored by a CHECK
// constraint in migration 0269 — hints are the only free text a template
// carries, and they publish to a public page.
assertEq(sanitizeHints(null), null, 'null hints → null');
assertEq(sanitizeHints('nope'), null, 'a string is not a hints array');
assertEq(sanitizeHints({ 0: 'a' }), null, 'an object is not a hints array');
assertEq(sanitizeHints([]), null, 'an empty array carries nothing');
assertEq(sanitizeHints(['', '', '']), null, 'all-blank labels are dropped entirely');
assertEq(sanitizeHints(['WIDE', '', 'TIGHT']), ['WIDE', '', 'TIGHT'], 'a gap in the middle is preserved');
assertEq(sanitizeHints([1, 'ok', null]), ['', 'ok', ''], 'non-strings become blanks, not crashes');
assertEq(sanitizeHints(['  spaced   out  ']), ['spaced out'], 'whitespace collapses and trims');
assertEq(sanitizeHints(['<b>bold</b>ish']), ['boldish'], 'markup is stripped from the STORED value');
assertEq(sanitizeHints(['<script>x()</script>hi']), ['x()hi'], 'tags go even when the text between them stays');
{
  const long = 'x'.repeat(80);
  assertEq(sanitizeHints([long])[0].length, HINT_LIMITS.MAX_LEN, 'a long label is truncated, not rejected');
  const many = Array.from({ length: 200 }, (_, i) => 'h' + i);
  assertEq(sanitizeHints(many).length, HINT_LIMITS.MAX_CELLS, 'the count is capped');
  assertEq(sanitizeHints(['a', 'b', 'c'], 2), ['a', 'b'], 'a caller can cap below the ceiling (cell count)');
}

// The index→id translation. This is the one place the reading-order storage
// meets the id-keyed runtime, and it must run AFTER instantiation.
{
  const tree = presetTree('2x2', counter());
  const order = readingOrder(computeCellRects(tree, BOX));
  const map = hintsToCellMap(tree, ['TL', 'TR', 'BL', 'BR'], BOX);
  assertEq(map[order[0]], 'TL', 'index 0 lands on the first cell in READING order');
  assertEq(map[order[1]], 'TR', 'index 1 lands on the second');
  assertEq(map[order[3]], 'BR', 'index 3 lands on the last');
  // 2x2 is stored column-major, so an id-keyed scheme would have put TR bottom-left.
  assertEq(Object.keys(map).length, 4, 'every label maps');
}
{
  const tree = presetTree('3up', counter());
  const order = readingOrder(computeCellRects(tree, BOX));
  const map = hintsToCellMap(tree, ['A', '', 'C'], BOX);
  assertEq(Object.keys(map).sort(), [order[0], order[2]].sort(), 'blank labels produce no entry');
}
assertEq(hintsToCellMap(null, ['A'], BOX), null, 'no tree → no map');
assertEq(hintsToCellMap(presetTree('3up', counter()), null, BOX), null, 'no hints → no map');
{
  // One tree, used for both the call and the expectation — instantiating twice
  // mints different ids, which is the whole point of instantiateLayout.
  const one = presetTree('single', counter());
  const only = readingOrder(computeCellRects(one, BOX))[0];
  assertEq(hintsToCellMap(one, ['A', 'B', 'C'], BOX), { [only]: 'A' },
    'more labels than cells: the extras are simply unused');
}

// bodyFromGrid carries them, and still omits the key when there is nothing to say.
{
  const t = presetById('2x2').tree;
  assertEq(Object.keys(bodyFromGrid(t)).sort(), ['layout'], 'no hints → no hints key');
  assertEq(Object.keys(bodyFromGrid(t, null, ['', ''])).sort(), ['layout'], 'blank hints → no hints key');
  const b = bodyFromGrid(t, null, ['WIDE', 'TIGHT']);
  assertEq(b.hints, ['WIDE', 'TIGHT'], 'real hints are stored');
  assertEq(Object.keys(bodyFromGrid(t, { fontSize: 12 }, ['A'])).sort(), ['hints', 'layout', 'textStyle'],
    'hints sit alongside layout and textStyle');
  assert(JSON.stringify(bodyFromGrid(t, null, ['A'])).length < 16384, 'a labelled body still fits the 0265 size check');
}

// rowFromRecord sanitizes on the way OUT too — a community template's labels
// are text somebody else wrote.
{
  const rec = { id: 'g1', name: 'T', body: { layout: presetById('3up').tree, hints: ['<i>A</i>', 2, 'C'] } };
  assertEq(rowFromRecord(rec, SOURCES.COMMUNITY).hints, ['A', '', 'C'], 'stored hints are re-sanitized on read');
  const bare = { id: 'g2', name: 'T', body: { layout: presetById('3up').tree } };
  assertEq(rowFromRecord(bare, SOURCES.USER).hints, null, 'a record with no hints reads as null');
}

console.log(`gridLayoutLibrary.test: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
