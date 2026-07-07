// Pure-logic tests for the cluster-browser normalization + sort/filter/search
// (lib/listItem.js). Dependency-free, so runs straight in the Playwright Node
// process. Pins the two things that used to be broken/missing in the list view:
//   1) EVERY card kind normalizes to a real item (no generic "·" fallback),
//      including the newer file/video/audio/pdf/grid.
//   2) sort/filter/search are stable and put missing size/date values last.
import { expect, test } from '@playwright/test';
import { toListItem, sortItems, filterItems, matchItems, typeBucket, TYPE_LABELS } from '../src/lib/listItem.js';

const KINDS = ['image', 'pdf', 'video', 'audio', 'file', 'note', 'link', 'doc', 'palette', 'schedule', 'shape', 'grid'];

test('every kind normalizes to an item with a non-empty name', () => {
  for (const kind of KINDS) {
    const card = { id: `${kind}-1`, kind, createdAt: '2026-07-01T00:00:00Z' };
    const it = toListItem(card, {});
    expect(it, `kind ${kind}`).toBeTruthy();
    expect(it.name && it.name.length > 0, `kind ${kind} has a name`).toBe(true);
    expect(it.typeLabel).toBe(TYPE_LABELS[kind]);
  }
});

test('file card carries size + ext, image reads size from primed meta', () => {
  const file = toListItem({ id: 'file-1', kind: 'file', fileName: 'a.zip', ext: 'zip', mime: 'application/zip', sizeBytes: 2048 }, {});
  expect(file.sizeBytes).toBe(2048);
  expect(file.preview.mode).toBe('file');
  expect(file.preview.ext).toBe('zip');

  const getMeta = (key) => (key === 'k1' ? { sizeBytes: 999 } : null);
  const img = toListItem({ id: 'img-1', kind: 'image', src: 'r2:k1', title: 'Hero' }, { getMeta });
  expect(img.sizeBytes).toBe(999);
  expect(img.preview.mode).toBe('r2');
});

test('typeBucket collapses clusters + catches unknowns', () => {
  expect(typeBucket('board')).toBe('cluster');
  expect(typeBucket('boardlink')).toBe('cluster');
  expect(typeBucket('shape')).toBe('other');
  expect(typeBucket('image')).toBe('image');
});

test('sortItems: size sorts numerically with missing values last (both directions)', () => {
  const items = [
    { id: 'a', name: 'a', sizeBytes: 100, z: 1 },
    { id: 'b', name: 'b', sizeBytes: null, z: 2 },
    { id: 'c', name: 'c', sizeBytes: 5, z: 3 },
  ];
  const desc = sortItems(items, 'size', 'desc').map(i => i.id);
  expect(desc).toEqual(['a', 'c', 'b']); // 100, 5, then missing last
  const asc = sortItems(items, 'size', 'asc').map(i => i.id);
  expect(asc).toEqual(['c', 'a', 'b']); // 5, 100, then missing STILL last
});

test('sortItems: undated cards fall back to z-order, no NaN jumps', () => {
  const items = [
    { id: 'a', name: 'a', updatedAt: '2026-07-01T00:00:00Z', z: 5 },
    { id: 'b', name: 'b', updatedAt: null, z: 1 },
    { id: 'c', name: 'c', updatedAt: null, z: 2 },
  ];
  const out = sortItems(items, 'updated', 'desc').map(i => i.id);
  expect(out[0]).toBe('a');              // dated first
  expect(out.slice(1)).toEqual(['b', 'c']); // undated fall back to z-order (1,2)
});

test('sortItems: name is case-insensitive + numeric-aware', () => {
  const items = [{ id: '1', name: 'file10' }, { id: '2', name: 'File2' }, { id: '3', name: 'file1' }];
  expect(sortItems(items, 'name', 'asc').map(i => i.name)).toEqual(['file1', 'File2', 'file10']);
});

test('rich preview marks: grid/doc/schedule/shape/note/link resolve real modes (no generic icon)', () => {
  const doc = toListItem({ id: 'd', kind: 'doc', title: 'T', lines: [{ t: 'a', h: 1 }, { t: 'b' }, { bullet: true, t: 'c' }] }, {});
  expect(doc.preview.mode).toBe('doc');
  expect(doc.preview.lines.length).toBe(3);
  expect(doc.preview.lines[0].heading).toBe(true);
  expect(doc.preview.lines[2].bullet).toBe(true);

  const sched = toListItem({ id: 's', kind: 'schedule', rows: [{ day: 'Mon' }, { when: 'Tue' }] }, {});
  expect(sched.preview.mode).toBe('schedule');
  expect(sched.preview.rows.length).toBe(2);

  const shape = toListItem({ id: 'sh', kind: 'shape', shape: 'star', fill: '#f00', stroke: '#0f0' }, {});
  expect(shape.preview.mode).toBe('shape');
  expect(shape.preview.shape).toBe('star');

  const note = toListItem({ id: 'n', kind: 'note', html: '<p>Hello <b>world</b></p>' }, {});
  expect(note.preview.mode).toBe('note');
  expect(note.preview.text).toContain('Hello world');

  const link = toListItem({ id: 'l', kind: 'link', source: 'https://example.com', favicon: 'https://example.com/fav.ico' }, {});
  expect(link.preview.mode).toBe('link');
  expect(link.preview.favicon).toContain('fav.ico');

  const linkImg = toListItem({ id: 'l2', kind: 'link', source: 'x.com', image: 'r2:og' }, {});
  expect(linkImg.preview.mode).toBe('r2'); // an OG image beats the favicon mark
});

test('grid preview: tiles the box exactly, resolves a linked template, respects the cap', () => {
  const leaf = (id) => ({ type: 'leaf', id, frac: 1 });
  const twoUp = (a, b) => ({ type: 'row', frac: 1, children: [{ ...leaf(a), frac: 0.5 }, { ...leaf(b), frac: 0.5 }] });
  const layout = { type: 'col', frac: 1, children: [{ ...twoUp('c1', 'c2'), frac: 0.5 }, { ...twoUp('c3', 'c4'), frac: 0.5 }] };

  const own = toListItem({ id: 'g', kind: 'grid', layout, cells: { c1: { type: 'image' }, c2: { type: 'empty' } } }, {});
  expect(own.preview.mode).toBe('grid');
  expect(own.preview.rects.length).toBe(4);
  const area = own.preview.rects.reduce((s, r) => s + r.w * r.h, 0); // full coverage, no overlap
  expect(Math.abs(area - 1) < 1e-9).toBe(true);
  expect(own.preview.cells.c1.type).toBe('image');

  // linked grid: layout comes from the shared gridTemplates snapshot
  const linked = toListItem({ id: 'g2', kind: 'grid', templateId: 'tpl' }, { gridTemplates: { tpl: { layout } } });
  expect(linked.preview.mode).toBe('grid');
  expect(linked.preview.rects.length).toBe(4);

  // >64 cells → sliced to the cap, content tint dropped
  const many = { type: 'row', frac: 1, children: Array.from({ length: 70 }, (_, i) => ({ type: 'leaf', id: `m${i}`, frac: 1 })) };
  const capped = toListItem({ id: 'g4', kind: 'grid', layout: many, cells: { m0: { type: 'image' } } }, {});
  expect(capped.preview.rects.length).toBe(64);
  expect(capped.preview.cells).toBe(null);

  // no layout anywhere → clean icon fallback
  expect(toListItem({ id: 'g3', kind: 'grid' }, {}).preview.mode).toBe('icon');
});

test('filterItems + matchItems', () => {
  const items = [
    { id: 'a', name: 'sunset.jpg', typeBucket: 'image', typeLabel: 'Image', sub: '' },
    { id: 'b', name: 'trailer.mp4', typeBucket: 'video', typeLabel: 'Video', sub: '' },
    { id: 'c', name: 'notes', typeBucket: 'note', typeLabel: 'Note', sub: 'sunset ideas' },
  ];
  expect(filterItems(items, new Set(['image', 'video'])).map(i => i.id)).toEqual(['a', 'b']);
  expect(filterItems(items, new Set()).length).toBe(3); // empty = no filter
  expect(matchItems(items, 'sunset').map(i => i.id).sort()).toEqual(['a', 'c']); // name + sub
  expect(matchItems(items, 'VIDEO').map(i => i.id)).toEqual(['b']); // typeLabel, case-insensitive
});
