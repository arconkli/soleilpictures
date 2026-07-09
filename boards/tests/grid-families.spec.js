// Pure-logic tests for the linked-grid grouping (lib/gridFamilies.js). Runs in
// the Playwright Node process (no React/Yjs). Pins the "tens of grids collapse
// into one expandable family" behavior.
import { expect, test } from '@playwright/test';
import { groupGridFamilies } from '../src/lib/gridFamilies.js';

const grid = (id, templateId, x = 0, y = 0) => ({
  id, kind: 'grid', name: id, preview: { mode: 'grid' },
  card: { id, kind: 'grid', templateId, x, y, w: 100, h: 100 },
});
const other = (id, kind = 'image') => ({ id, kind, name: id, card: { id, kind } });

test('a family of >=2 linked grids collapses into one group node with ordered members', () => {
  const items = [
    grid('g1', 'tpl-A', 0, 0),
    other('img1'),
    grid('g2', 'tpl-A', 200, 0),
    grid('g3', 'tpl-A', 400, 0),
    other('note1', 'note'),
  ];
  const out = groupGridFamilies(items, { gridTemplates: { 'tpl-A': { name: 'Storyboard' } } });

  // group replaces the 3 grids at the FIRST member's position; others stay put
  expect(out.map(x => x.isGroup ? `grp:${x.count}` : x.id)).toEqual(['grp:3', 'img1', 'note1']);
  const grp = out.find(x => x.isGroup);
  expect(grp.name).toBe('Storyboard');
  expect(grp.templateId).toBe('tpl-A');
  expect(grp.members.map(m => m.id)).toEqual(['g1', 'g2', 'g3']); // spatial (left→right) order
  expect(grp.preview).toEqual({ mode: 'grid' });
});

test('a lone linked grid (singleton family) is NOT grouped', () => {
  const items = [grid('g1', 'tpl-solo'), other('img1')];
  const out = groupGridFamilies(items, { gridTemplates: { 'tpl-solo': { name: 'X' } } });
  expect(out.some(x => x.isGroup)).toBe(false);
  expect(out.map(x => x.id)).toEqual(['g1', 'img1']);
});

test('unlinked grids and non-grid items pass through untouched', () => {
  const items = [
    { id: 'gu', kind: 'grid', name: 'gu', card: { id: 'gu', kind: 'grid' /* no templateId */ } },
    other('img1'), other('pdf1', 'pdf'),
  ];
  const out = groupGridFamilies(items, {});
  expect(out).toEqual(items); // identical shape, no grouping
});

test('family name falls back when the template has no name', () => {
  const items = [grid('g1', 'tpl-x', 0, 0), grid('g2', 'tpl-x', 200, 0)];
  const out = groupGridFamilies(items, { gridTemplates: {} });
  expect(out.find(x => x.isGroup).name).toBe('Grid family');
});

test('two distinct families each collapse independently', () => {
  const items = [
    grid('a1', 'A', 0, 0), grid('b1', 'B', 0, 300),
    grid('a2', 'A', 200, 0), grid('b2', 'B', 200, 300),
  ];
  const out = groupGridFamilies(items, { gridTemplates: { A: { name: 'A' }, B: { name: 'B' } } });
  const groups = out.filter(x => x.isGroup);
  expect(groups.length).toBe(2);
  expect(groups.map(g => `${g.templateId}:${g.count}`).sort()).toEqual(['A:2', 'B:2']);
});
