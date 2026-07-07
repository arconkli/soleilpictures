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
