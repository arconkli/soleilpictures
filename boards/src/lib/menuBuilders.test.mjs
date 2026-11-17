// The right-click menu builders (lib/menus/*): exact rows and order per menu,
// dividers, hidden rows, viewer allow-lists, quick rows, plural titles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROWS, row, layout, quickRow, radioRows,
  cardMenu, multiMenu, groupMenu, arrowMenu, commentPinMenu, KIND_LAYOUT,
  canvasMenu, addMenu, moveToClusterRows, clusterMenu, fileMenu, filesMenu, floorMenu,
} from './menus/index.js';
import { mod, shift, plain, del } from './menus/shortcuts.js';

const noop = () => {};
// An act for every catalogue row (and backlinks), minus `omit`.
const everything = (omit = []) => {
  const a = Object.fromEntries(Object.keys(ROWS).map((id) => [id, noop]));
  a.backlinks = true;
  for (const id of omit) delete a[id];
  return a;
};
const only = (...ids) => Object.fromEntries(ids.map((id) => [id, noop]));
// Ids in order, '-' for a divider, 'caption:…' for a caption, 'backlinks'.
const ids = (items) => items.map((it) => (it.divider ? '-' : it.caption !== undefined ? `caption:${it.caption}` : it.backlinks ? 'backlinks' : it.id));
const sub = (items, id) => items.find((it) => it.id === id).submenu;

function walk(items, visit) {
  for (const it of items) {
    visit(it);
    if (it.submenu) walk(it.submenu, visit);
  }
}
function assertClean(items, where) {
  assert.ok(!items.length || !items[0].divider, `${where}: starts with a divider`);
  assert.ok(!items.length || !items[items.length - 1].divider, `${where}: ends with a divider`);
  items.forEach((it, i) => {
    if (it.divider) assert.ok(!items[i - 1]?.divider, `${where}: doubled divider`);
    if (it.submenu) assertClean(it.submenu, `${where} > ${it.id}`);
  });
  walk(items, (it) => {
    if (typeof it.label === 'string') {
      assert.ok(!/\(\d/.test(it.label), `${where}: "${it.label}" has (N)`);
      assert.ok(!it.label.includes('✓'), `${where}: "${it.label}" has a typed check`);
    }
  });
}
function assertMenu(menu, where) {
  assertClean(menu.items, where);
  (menu.quick || []).forEach((q) => assert.ok(q.run, `${where}: quick ${q.id} has no run`));
  if (menu.title) assert.ok(!/\(\d/.test(menu.title));
}

const tints = [{ key: 'neutral', swatch: '#6b6760' }, { key: 'warm', swatch: '#b88958' }];
const coverAct = { tints, current: 'warm', setTint: noop, custom: noop, upload: noop, reset: noop };

test('shortcuts: platform strings', () => {
  assert.match(mod('D'), /^(⌘D|Ctrl\+D)$/);
  assert.match(shift('1'), /^(⇧1|Shift\+1)$/);
  assert.equal(plain(']'), ']');
  assert.equal(del(), '⌫');
});

test('row: catalogue values overridden by the act; shown only with an act', () => {
  assert.equal(row('cut', null), null);
  assert.equal(row('cut', undefined), null);
  const r = row('cut', noop);
  assert.equal(r.id, 'cut');
  assert.equal(r.label, 'Cut');
  assert.equal(r.icon, 'Scissors');
  assert.equal(r.shortcut, mod('X'));
  assert.equal(r.run, noop);
  const o = row('send', { run: noop, label: 'Send 3 cards to…', hint: 'h', aside: 'a', disabled: true });
  assert.deepEqual([o.label, o.hint, o.aside, o.disabled, o.run], ['Send 3 cards to…', 'h', 'a', true, noop]);
  assert.equal(row('star', { run: noop, starred: true }).label, 'Unstar');
  assert.equal(row('star', { run: noop }).label, 'Star');
  assert.equal(row('delete', noop).danger, true);
  assert.equal(row('keep-in-files', noop).hint, 'Takes it off the canvas');
  assert.equal(row('cut', { run: noop, shortcut: null }).shortcut, undefined);
});

test('layout: dividers only between non-empty groups, never doubled or at the ends', () => {
  const acts = only('a', 'b');
  ROWS.a = { icon: null, label: () => 'A' };
  ROWS.b = { icon: null, label: () => 'B' };
  try {
    assert.deepEqual(ids(layout([['x'], ['a'], [], ['y', 'z'], ['b'], ['q']], acts)), ['a', '-', 'b']);
    assert.deepEqual(ids(layout([[], []], acts)), []);
    assert.deepEqual(ids(layout([['a', { divider: true }, { divider: true }, 'b']], acts)), ['a', '-', 'b']);
  } finally {
    delete ROWS.a;
    delete ROWS.b;
  }
});

test('quickRow: extracts the present quick rows in order', () => {
  assert.deepEqual(quickRow(['cut', 'copy', 'duplicate', 'delete'], only('delete', 'cut')).map((q) => q.id), ['cut', 'delete']);
});

test('radioRows: checked + radio, no typed tick', () => {
  const rows = radioRows([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], 'b', noop);
  assert.deepEqual(rows.map((r) => [r.id, r.checked, r.radio]), [['a', false, true], ['b', true, true]]);
});

test('cardMenu image, editor', () => {
  const m = cardMenu({ kind: 'image' }, { canEdit: true }, everything(['note-comments']));
  assert.deepEqual(m.quick.map((q) => q.id), ['cut', 'copy', 'duplicate', 'delete']);
  assert.deepEqual(ids(m.items), [
    'view-full', 'edit-photo', 'edit', '-',
    'send', 'copy-link', 'share-file', 'share-doc', 'download', '-',
    'comment', 'tag', 'vote', 'move', 'copy-to', 'add-to-group', 'arrange', '-',
    'info', 'backlinks',
  ]);
  assert.deepEqual(ids(sub(m.items, 'edit')), ['rename', 'caption', 'hyperlink', 'replace-image', 'upload-version']);
  assert.deepEqual(ids(sub(m.items, 'arrange')), ['arrange-front', 'arrange-forward', 'arrange-backward', 'arrange-back']);
  assert.equal(sub(m.items, 'arrange')[1].shortcut, ']');
  assert.equal(sub(m.items, 'arrange')[2].shortcut, '[');
  assert.equal(sub(m.items, 'arrange')[0].shortcut, undefined);
  assertMenu(m, 'image');
});

test('cardMenu video, editor', () => {
  const m = cardMenu({ kind: 'video' }, { canEdit: true }, everything(['note-comments', 'share-doc']));
  assert.deepEqual(ids(m.items).slice(0, 2), ['open-player', 'edit']);
  assert.deepEqual(ids(sub(m.items, 'edit')), ['rename', 'upload-version', 'autoplay', 'loop', 'start-here', 'start-at', 'clear-start']);
  assertMenu(m, 'video');
});

test('cardMenu note, link, audio, doc: open group', () => {
  const acts = everything(['note-comments', 'share-file', 'share-doc']);
  assert.deepEqual(ids(cardMenu({ kind: 'note' }, { canEdit: true }, acts).items).slice(0, 3), ['fit-content', '-', 'send']);
  assert.deepEqual(ids(cardMenu({ kind: 'link' }, { canEdit: true }, acts).items).slice(0, 3), ['open-link', 'rename', '-']);
  assert.deepEqual(ids(sub(cardMenu({ kind: 'audio' }, { canEdit: true }, acts).items, 'edit')), ['rename', 'upload-version', 'cover', 'remove-cover', 'loop']);
  assert.deepEqual(ids(cardMenu({ kind: 'doc' }, { canEdit: true }, acts).items).slice(0, 2), ['open-doc', '-']);
  assert.deepEqual(ids(cardMenu({ kind: 'pdf' }, { canEdit: true }, acts).items).slice(0, 3), ['open', 'edit', '-']);
  assert.deepEqual(ids(sub(cardMenu({ kind: 'pdf' }, { canEdit: true }, acts).items, 'edit')), ['rename', 'upload-version']);
  assert.deepEqual(ids(cardMenu({ kind: 'shape' }, { canEdit: true }, acts).items).slice(0, 3), ['shape', 'stroke', '-']);
  assert.deepEqual(ids(sub(cardMenu({ kind: 'shape' }, { canEdit: true }, acts).items, 'stroke')),
    ['stroke-color', 'fill-color', '-', 'stroke-1', 'stroke-2', 'stroke-4', 'stroke-8']);
  assert.deepEqual(ids(sub(cardMenu({ kind: 'grid' }, { canEdit: true }, acts).items, 'templates')), ['save-template', 'apply-template', 'share-layout']);
  assert.ok(Object.keys(KIND_LAYOUT).length === 16);
});

test('cardMenu: a single-row Edit is hoisted to a plain row', () => {
  const m = cardMenu({ kind: 'image' }, { canEdit: true }, only('view-full', 'rename'));
  assert.deepEqual(ids(m.items), ['view-full', 'rename']);
  assert.equal(m.items[1].submenu, undefined);
  const none = cardMenu({ kind: 'image' }, { canEdit: true }, only('view-full'));
  assert.deepEqual(ids(none.items), ['view-full']);
});

test('cardMenu board (cluster card) with Color and cover', () => {
  const acts = { ...everything(['note-comments', 'group-menu']), 'color-cover': coverAct };
  const m = cardMenu({ kind: 'board' }, { canEdit: true }, acts);
  assert.deepEqual(ids(m.items), [
    'open-cluster', 'color-cover', 'copy-to-workspace', '-',
    'send', 'share-cluster', 'copy-link', '-',
    'rename', 'comment', 'tag', 'move', 'add-to-group', 'arrange', '-',
    'star', 'info',
  ]);
  const cover = sub(m.items, 'color-cover');
  assert.deepEqual(ids(cover), ['cover-neutral', 'cover-warm', '-', 'cover-custom', 'upload-thumb', 'reset-thumb']);
  assert.deepEqual(cover.slice(0, 2).map((c) => [c.checked, c.radio, !!c.swatch]), [[false, true, true], [true, true, true]]);
  // No custom thumbnail: no reset row.
  const noReset = cardMenu({ kind: 'board' }, { canEdit: true }, { 'color-cover': { ...coverAct, reset: undefined } });
  assert.deepEqual(ids(sub(noReset.items, 'color-cover')).slice(-2), ['cover-custom', 'upload-thumb']);
  assertMenu(m, 'board');
});

test('cardMenu: Group "Name" > replaces Add to group for a grouped card', () => {
  const acts = {
    ...only('move', 'add-to-group'),
    'group-menu': { name: 'Hero', acts: only('rename-group', 'group-info', 'remove-from-group', 'ungroup') },
  };
  const m = cardMenu({ kind: 'note' }, { canEdit: true }, acts);
  assert.deepEqual(ids(m.items), ['move', 'group-menu']);
  assert.equal(m.items[1].label, 'Group "Hero"');
  assert.deepEqual(ids(sub(m.items, 'group-menu')), ['rename-group', '-', 'group-info', '-', 'remove-from-group', 'ungroup']);
});

test('cardMenu other kinds: boardlink, shortcut, schedule, palette', () => {
  const acts = everything(['note-comments', 'share-file', 'share-doc']);
  assert.deepEqual(ids(cardMenu({ kind: 'boardlink' }, { canEdit: true }, acts).items).slice(0, 2), ['open-linked', '-']);
  assert.deepEqual(ids(cardMenu({ kind: 'shortcut' }, { canEdit: true }, acts).items).slice(0, 2), ['open', '-']);
  assert.deepEqual(ids(cardMenu({ kind: 'schedule' }, { canEdit: true }, acts).items).slice(0, 4), ['schedule-view', 'go-today', 'rename', '-']);
  assert.deepEqual(ids(cardMenu({ kind: 'palette' }, { canEdit: true }, acts).items).slice(0, 4), ['eyedrop', 'pick-from-image', 'labels', '-']);
});

test('cardMenu: rows hidden when acts are missing, nothing greyed', () => {
  const none = cardMenu({ kind: 'image' }, { canEdit: true }, {});
  assert.deepEqual(none.items, []);
  assert.equal(none.quick, undefined);
  const some = cardMenu({ kind: 'note' }, { canEdit: true }, only('copy', 'info', 'tag'));
  assert.deepEqual(some.quick.map((q) => q.id), ['copy']);
  assert.deepEqual(ids(some.items), ['tag', '-', 'info']);
  assert.ok(!ids(some.items).includes('copy'), 'quick rows are not repeated in the list');
});

test('cardMenu note-comments: plural label from the act count', () => {
  const m = cardMenu({ kind: 'note' }, { canEdit: true }, { 'note-comments': { run: noop, count: 1 } });
  assert.equal(m.items[0].label, '1 comment');
  assert.equal(cardMenu({ kind: 'note' }, { canEdit: true }, { 'note-comments': { run: noop, count: 3 } }).items[0].label, '3 comments');
});

test('cardMenu view-only: allow-list, no quick row', () => {
  const acts = everything();
  const image = cardMenu({ kind: 'image' }, { canEdit: false }, acts);
  assert.equal(image.quick, undefined);
  assert.deepEqual(ids(image.items), ['view-full', '-', 'send', 'copy-link', 'download', '-', 'comment', 'note-comments', 'copy-to', '-', 'info', 'backlinks']);
  assert.deepEqual(ids(cardMenu({ kind: 'note' }, { canEdit: false }, acts).items), ['send', 'copy-link', 'download', '-', 'comment', 'note-comments', 'copy-to', '-', 'info', 'backlinks']);
  assert.deepEqual(ids(cardMenu({ kind: 'video' }, { canEdit: false }, acts).items).slice(0, 2), ['open-player', '-']);
  assert.deepEqual(ids(cardMenu({ kind: 'board' }, { canEdit: false }, acts).items), ['open-cluster', '-', 'send', 'copy-link', '-', 'comment', 'note-comments', 'copy-to', '-', 'info']);
  assertMenu(image, 'viewer image');
});

test('multiMenu: editor', () => {
  const m = multiMenu(3, { canEdit: true }, everything());
  assert.equal(m.title, '3 cards');
  assert.equal(m.label, '3 cards');
  assert.deepEqual(m.quick.map((q) => q.id), ['cut', 'copy', 'duplicate', 'delete']);
  assert.deepEqual(ids(m.items), [
    'send', 'download', '-',
    'tag', 'move', 'copy-to', 'group-these', 'add-to-group', 'remove-from-group', 'new-cluster-from', '-',
    'align', 'arrange', 'tidy', '-',
    'info',
  ]);
  assert.equal(m.items.find((i) => i.id === 'group-these').shortcut, mod('G'));
  assert.deepEqual(ids(sub(m.items, 'align')), [
    'align-left', 'align-center', 'align-right', 'align-top', 'align-middle', 'align-bottom', '-', 'distribute-h', 'distribute-v']);
  assert.deepEqual(ids(sub(m.items, 'tidy')), ['tidy-justified', 'tidy-masonry', 'tidy-grid', 'tidy-row', 'tidy-column']);
  assertMenu(m, 'multi');
});

test('Keep in Files only stands alone where Move would sit when there is no Move row', () => {
  const acts = only('keep-in-files', 'tag', 'info');
  const one = cardMenu({ kind: 'image' }, { canEdit: true }, acts);
  assert.ok(ids(one.items).includes('keep-in-files'));
  const many = multiMenu(3, { canEdit: true }, acts);
  assert.deepEqual(ids(many.items).filter((i) => i === 'keep-in-files' || i === 'move'), ['keep-in-files']);
  const both = multiMenu(3, { canEdit: true }, only('keep-in-files', 'move'));
  assert.deepEqual(ids(both.items), ['move']);
});

test('multiMenu: two cards offer no Distribute; plural title', () => {
  const m = multiMenu(2, { canEdit: true }, everything(['distribute-h', 'distribute-v', 'download']));
  assert.equal(m.title, '2 cards');
  assert.ok(!ids(sub(m.items, 'align')).includes('distribute-h'));
  assert.ok(!ids(sub(m.items, 'align')).includes('-'));
  assert.ok(!ids(m.items).includes('download'));
  assert.equal(multiMenu(1, { canEdit: true }, {}).title, '1 card');
  assert.equal(multiMenu(5, { canEdit: true }, {}).title, '5 cards');
});

test('multiMenu: view-only is title, send, copy-to, info', () => {
  const m = multiMenu(4, { canEdit: false }, everything());
  assert.equal(m.title, '4 cards');
  assert.equal(m.quick, undefined);
  assert.deepEqual(ids(m.items), ['send', 'copy-to', '-', 'info']);
});

test('groupMenu: editor, member card, viewer', () => {
  const acts = everything();
  const m = groupMenu({ canEdit: true, name: 'Hero' }, acts);
  assert.equal(m.label, 'Group "Hero"');
  assert.deepEqual(ids(m.items), [
    'rename-group', 'group-comment', 'tag-group', '-',
    'outline', 'group-label', 'outline-shape', 'outline-color', '-',
    'turn-into-cluster', 'group-info', '-',
    'remove-from-group', 'ungroup',
  ]);
  assert.deepEqual(ids(sub(m.items, 'outline-shape')), ['outline-box', 'outline-hug']);
  assert.equal(m.items.find((i) => i.id === 'ungroup').danger, true);
  // Not a member: no Remove from group.
  assert.ok(!ids(groupMenu({ canEdit: true }, everything(['remove-from-group'])).items).includes('remove-from-group'));
  const v = groupMenu({ canEdit: false }, acts);
  assert.deepEqual(ids(v.items), ['group-comment', 'group-info']);
  assertMenu(m, 'group');
});

test('groupMenu: toggles use checked, shape rows use radio', () => {
  const m = groupMenu({ canEdit: true }, {
    outline: { run: noop, checked: true },
    'outline-box': { run: noop, checked: true, radio: true },
    'outline-hug': { run: noop, checked: false, radio: true },
  });
  assert.equal(m.items[0].checked, true);
  assert.deepEqual(sub(m.items, 'outline-shape').map((r) => [r.checked, r.radio]), [[true, true], [false, true]]);
});

test('arrowMenu: editor rows; viewers get no menu', () => {
  const m = arrowMenu({ canEdit: true }, everything());
  assert.deepEqual(ids(m.items), ['arrow-label', '-', 'curved', 'two-way', 'dashed', 'reset-curve', '-', 'delete-arrow']);
  assert.equal(m.items[0].label, 'Add label…');
  assert.equal(arrowMenu({ canEdit: true }, { 'arrow-label': { run: noop, has: true } }).items[0].label, 'Edit label…');
  assert.ok(!ids(arrowMenu({ canEdit: true }, everything(['reset-curve'])).items).includes('reset-curve'));
  assert.deepEqual(arrowMenu({ canEdit: false }, everything()).items, []);
  assert.equal(m.items.at(-1).danger, true);
  assertMenu(m, 'arrow');
});

test('commentPinMenu: only rows with acts', () => {
  assert.deepEqual(ids(commentPinMenu({}, everything()).items), ['open-comment', 'resolve', 'reopen', 'copy-comment-link', '-', 'delete-comment']);
  assert.deepEqual(ids(commentPinMenu({}, only('open-comment', 'resolve')).items), ['open-comment', 'resolve']);
  assert.deepEqual(ids(commentPinMenu({}, only('open-comment', 'delete-comment')).items), ['open-comment', '-', 'delete-comment']);
  assert.deepEqual(commentPinMenu({}, {}).items, []);
});

test('canvasMenu: editor', () => {
  const bg = { options: [{ key: 'default', swatch: 'transparent' }, { key: 'paper', swatch: '#f5f2ec' }], current: 'paper', pick: noop, custom: noop };
  const acts = { ...everything(), background: bg };
  const m = canvasMenu({ canEdit: true }, acts);
  assert.deepEqual(m.quick.map((q) => q.id), ['add-note', 'add-image', 'add-cluster', 'add-doc', 'add-link']);
  assert.equal(m.quick[0].shortcut, undefined);
  assert.deepEqual(ids(m.items), [
    'delete-drawn', '-',
    'add', 'paste', 'select-all', 'select-touch', '-',
    'tidy', 'fit', '-',
    'background', 'export', '-',
    'share-cluster', 'copy-link', 'tag-cluster', 'cluster-info', '-',
    'clear-drawings',
  ]);
  assert.equal(m.items.find((i) => i.id === 'fit').shortcut, shift('1'));
  assert.equal(m.items.find((i) => i.id === 'paste').shortcut, mod('V'));
  assert.deepEqual(ids(sub(m.items, 'background')), ['bg-default', 'bg-paper', '-', 'bg-custom']);
  assert.deepEqual(sub(m.items, 'background').slice(0, 2).map((r) => [r.checked, r.radio]), [[false, true], [true, true]]);
  assert.deepEqual(ids(sub(m.items, 'export')), ['export-png', 'export-pdf']);
  assert.ok(sub(m.items, 'add').length > 10);
  assertMenu(m, 'canvas');
});

test('canvasMenu: a quick button takes the act\'s quickLabel, Add › keeps the plain name', () => {
  const m = canvasMenu({ canEdit: true }, { 'add-note': { run: noop, quickLabel: 'Add a note' }, 'add-image': noop });
  assert.deepEqual(m.quick.map((q) => q.label), ['Add a note', 'Image']);
  // A phone's tile shows the plain name; a button with no quickLabel has none.
  assert.deepEqual(m.quick.map((q) => q.short), ['Note', undefined]);
  assert.equal(sub(m.items, 'add')[0].label, 'Note');
});

test('canvasMenu: only what is there; Paste can be disabled; no drawings rows by default', () => {
  const m = canvasMenu({ canEdit: true }, { paste: { run: noop, disabled: true }, 'select-all': noop, 'cluster-info': noop });
  assert.equal(m.quick, undefined);
  assert.deepEqual(ids(m.items), ['paste', 'select-all', '-', 'cluster-info']);
  assert.equal(m.items[0].disabled, true);
});

test('canvasMenu: viewer', () => {
  const m = canvasMenu({ canEdit: false }, everything());
  assert.equal(m.quick, undefined);
  assert.deepEqual(ids(m.items), ['comment', '-', 'select-all', 'select-touch', '-', 'copy-link', 'cluster-info']);
});

test('addMenu: three groups, shortcuts only where bound', () => {
  const m = addMenu(everything());
  assert.deepEqual(ids(m.items), [
    'add-note', 'add-image', 'add-cluster', 'add-linked-cluster', 'add-doc', 'add-file', 'add-folder', '-',
    'add-grid', 'add-schedule', 'add-shape', 'add-palette', 'add-draw', 'add-arrow', '-',
    'add-link', 'add-comment', 'add-vote',
  ]);
  const sc = Object.fromEntries(m.items.filter((i) => i.shortcut).map((i) => [i.id, i.shortcut]));
  // N, C and G pick a tool rather than add: only Draw's D and Arrow's A do what the row does.
  assert.deepEqual(sc, { 'add-draw': 'D', 'add-arrow': 'A' });
  assert.deepEqual(ids(addMenu(only('add-note', 'add-vote')).items), ['add-note', '-', 'add-vote']);
  assertMenu(m, 'add');
});

const clusters = [
  { id: 'c1', name: 'Night exteriors', parents: ['Studio'], tint: '#b88958' },
  { id: 'c2', name: 'Props' },
  { id: 'c3', name: 'Deep', path: 'Studio / Night exteriors' },
  { id: 'c4', name: 'Wardrobe' },
  { id: 'c5', name: 'Sound' },
  { id: 'c6', name: 'Music' },
];

test('moveToClusterRows: recent and all with paths, swatches, Keep in Files', () => {
  const picked = [];
  const items = moveToClusterRows({
    currentId: 'c2',
    recent: [clusters[1], clusters[0], clusters[2], clusters[3], clusters[4], clusters[5], { id: 'gone', name: 'Gone' }],
    all: clusters,
    acts: { pick: (c) => picked.push(c.id), newCluster: noop, keepInFiles: noop },
  });
  assert.deepEqual(ids(items), [
    'new-cluster', 'caption:Recent', 'recent-c1', 'recent-c3', 'recent-c4', 'recent-c5',
    'caption:All clusters', 'to-c1', 'to-c2', 'to-c3', 'to-c4', 'to-c5', 'to-c6', '-', 'keep-in-files',
  ]);
  const c1 = items.find((i) => i.id === 'to-c1');
  assert.equal(c1.aside, 'Studio');
  assert.equal(c1.swatch, '#b88958');
  assert.equal(items.find((i) => i.id === 'to-c3').aside, 'Studio / Night exteriors');
  const c2 = items.find((i) => i.id === 'to-c2');
  assert.equal(c2.aside, undefined);
  assert.equal(c2.icon, 'Folder');
  c1.run();
  assert.deepEqual(picked, ['c1']);
  assertClean(items, 'move');
});

test('moveToClusterRows: ids are unique across the whole submenu, recents included', () => {
  const items = moveToClusterRows({
    currentId: 'c2', recent: [clusters[0], clusters[2]], all: clusters,
    acts: { pick: noop, newCluster: noop, keepInFiles: noop },
  });
  const all = items.map((i) => i.id).filter(Boolean);
  assert.equal(new Set(all).size, all.length);
});

test('moveToClusterRows: Copy has no Keep in Files; nesting has Top level; empty list still has New cluster', () => {
  const copy = moveToClusterRows({ all: clusters.slice(0, 2), acts: { pick: noop, newCluster: noop } });
  assert.deepEqual(ids(copy), ['new-cluster', 'caption:All clusters', 'to-c1', 'to-c2']);
  const nest = moveToClusterRows({ all: clusters.slice(0, 1), acts: { pick: noop, topLevel: noop } });
  assert.deepEqual(ids(nest), ['top-level', 'caption:All clusters', 'to-c1']);
  const lonely = moveToClusterRows({ all: [], acts: { newCluster: noop, keepInFiles: noop } });
  assert.deepEqual(ids(lonely), ['new-cluster', '-', 'keep-in-files']);
  assert.equal(lonely[2].hint, 'Takes it off the canvas');
  assert.deepEqual(moveToClusterRows({ all: [], acts: {} }), []);
});

test('moveToClusterRows: the Move row carries a search field', () => {
  const submenu = moveToClusterRows({ all: clusters, acts: { pick: noop } });
  const r = row('move', { run: noop, submenu });
  assert.deepEqual(r.search, { placeholder: 'Find a cluster' });
  assert.equal(r.label, 'Move to cluster');
});

test('clusterMenu: editor', () => {
  const acts = { ...everything(), 'color-cover': coverAct, star: { run: noop, starred: false } };
  const m = clusterMenu({ name: 'Night' }, { edit: true }, acts);
  assert.equal(m.label, 'Night');
  assert.equal(m.title, 'Night');
  assert.deepEqual(ids(m.items), [
    'open', 'send', 'share-cluster', 'copy-link', '-',
    'rename', 'new-inside', 'move-cluster', 'color-cover', '-',
    'star', 'info', 'more', '-',
    'delete',
  ]);
  assert.deepEqual(ids(sub(m.items, 'more')), ['copy-cluster', 'paste-into', 'opens-in-files']);
  assert.equal(m.items.find((i) => i.id === 'rename').shortcut, undefined);
  assert.equal(m.items.find((i) => i.id === 'info').shortcut, mod('I'));
  assert.equal(m.items.find((i) => i.id === 'delete').danger, true);
  assertMenu(m, 'cluster');
});

test('clusterMenu: a workspace root gets neither Move to… nor Delete', () => {
  const m = clusterMenu({ name: 'Studio' }, { edit: true, isRoot: true }, everything());
  const all = ids(m.items);
  assert.ok(!all.includes('move-cluster'));
  assert.ok(!all.includes('delete'));
  assert.ok(all.includes('rename'));
});

test('clusterMenu: F2 only where bound; paste-into can be disabled; always open in files is a check', () => {
  const m = clusterMenu({ name: 'N' }, { edit: true, f2: true }, {
    rename: noop,
    'paste-into': { run: noop, disabled: true },
    'opens-in-files': { run: noop, checked: true },
  });
  assert.equal(m.items[0].shortcut, 'F2');
  const more = sub(m.items, 'more');
  assert.equal(more[0].disabled, true);
  assert.equal(more[1].checked, true);
});

test('clusterMenu: viewer', () => {
  const m = clusterMenu({ name: 'N' }, { edit: false, canRemoveFromList: true }, everything());
  assert.deepEqual(ids(m.items), ['open', 'send', 'copy-link', '-', 'star', 'info', '-', 'remove-from-list']);
  const plainViewer = clusterMenu({ name: 'N' }, { edit: false }, everything());
  assert.deepEqual(ids(plainViewer.items), ['open', 'send', 'copy-link', '-', 'star', 'info']);
});

test('clusterMenu: last top-level cluster has a disabled Delete with a hint', () => {
  const m = clusterMenu({ name: 'N' }, { edit: true, isLastTop: true }, { open: noop, delete: noop });
  const d = m.items.find((i) => i.id === 'delete');
  assert.equal(d.disabled, true);
  assert.equal(d.hint, "Your last cluster can't be deleted");
});

test('clusterMenu: shared with me swaps Delete for Remove from my list; the root never gets Delete', () => {
  const shared = clusterMenu({ name: 'N' }, { edit: true, canRemoveFromList: true }, everything());
  assert.deepEqual(ids(shared.items).slice(-2), ['-', 'remove-from-list']);
  assert.ok(!ids(shared.items).includes('delete'));
  assert.equal(shared.items.at(-1).danger, undefined);
  const notRoot = clusterMenu({ name: 'N' }, { edit: true }, everything());
  assert.ok(!ids(notRoot.items).includes('remove-from-list'));
  const root = clusterMenu({ name: 'N' }, { edit: true, isRoot: true }, everything());
  assert.ok(!ids(root.items).includes('delete'));
  assertMenu(shared, 'shared');
});

test('fileMenu: single file, desktop and touch', () => {
  const acts = everything();
  const desktop = fileMenu({ name: 'a.jpg' }, { f2: true, delKey: true }, acts);
  assert.equal(desktop.title, 'a.jpg');
  assert.deepEqual(ids(desktop.items), [
    'quick-look', 'open-player', 'show-in-files', 'show-on-canvas', 'put-on-canvas', '-',
    'send', 'copy-link', 'share-file', 'share-doc', 'download', '-',
    'rename', 'upload-version', 'move-file', 'copy-file', 'star', '-',
    'info', 'backlinks', 'delete',
  ]);
  assert.equal(desktop.items.find((i) => i.id === 'quick-look').shortcut, 'Space');
  assert.equal(desktop.items.find((i) => i.id === 'rename').shortcut, 'F2');
  assert.equal(desktop.items.find((i) => i.id === 'delete').shortcut, '⌫');
  const touch = fileMenu({ name: 'a.jpg' }, { touch: true }, acts);
  assert.equal(touch.items[0].id, 'select');
  assert.equal(touch.items.find((i) => i.id === 'delete').shortcut, undefined);
  assert.equal(fileMenu({ name: 'a.jpg' }, { touch: true, selecting: true }, acts).items[0].id, 'quick-look');
  assertMenu(desktop, 'file');
  assertMenu(touch, 'file touch');
});

test('filesMenu: plural titles, no counts in labels', () => {
  const m = filesMenu(3, {}, everything());
  assert.equal(m.title, '3 files');
  assert.deepEqual(ids(m.items), ['put-on-canvas', 'send', 'download', '-', 'move-file', 'copy-file', '-', 'info', 'delete']);
  assert.equal(filesMenu(1, {}, {}).title, '1 file');
  assert.equal(filesMenu(2, { mixed: true }, {}).title, '2 items');
  assertMenu(m, 'files');
});

test('floorMenu: New cluster, Upload, Paste, Select all', () => {
  const m = floorMenu({ 'new-cluster': noop, upload: noop, paste: { run: noop, disabled: true }, 'select-all': noop });
  assert.deepEqual(ids(m.items), ['new-cluster', 'upload', '-', 'paste', 'select-all']);
  assert.equal(m.items[0].label, 'New cluster');
  assert.equal(m.items[3].label, 'Paste');
  assert.equal(m.items[3].disabled, true);
  assert.deepEqual(ids(floorMenu({ upload: noop }).items), ['upload']);
  assert.deepEqual(floorMenu({}).items, []);
});

test('catalogue: no label has (N) or a typed check; every row has an icon or is a choice row', () => {
  for (const [id, def] of Object.entries(ROWS)) {
    const label = def.label({ name: 'X', count: 2 });
    assert.ok(typeof label === 'string' && label.length, id);
    assert.ok(!/\(\d/.test(label), `${id}: "${label}"`);
    assert.ok(!label.includes('✓'), id);
    assert.ok(def.icon || /^(stroke-\d|cover-custom|outline-(box|hug))$/.test(id), `${id} has no icon`);
  }
});
