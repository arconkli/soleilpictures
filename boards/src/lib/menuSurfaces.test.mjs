// One cluster menu and one file menu on every surface: the surfaces build them
// with lib/menus/* (not menus of their own), and clusterActsFrom binds the
// shared action set without breaking a surface that has none (the local app).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clusterMenu, clusterActsFrom, coverTints } from './menus/clusterMenu.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const noop = () => {};
const ids = (items) => items.map((it) => (it.divider ? '-' : it.id));

const CLUSTER_SURFACES = [
  'components/SidebarBoardTree.jsx',
  'components/ListSurface.jsx',
  'components/shared/SharedPage.jsx',
  'components/SidebarSharedBoards.jsx',
  'components/home/ClustersHome.jsx',
];
const FILE_SURFACES = ['components/sidebar/ClusterSidebar.jsx', 'components/ListSurface.jsx'];

test('every cluster surface builds its menu with clusterMenu', () => {
  for (const f of CLUSTER_SURFACES) assert.match(read(f), /clusterMenu\(/, f);
});

test('the file surfaces build theirs with fileMenu / filesMenu', () => {
  for (const f of FILE_SURFACES) {
    const src = read(f);
    assert.match(src, /fileMenu as buildFileMenu|fileMenu\(/, f);
    assert.match(src, /filesMenu\(/, f);
  }
  assert.match(read('components/ListSurface.jsx'), /floorMenu\(/);
});

test('no surface keeps its own hand-rolled menu sections', () => {
  for (const f of [...CLUSTER_SURFACES, ...FILE_SURFACES, 'components/sidebar/ClusterSidebar.jsx']) {
    assert.doesNotMatch(read(f), /composeMenuSections/, f);
  }
  assert.doesNotMatch(read('components/SidebarSharedBoards.jsx'), /function RowMenu/);
});

test('clusterActsFrom: empty without the action set or a cluster', () => {
  assert.deepEqual(clusterActsFrom(null, { id: 'b1' }), {});
  assert.deepEqual(clusterActsFrom({}, {}), {});
});

const cc = (over = {}) => ({
  open: noop, share: noop, copyLink: noop, newInside: noop, moveTo: noop, info: noop, copy: noop,
  pasteInto: noop, canPaste: () => true, remove: noop, removeFromList: noop,
  isStarred: () => false, toggleStar: noop, opensInFiles: () => false, setOpensInFiles: noop,
  setTint: noop, pickColor: noop, pickThumb: noop, resetThumb: noop,
  canSend: () => true, send: noop, ...over,
});

test('clusterActsFrom: Send to… only where the action set offers it; star and files rows can be hidden', () => {
  const b = { id: 'b1', name: 'Night' };
  assert.ok(clusterActsFrom(cc(), b).send);
  assert.ok(!clusterActsFrom(cc({ canSend: () => false }), b).send);
  const bare = clusterActsFrom(cc(), b, { star: false, opensInFiles: false });
  assert.ok(!bare.star && !bare['opens-in-files']);
  assert.ok(!clusterActsFrom(cc(), b)['color-cover'], 'no colour row without tints');
  const tinted = clusterActsFrom(cc(), { ...b, thumb_custom: true }, { tints: coverTints({ neutral: '#888', blue: '#00f' }) });
  assert.ok(tinted['color-cover'].reset);
  assert.ok(!clusterActsFrom(cc(), b, { tints: [] })['color-cover'].reset);
});

test('clusterActsFrom: Send to… records the surface it came from', () => {
  const seen = [];
  const acts = clusterActsFrom(cc({ send: (id, surface) => seen.push([id, surface]) }), { id: 'b1' }, { surface: 'home_menu' });
  acts.send();
  assert.deepEqual(seen, [['b1', 'home_menu']]);
});

test('clusterMenu: a viewer on the Shared sidebar gets Open, Send to…, Copy link, Remove from my list', () => {
  const m = clusterMenu({ name: 'Shared one' }, { edit: false, canRemoveFromList: true }, {
    open: noop, send: noop, 'copy-link': noop, 'remove-from-list': noop, delete: noop, rename: noop,
  });
  assert.deepEqual(ids(m.items), ['open', 'send', 'copy-link', '-', 'remove-from-list']);
});

test('clusterMenu: a hold on a touch Files page starts with Select (not while selecting)', () => {
  const acts = { select: noop, open: noop, rename: noop };
  assert.equal(clusterMenu({ name: 'A' }, { edit: true, touch: true }, acts).items[0].id, 'select');
  assert.equal(clusterMenu({ name: 'A' }, { edit: false, touch: true }, acts).items[0].id, 'select');
  assert.equal(clusterMenu({ name: 'A' }, { edit: true, touch: true, selecting: true }, acts).items[0].id, 'open');
  assert.equal(clusterMenu({ name: 'A' }, { edit: true }, acts).items[0].id, 'open');
});
