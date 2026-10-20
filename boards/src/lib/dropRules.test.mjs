import test from 'node:test';
import assert from 'node:assert/strict';
import { decideDrop, copyKeyHeld, copyKeyName, whatOf, isMacPlatform } from './dropRules.js';

const photo = (id, extra = {}) => ({ id, kind: 'image', boardId: 'cast', ...extra });
const three = [photo('a'), photo('b'), photo('c')];
const row = (extra = {}) => ({ boardId: 'loc', name: 'Locations', where: 'files', workspaceId: 'ws', writable: true, ...extra });
const board = (extra = {}) => ({ boardId: 'film', name: 'Feature film', where: 'board', workspaceId: 'ws', writable: true, ...extra });
const decide = (o) => decideDrop({ workspaceId: 'ws', workspaceName: 'Lost Time', sourceName: 'Casting', mac: true, ...o });

test('dragging moves, into a cluster\'s files, and says how to copy instead', () => {
  const d = decide({ files: three, target: row() });
  assert.equal(d.action, 'move');
  assert.equal(d.effect, 'move');
  assert.deepEqual(d.moveIds, ['a', 'b', 'c']);
  assert.deepEqual(d.label, {
    top: 'Move 3 photos to Locations',
    sub: 'Into its files, not onto its board',
    hint: 'Hold Option (⌥) to copy instead',
    no: false,
  });
  assert.equal(decide({ files: three, target: row(), mac: false }).label.hint, 'Hold Ctrl to copy instead');
});

test('the copy key copies, and the originals stay', () => {
  const d = decide({ files: three, target: row(), copy: true });
  assert.equal(d.action, 'copy');
  assert.equal(d.effect, 'copy');
  assert.deepEqual(d.copyIds, ['a', 'b', 'c']);
  assert.equal(d.label.top, 'Copy 3 photos to Locations');
  assert.equal(d.label.hint, 'The originals stay in Casting');
});

test('onto a board, a move says the files leave where they were; a copy lands where you let go', () => {
  assert.equal(decide({ files: three, target: board() }).label.sub, 'Onto the board · they leave Casting');
  assert.equal(decide({ files: [photo('a', { name: 'mara-callback-1.jpg' })], target: board() }).label.sub, 'Onto the board · it leaves Casting');
  assert.equal(decide({ files: three, target: board(), copy: true }).label.sub, 'Onto the board, where you let go');
  assert.equal(decide({ files: three, target: board(), sourceName: '' }).label.sub, 'Onto the board · they leave where they were');
});

test('files stay in their workspace', () => {
  const d = decide({ files: three, target: row({ name: 'Grade', workspaceId: 'ws-2', owner: 'Priya' }) });
  assert.equal(d.action, 'none');
  assert.equal(d.effect, 'none');
  assert.equal(d.reason, 'workspace');
  assert.deepEqual(d.label, { top: 'Grade is in Priya’s workspace', sub: 'Files can only move within Lost Time', hint: '', no: true });
  assert.equal(decide({ files: three, target: row({ workspaceId: 'ws-2' }), workspaceName: '' }).label.top, 'Locations is in another workspace');
  assert.equal(decide({ files: three, target: row({ name: 'Grade', workspaceId: 'ws-2', workspaceName: 'Gradehouse' }) }).label.top, 'Grade is in Gradehouse');
  assert.equal(decide({ files: three, target: row({ workspaceId: 'ws-2' }), copy: true }).action, 'none', 'not even a copy, yet');
});

test('a cluster you can only view takes nothing', () => {
  const d = decide({ files: three, target: row({ name: 'Pitch deck', writable: false }) });
  assert.equal(d.reason, 'view-only');
  assert.equal(d.label.top, 'Pitch deck is view only');
  assert.equal(d.label.sub, 'You can’t add files to it');
});

test('out of a cluster you can only view, files are copied, never moved', () => {
  const viewOnly = three.map((f) => ({ ...f, canMove: false }));
  const d = decide({ files: viewOnly, target: row() });
  assert.equal(d.action, 'copy');
  assert.deepEqual(d.copyIds, ['a', 'b', 'c']);
  assert.equal(d.label.hint, 'Casting is view only, so they’re copied');
  const mixed = decide({ files: [photo('a'), photo('b', { canMove: false, boardId: 'grade' })], target: row(), sourceName: '' });
  assert.equal(mixed.action, 'mixed');
  assert.deepEqual([mixed.moveIds, mixed.copyIds], [['a'], ['b']]);
  assert.equal(mixed.label.top, 'Move 1 and copy 1 to Locations');
});

test('dropped on the cluster they are in: nothing on its name or list, put on its board on the board', () => {
  const same = decide({ files: three, target: row({ boardId: 'cast', name: 'Casting' }) });
  assert.equal(same.action, 'none');
  assert.equal(same.reason, 'same');
  assert.equal(same.label.top, 'Already in Casting');
  assert.equal(decide({ files: [photo('a')], target: row({ boardId: 'cast', name: 'Casting' }) }).label.sub, 'Drop it on another cluster');
  const place = decide({ files: three, target: board({ boardId: 'cast', name: 'Casting' }) });
  assert.equal(place.action, 'place');
  assert.deepEqual(place.placeIds, ['a', 'b', 'c']);
  assert.equal(place.label.top, 'Put 3 photos here');
});

test('a selection from several clusters: each file from somewhere else goes; the ones already there stay', () => {
  const d = decide({ files: [photo('a'), photo('b', { boardId: 'loc' })], target: row(), sourceName: '' });
  assert.deepEqual(d.moveIds, ['a']);
  assert.equal(d.label.top, 'Move 1 photo to Locations');
});

test('files still uploading stay put; only uploading is nothing to do', () => {
  const d = decide({ files: [photo('a'), photo('b', { uploading: true })], target: row() });
  assert.deepEqual(d.moveIds, ['a']);
  const only = decide({ files: [photo('b', { uploading: true })], target: row() });
  assert.equal(only.reason, 'uploading');
  assert.equal(only.label.top, 'Still uploading');
});

test('nothing to drop, or nowhere to drop it', () => {
  assert.equal(decide({ files: [], target: row() }).action, 'none');
  assert.equal(decide({ files: three, target: null }).action, 'none');
});

test('the copy key: Option on a Mac; Ctrl or Alt elsewhere', () => {
  assert.equal(copyKeyHeld({ altKey: true }, true), true);
  assert.equal(copyKeyHeld({ ctrlKey: true }, true), false, 'Ctrl on a Mac is a right-click, not a copy');
  assert.equal(copyKeyHeld({ ctrlKey: true }, false), true);
  assert.equal(copyKeyHeld({ altKey: true }, false), true);
  assert.equal(copyKeyHeld({}, false), false);
  assert.equal(copyKeyHeld(null), false);
  assert.equal(copyKeyName(true), 'Option (⌥)');
  assert.equal(copyKeyName(false), 'Ctrl');
  assert.equal(isMacPlatform({ platform: 'MacIntel' }), true);
  assert.equal(isMacPlatform({ platform: 'Win32' }), false);
});

test('what is being dragged, in words', () => {
  assert.equal(whatOf([photo('a', { name: 'mara-callback-1.jpg' })]), 'mara-callback-1.jpg');
  assert.equal(whatOf([photo('a', { name: 'a-very-long-file-name-that-goes-on-and-on.jpg' })]), 'a-very-long-file-name-that-…');
  assert.equal(whatOf([photo('a')]), '1 photo');
  assert.equal(whatOf(three), '3 photos');
  assert.equal(whatOf([{ id: 'v', kind: 'video' }, { id: 'w', kind: 'video' }]), '2 videos');
  assert.equal(whatOf([photo('a'), { id: 'd', kind: 'doc' }]), '2 files');
  assert.equal(whatOf([{ id: 'x', kind: 'palette' }]), '1 file');
});

test('a file from a cluster shared from another workspace goes nowhere here; beside ones that can, it stays put', () => {
  const grade = photo('g', { boardId: 'grade', workspaceId: 'ws-2', name: 'grade-01.jpg' });
  const d = decide({ files: [grade], target: row() });
  assert.equal(d.action, 'none');
  assert.equal(d.reason, 'workspace');
  assert.deepEqual(d.label, { top: 'grade-01.jpg is in another workspace', sub: 'Files stay in their own workspace', hint: '', no: true });
  assert.equal(decide({ files: [grade], target: board(), copy: true }).action, 'none', 'not even a copy, onto a board');
  const mixed = decide({ files: [photo('a', { workspaceId: 'ws' }), grade], target: row(), sourceName: '' });
  assert.deepEqual(mixed.moveIds, ['a']);
  assert.equal(decide({ files: [photo('a', { workspaceId: 'ws' })], target: row() }).action, 'move', 'its own workspace: as before');
});
