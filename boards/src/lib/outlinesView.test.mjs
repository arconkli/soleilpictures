// Pins Admin › Outlines' rules (outlinesView.js): the tiles, the heat table and
// its colour ramp, the filters and the RPC arguments they become, and the
// wireframe a stored outline is drawn as.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fmtCount, fmtShare, fmtMedian, weekDay, weekLabel, weeksView, stepWeek, weekStepState,
  tilesView, heatAlpha, HEAT_RAMP, heatTable, TOOLS, BANDS,
  FILTER_GROUPS, SORTS, KINDS, HAS_KINDS, NO_FILTERS, hasActiveFilters, setFilter, outlineParams,
  ageText, levelName, titleLine, legendView, holdsText, gridDims, outlineRects,
  storedRowLines, jsonRuns, footText, countText, neighbour, returnView, returnReadyDate, returnSpan, whoTag,
} from './outlinesView.js';

const outline = (extra = {}) => ({
  week: '2027-02-22',
  outline_id: 'o1',
  frame: { w: 200, h: 130 },
  cards: [
    { k: 'picture', x: 10, y: 29, w: 25, h: 16, z: 2, r: 0, s: 1, hd: false },
    { k: 'note', x: 10, y: 16, w: 52, h: 9, z: 1, r: 0, s: 1, hd: true },
    { k: 'grid', x: 80, y: 10, w: 60, h: 40, z: 4, r: 5, s: null, hd: false, g: 6 },
    { k: 'cluster', x: 150, y: 90, w: 40, h: 30, z: 3, r: 0, s: null, hd: false },
  ],
  sections: [{ i: 1, x: 6, y: 12, w: 60, h: 36, n: 2 }],
  stats: { cards: 4, kinds: { picture: 1, note: 1, grid: 1, cluster: 1 }, depth: 2, children: 1, age: 'w4', rotated: 1, grids: 1 },
  ...extra,
});

test('counts get thousands separators, shares whole percents, the median a number', () => {
  assert.equal(fmtCount(1284), '1,284');
  assert.equal(fmtCount(0), '0');
  assert.equal(fmtCount(null), '—');
  assert.equal(fmtCount(NaN), '—');
  assert.equal(fmtShare(0.384), '38%');
  assert.equal(fmtShare(1), '100%');
  assert.equal(fmtShare(undefined), '—');
  assert.equal(fmtMedian(14), '14');
  assert.equal(fmtMedian(14.5), '14.5');
  assert.equal(fmtMedian(1200), '1,200');
  assert.equal(fmtMedian(null), '—');
});

test('weeks: labels, cleaning and stepping (newest first)', () => {
  assert.equal(weekDay('2027-02-22'), '22 Feb 2027');
  assert.equal(weekLabel('2027-02-01'), 'Week of 1 Feb 2027');
  assert.equal(weekLabel('nope'), '—');
  const weeks = weeksView([
    { week: '2027-03-01', outlines: 5, stats: true, return: true },
    { week: 'bad', outlines: 1, stats: false },
    { week: '2027-02-22', outlines: '3', stats: false },
  ]);
  assert.deepEqual(weeks, [
    { week: '2027-03-01', outlines: 5, stats: true, return: true },
    { week: '2027-02-22', outlines: 3, stats: false, return: false },
  ]);
  assert.deepEqual(weeksView(null), []);
  assert.equal(stepWeek(weeks, '2027-03-01', -1), '2027-02-22');
  assert.equal(stepWeek(weeks, '2027-02-22', -1), '2027-02-22');
  assert.equal(stepWeek(weeks, '2027-02-22', 1), '2027-03-01');
  assert.equal(stepWeek(weeks, '2027-03-01', 1), '2027-03-01');
  assert.equal(stepWeek(weeks, 'gone', 1), '2027-03-01');
  assert.deepEqual(weekStepState(weeks, '2027-03-01'), { canPrev: true, canNext: false });
  assert.deepEqual(weekStepState(weeks, '2027-02-22'), { canPrev: false, canNext: true });
});

test('tiles: five, formatted; a missing tile or no stats at all is an em dash', () => {
  const t = tilesView({
    tiles: {
      clusters_changed: { value: 1284, people_n: 400 },
      median_cards: { value: 14, people_n: 400 },
      use_sections: { value: 0.38, people_n: 400 },
      nested: null,
      mostly_pictures: { value: 0.46, people_n: 400 },
    },
  });
  assert.deepEqual(t.map((x) => x.id), ['clusters_changed', 'median_cards', 'use_sections', 'nested', 'mostly_pictures']);
  assert.deepEqual(t.map((x) => x.value), ['1,284', '14', '38%', '—', '46%']);
  assert.equal(t[0].label, 'Clusters that changed');
  assert.equal(t[4].sub, 'over half their cards are pictures');
  for (const x of tilesView(null)) assert.equal(x.value, '—');
  for (const x of tilesView({})) assert.equal(x.value, '—');
});

test('heat ramp: 3% ink for nobody to 23% for everybody, a straight line in the share', () => {
  assert.equal(heatAlpha(0), 3);
  assert.equal(heatAlpha(1), 23);
  assert.equal(heatAlpha(0.98), 22.6);
  assert.equal(heatAlpha(0.11), 5.2);
  assert.equal(heatAlpha(2), 23);
  assert.equal(heatAlpha(-1), 3);
  assert.deepEqual(HEAT_RAMP, [3, 8, 13, 18, 23]);
});

test('heat table: spec row order, missing cells hidden, no stats = all hidden', () => {
  assert.deepEqual(TOOLS.map((t) => t.label), [
    'Move cards', 'Arrange', 'Align & distribute', 'Sections', 'Arrows', 'Pen', 'Grid boxes',
    'Duplicate', 'Copy & paste', 'Undo', 'Resize', 'Rotate', 'Layer order', 'Multi-select',
  ]);
  assert.deepEqual(BANDS.map((b) => b.id), ['5m', '1d', '7d', 'later']);
  const rows = heatTable({ tools: [
    { tool: 'move', band: '5m', share: 0.91, people_n: 200 },
    { tool: 'move', band: 'later', share: 0.98, people_n: 200 },
    { tool: 'undo', band: '1d', share: 0.44, people_n: 90 },
  ] });
  assert.equal(rows.length, 14);
  const move = rows[0];
  assert.deepEqual(move.cells.map((c) => c.text), ['91%', '—', '—', '98%']);
  assert.equal(move.cells[0].alpha, 21.2);
  assert.equal(move.cells[0].na, false);
  assert.equal(move.cells[1].na, true);
  assert.equal(move.cells[1].title, 'Fewer than 20 people');
  assert.equal(rows[9].cells[1].text, '44%');
  const none = heatTable(null);
  assert.equal(none.length, 14);
  assert.ok(none.every((r) => r.cells.every((c) => c.na && c.text === '—' && c.title === 'No figures stored for this week')));
});

test('filter pills: the groups, their RPC values and the sort options', () => {
  assert.deepEqual(FILTER_GROUPS.map((g) => g.id), ['cards', 'sections', 'level', 'who', 'age']);
  const by = Object.fromEntries(FILTER_GROUPS.map((g) => [g.id, g.pills.map((p) => p.v)]));
  assert.deepEqual(by.cards, [null, '3-9', '10-29', '30-99', '100+']);
  assert.deepEqual(by.sections, [null, 'with', 'without']);
  assert.deepEqual(by.level, [null, 'top', '2', '3+']);
  assert.deepEqual(by.age, [null, 'w1', 'w4', 'm3', 'old']);
  assert.deepEqual(by.who, [null, 'left', 'back', 'older']);
  assert.deepEqual(FILTER_GROUPS[3].pills.map((p) => p.label), ['Any', 'New, left', 'New, came back', 'Not new']);
  assert.equal(FILTER_GROUPS[3].label, 'Maker');
  assert.equal(FILTER_GROUPS[3].note, 'New = made in the maker’s first week');
  assert.deepEqual(FILTER_GROUPS[4].pills.map((p) => p.label), ['Any', 'First week', '1–4 weeks', '1–3 months', 'Over 3 months']);
  assert.deepEqual(SORTS.map((s) => s.v), ['newest', 'cards', 'sections']);
  assert.deepEqual(KINDS.map((k) => k.id), ['picture', 'note', 'link', 'doc', 'file', 'video', 'audio', 'palette', 'shape', 'grid', 'cluster', 'other']);
  assert.deepEqual(HAS_KINDS.map((k) => k.id), ['picture', 'note', 'link', 'doc', 'file', 'video', 'audio', 'palette', 'shape', 'grid', 'cluster']);
});

test('filter state becomes the RPC arguments', () => {
  assert.deepEqual(outlineParams('2027-02-22', NO_FILTERS), {
    p_week: '2027-02-22', p_cards: null, p_sections: null, p_level: null, p_age: null, p_who: null,
    p_has: null, p_sort: 'newest', p_limit: 48, p_offset: 0,
  });
  let f = setFilter(NO_FILTERS, 'cards', '10-29');
  f = setFilter(f, 'sections', 'with');
  f = setFilter(f, 'level', '3+');
  f = setFilter(f, 'age', 'm3');
  f = setFilter(f, 'who', 'back');
  f = setFilter(f, 'has', 'cluster');
  f = setFilter(f, 'has', 'picture');
  f = { ...f, sort: 'sections' };
  assert.deepEqual(outlineParams('2027-02-22', f, 96, 48), {
    p_week: '2027-02-22', p_cards: '10-29', p_sections: 'with', p_level: '3+', p_age: 'm3', p_who: 'back',
    p_has: ['picture', 'cluster'], p_sort: 'sections', p_limit: 48, p_offset: 96,
  });
  assert.equal(hasActiveFilters(NO_FILTERS), false);
  assert.equal(hasActiveFilters(f), true);
  assert.equal(hasActiveFilters(setFilter(NO_FILTERS, 'who', 'older')), true);
  assert.equal(hasActiveFilters(setFilter(setFilter(NO_FILTERS, 'who', 'older'), 'who', null)), false);
  assert.equal(hasActiveFilters({ ...NO_FILTERS, sort: 'cards' }), false);
  const off = setFilter(setFilter(NO_FILTERS, 'has', 'note'), 'has', 'note');
  assert.deepEqual(off.has, []);
  assert.equal(outlineParams('w', off).p_has, null);
  // The frozen default is never changed by setting a filter.
  assert.deepEqual(NO_FILTERS.has, []);
});

test('words about an outline', () => {
  assert.equal(ageText('w1'), 'In its first week');
  assert.equal(ageText('old'), 'Over 3 months old');
  assert.equal(ageText('x'), '—');
  assert.equal(levelName(0), 'Top level');
  assert.equal(levelName(1), 'Top level');
  assert.equal(levelName(2), 'Level 2');
  assert.equal(levelName(5), 'Level 3+');
  const o = outline();
  assert.equal(titleLine(o), '4 cards · 1 section · Level 2');
  assert.equal(titleLine(outline({ sections: [], stats: { ...o.stats, cards: 1, depth: 0 } })), '1 card · No sections · Top level');
  assert.deepEqual(legendView(o), [
    { id: 'picture', label: 'picture', n: 1 },
    { id: 'note', label: 'note', n: 1 },
    { id: 'grid', label: 'grid', n: 1 },
    { id: 'cluster', label: 'nested cluster', n: 1 },
    { id: 'section', label: 'section', n: 1 },
  ]);
  assert.equal(
    holdsText(o),
    '1 picture, 1 note, 1 grid, 1 nested cluster · 1 section · 1 card rotated · Level 2 · 1–4 weeks old · Week of 22 Feb 2027',
  );
});

test('the legend and the sentence name shapes and other cards; the pills leave out other', () => {
  const o = outline({ stats: { ...outline().stats, kinds: { shape: 2, other: 3 } } });
  assert.deepEqual(legendView(o).map((k) => k.id), ['shape', 'other', 'section']);
  assert.match(holdsText(o), /^2 shapes, 3 other cards · /);
  assert.equal(HAS_KINDS.some((k) => k.id === 'other'), false);
});

test('gridDims picks the squarest layout with exactly g boxes', () => {
  assert.deepEqual(gridDims(6, 60, 40), { c: 3, r: 2, d: gridDims(6, 60, 40).d });
  assert.equal(gridDims(4, 40, 40).c, 2);
  assert.equal(gridDims(7, 70, 10).c, 7);
  const d = gridDims(12, 120, 40);
  assert.equal(d.c * d.r, 12);
});

test('outline to rects: viewBox, section boxes, layer order, kinds', () => {
  const r = outlineRects(outline());
  assert.equal(r.viewBox, '0 0 200 130');
  assert.equal(r.wide, true);
  assert.deepEqual(r.sections, [{ i: 1, x: 6, y: 12, w: 60, h: 36, tx: 9.5, ty: 19.6 }]);
  // z order: note(1) picture(2) cluster(3) grid(4)
  assert.deepEqual(r.cards.map((c) => c.kind), ['note', 'picture', 'cluster', 'grid']);
  const [note, pic, cluster, grid] = r.cards;
  assert.equal(note.type, 'card');
  assert.equal(note.header, true);
  assert.equal(pic.header, false);
  assert.equal(pic.rotate, null);
  assert.equal(cluster.type, 'cluster');
  assert.deepEqual(cluster.inner, { x: 152.4, y: 92.4, w: 35.2, h: 25.2 });
  assert.equal(cluster.squares.length, 2);
  assert.equal(grid.type, 'grid');
  // 6 boxes of a 60 x 40 card: 3 across, 2 down, so 2 + 1 dividing lines.
  assert.equal(grid.lines.length, 3);
  assert.deepEqual(grid.rotate, { deg: 5, cx: 110, cy: 30 });
  const tall = outlineRects(outline({ frame: { w: 80, h: 200 } }));
  assert.equal(tall.wide, false);
  const empty = outlineRects({ frame: { w: 200, h: 100 }, cards: [], sections: [] });
  assert.deepEqual(empty.cards, []);
  assert.deepEqual(empty.sections, []);
});

test('stored row: exactly the stored fields, no extras', () => {
  const lines = storedRowLines(outline());
  const text = lines.join('\n');
  assert.doesNotThrow(() => JSON.parse(text.replace(/\n\s+/g, ' ')));
  const parsed = JSON.parse(text.replace(/\n\s+/g, ' '));
  assert.deepEqual(Object.keys(parsed), ['week', 'outline_id', 'frame', 'cards', 'sections', 'stats']);
  assert.deepEqual(Object.keys(parsed.stats), ['cards', 'kinds', 'depth', 'children', 'age', 'rotated', 'grids']);
  assert.deepEqual(Object.keys(parsed.cards[2]), ['k', 'x', 'y', 'w', 'h', 'z', 'r', 's', 'hd', 'g']);
  assert.equal(parsed.cards.length, 4);
});

test('jsonRuns splits a line into keys, values and punctuation, losing nothing', () => {
  const line = '    { "k": "note", "x": 10, "hd": true,';
  const runs = jsonRuns(line);
  assert.equal(runs.map((r) => r.s).join(''), line);
  assert.deepEqual(runs.filter((r) => r.t === 'k').map((r) => r.s), ['"k"', '"x"', '"hd"']);
  assert.deepEqual(runs.filter((r) => r.t === 'v').map((r) => r.s), ['"note"', '10', 'true']);
  const plain = '  ],';
  assert.deepEqual(jsonRuns(plain), [{ t: 'p', s: plain }]);
});

test('gallery text and drawer neighbours', () => {
  assert.equal(countText(312), '312 outlines');
  assert.equal(countText(1), '1 outline');
  assert.equal(countText(1200), '1,200 outlines');
  assert.equal(countText(undefined), '—');
  assert.equal(footText(48, 312, false), 'Showing 48 of 312');
  assert.equal(footText(9, 9, true), '9 of 9 match');
  assert.equal(footText(0, 0, false), '');
  const rows = [{ outline_id: 'a' }, { outline_id: 'b' }, { outline_id: 'c' }];
  assert.equal(neighbour(rows, 'b', -1), 'a');
  assert.equal(neighbour(rows, 'b', 1), 'c');
  assert.equal(neighbour(rows, 'a', -1), null);
  assert.equal(neighbour(rows, 'c', 1), null);
  assert.equal(neighbour(rows, 'zzz', 1), null);
});

const tools = (over = {}) => TOOLS.map((t) => ({ tool: t.id, left: { value: 0.2, people_n: 90 }, back: { value: 0.37, people_n: 60 }, ...(over[t.id] || {}) }));

test('returnView: tiles, rows, foot', () => {
  const v = returnView({
    week: '2027-02-22',
    tiles: {
      people: { left: { value: 153, people_n: 153 }, back: { value: 94, people_n: 94 } },
      cards_d1: { left: { value: 4, people_n: 153 }, back: { value: 17.5, people_n: 94 } },
      ten_d1: { left: { value: 0.12, people_n: 153 }, back: { value: 0.49, people_n: 94 } },
    },
    tools: tools({ undo: { left: { value: 0.5, people_n: 90 }, back: { value: 0.47, people_n: 60 } }, pen: { left: null }, rotate: { left: { value: 0.3, people_n: 9 }, back: { value: 0.3, people_n: 9 } } }),
  });
  assert.equal(v.empty, false);
  assert.deepEqual(v.tiles.map((t) => [t.label, t.value, t.sub]), [
    ['Came back', '38%', '94 of 247 people'],
    ['Cards on day one', '4 vs 17.5', 'median, left vs came back'],
    ['10+ cards on day one', '12% vs 49%', 'left vs came back'],
  ]);
  assert.deepEqual(v.rows.map((r) => r.id), TOOLS.map((t) => t.id));
  assert.equal(v.rows[0].label, 'Move cards');
  assert.deepEqual([v.rows[0].left.text, v.rows[0].back.text, v.rows[0].gap], ['20%', '37%', '+17 pts']);
  assert.equal(v.rows[0].left.alpha, heatAlpha(0.2));
  assert.equal(v.rows[0].back.alpha, heatAlpha(0.37));
  const undo = v.rows.find((r) => r.id === 'undo');
  assert.equal(undo.gap, '−3 pts');
  assert.equal(v.rows.find((r) => r.id === 'rotate').gap, '0 pts');
  const pen = v.rows.find((r) => r.id === 'pen');
  assert.deepEqual([pen.left.text, pen.left.na, pen.left.alpha, pen.gap], ['—', true, null, '—']);
  assert.deepEqual(v.foot, ['Left: 153 people', 'Came back: 94 people', '“Came back” is a second real visit within 7 days of the first, the rule the tests use.']);
});

test('returnView: missing sides, missing tools, nothing at all', () => {
  const one = returnView({
    tiles: { people: { left: { value: 30, people_n: 30 }, back: null }, cards_d1: { left: { value: 3, people_n: 30 }, back: null }, ten_d1: { left: null, back: null } },
    tools: [{ tool: 'undo', left: { value: 0.5, people_n: 30 }, back: null }, { tool: 'bogus', left: null, back: null }],
  });
  assert.equal(one.empty, false);
  assert.deepEqual(one.tiles.map((t) => [t.value, t.sub]), [
    ['—', 'Each side needs 20 people'], ['3 vs —', 'median, left vs came back'], ['— vs —', 'left vs came back'],
  ]);
  assert.deepEqual(one.rows.map((r) => r.id), ['undo']);
  assert.equal(one.rows[0].gap, '—');
  assert.deepEqual(one.foot, ['Left: 30 people', '“Came back” is a second real visit within 7 days of the first, the rule the tests use.']);
  for (const raw of [null, undefined, {}, { tiles: { people: { left: null, back: null } }, tools: [] }]) {
    const v = returnView(raw);
    assert.equal(v.empty, true);
    assert.equal(v.tiles[0].value, '—');
    assert.deepEqual(v.rows, []);
    assert.equal(v.foot.length, 1);
  }
});

test('returnSpan is the days the people joined, in words', () => {
  assert.equal(returnSpan('2026-11-09', null), '19 Oct to 15 Nov 2026');
  assert.equal(returnSpan('2027-01-04', null), '14 Dec 2026 to 10 Jan 2027');
  assert.equal(returnSpan('2026-11-23', '2026-11-12'), '12 Nov to 29 Nov 2026');
  assert.equal(returnSpan('2026-11-23', 'junk'), '2 Nov to 29 Nov 2026');
  assert.equal(returnSpan('nope', null), null);
});

test('returnReadyDate is the Monday two weeks on', () => {
  assert.equal(returnReadyDate('2027-02-22'), '8 Mar 2027');
  assert.equal(returnReadyDate('2026-12-28'), '11 Jan 2027');
  assert.equal(returnReadyDate('nope'), null);
  assert.equal(returnReadyDate(null), null);
});

test('whoTag: first-week outlines say whether the maker came back', () => {
  const at = (iso) => Date.parse(iso);
  assert.equal(whoTag({ first_week: false, came_back: true, week: '2027-02-22' }), '');
  assert.equal(whoTag(null), '');
  assert.equal(whoTag({ first_week: true, came_back: true, week: '2027-02-22' }), 'First week · came back');
  assert.equal(whoTag({ first_week: true, came_back: false, week: '2027-02-22' }), 'First week · left');
  const o = { first_week: true, came_back: null, week: '2027-02-22' };
  assert.equal(whoTag(o, at('2027-03-08T04:59:59Z')), 'First week · not known yet');
  assert.equal(whoTag(o, at('2027-03-08T05:00:00Z')), 'First week · not known');
  assert.equal(whoTag({ ...o, week: null }, at('2027-03-01T00:00:00Z')), 'First week · not known');
});
