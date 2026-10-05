// folderImport.test.mjs — the order of operations that decides whether a
// folder import can lose work, run against real Y.Docs with no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { cardToYMap, readCards } from './yhelpers.js';
import { planFolderImport } from './folderPlan.js';
import { runFolderImport, undoFolderImport, buildClusterCards, layoutTops, CLUSTER_CARD } from './folderImport.js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(resolve(SRC, rel), 'utf8');

const f = (name, type = 'image/jpeg') => ({ name, type, size: 2000 });
const dir = (name, files = [], dirs = []) => ({ name, files, dirs });

// A world: clusters, the current board's live cards, and each new cluster's
// written doc, all inspectable.
function world({ failOn = () => null } = {}) {
  let n = 0;
  const log = [];
  const clusters = new Map();           // id → { parentId, name, deleted }
  const live = new Map();               // the current board's cards
  const docs = new Map();               // id → Y.Doc as written
  let uploads = 0;
  const deps = {
    parentBoardId: 'current',
    at: { x: 500, y: 300 },
    createCluster: async ({ parentBoardId, name }) => {
      const id = `b${++n}`;
      clusters.set(id, { parentId: parentBoardId, name, deleted: false });
      log.push(`create ${name}`);
      return id;
    },
    deleteCluster: async (id) => { clusters.get(id).deleted = true; log.push(`delete ${clusters.get(id).name}`); },
    placeTopCard: (card) => { live.set(card.id, card); log.push(`top ${card.id}`); },
    removeTopCard: (id) => { live.delete(id); log.push(`untop ${id}`); },
    upload: async (item, { boardId, cardId }) => {
      uploads++;
      const err = failOn(item, uploads);
      if (err) throw err;
      return { src: `r2:ws/${item.file.name}`, width: 1200, height: 800 };
    },
    writeCluster: async (id, cards) => {
      const doc = new Y.Doc();
      doc.transact(() => { const m = doc.getMap('cards'); for (const c of cards) m.set(c.id, cardToYMap(c)); });
      docs.set(id, doc);
      log.push(`write ${clusters.get(id).name} (${cards.length})`);
    },
    rand: () => 0.5,
  };
  return { deps, log, clusters, live, docs, uploads: () => uploads };
}

const tree = () => planFolderImport(dir(null, [], [
  dir('Diner', [f('ext_dusk_04.jpg'), f('int_counter.jpg')], [dir('Day 2', [f('c.jpg')])]),
])).nodes;

test('clusters are created parents first and written children first, each once', async () => {
  const w = world();
  const res = await runFolderImport(tree(), w.deps);
  assert.deepEqual(w.log, [
    'create Diner', 'top b1', 'create Day 2', 'write Day 2 (1)', 'write Diner (3)',
  ]);
  assert.equal(w.clusters.get('b2').parentId, 'b1', 'Day 2 is nested inside Diner');
  assert.equal(w.clusters.get('b1').parentId, 'current');
  assert.equal(res.placed, 3);
  assert.equal(res.failed, 0);
  assert.deepEqual(res.tops, ['b1']);

  // Diner holds Day 2's cluster card plus its own two photos, finished.
  const diner = readCards(w.docs.get('b1'));
  const board = diner.find((c) => c.kind === 'board');
  assert.equal(board.id, 'b2');
  const photos = diner.filter((c) => c.kind === 'image');
  assert.deepEqual(photos.map((c) => c.fileName).sort(), ['ext_dusk_04.jpg', 'int_counter.jpg']);
  for (const p of photos) {
    assert.ok(String(p.src).startsWith('r2:'), 'a finished card, with its file');
    assert.ok(!p.pending, 'never a pending placeholder — nothing for the abandoned-upload sweep');
    assert.ok(p.y > board.y + board.h, 'files sit below the subfolders');
  }
  // The top cluster's card landed on the current board at the drop point.
  const top = w.live.get('b1');
  assert.equal(top.kind, 'board');
  assert.equal(top.w, CLUSTER_CARD.w);
});

test('cancelling mid-import keeps what landed and leaves no empty clusters', async () => {
  const ctrl = new AbortController();
  const w = world();
  const deps = { ...w.deps, signal: ctrl.signal, onProgress: ({ done }) => { if (done === 1) ctrl.abort(); } };
  const nodes = planFolderImport(dir(null, [], [
    dir('A', [f('1.jpg')], [dir('A1', [f('2.jpg')]), dir('A2', [f('3.jpg')])]),
  ])).nodes;
  const res = await runFolderImport(nodes, deps);
  assert.equal(res.cancelled, true);
  assert.equal(res.placed, 1);
  assert.ok(!w.log.includes('create A1'), 'a folder not yet reached is never created');
  assert.deepEqual(readCards(w.docs.get('b1')).map((c) => c.fileName), ['1.jpg']);
  assert.equal(w.uploads(), 1, 'nothing uploads after the cancel');
});

test('a cancel before anything lands takes the empty cluster back off the board', async () => {
  const ctrl = new AbortController();
  const w = world({ failOn: () => { ctrl.abort(); return new Error('aborted'); } });
  const res = await runFolderImport(tree(), { ...w.deps, signal: ctrl.signal });
  assert.equal(res.placed, 0);
  assert.deepEqual(res.tops, []);
  assert.equal(w.live.size, 0, 'the top cluster card was removed again');
  assert.equal(w.clusters.get('b1').deleted, true);
  assert.equal(w.docs.size, 0, 'nothing written');
});

test('a quota refusal stops the import where it stands and writes what landed', async () => {
  const w = world({ failOn: (item, n) => (n === 2 ? Object.assign(new Error('over quota'), { code: 402 }) : null) });
  const res = await runFolderImport(tree(), w.deps);
  assert.equal(res.stopped.code, 402);
  assert.equal(res.placed, 1);
  assert.ok(!w.log.includes('create Day 2'), 'no new folders after the refusal');
  assert.equal(readCards(w.docs.get('b1')).filter((c) => c.kind === 'image').length, 1);
});

test('an ordinary failed file is counted and the rest still land', async () => {
  const w = world({ failOn: (item) => (item.file.name === 'int_counter.jpg' ? new Error('network') : null) });
  const res = await runFolderImport(tree(), w.deps);
  assert.equal(res.failed, 1);
  assert.equal(res.placed, 2);
  assert.equal(res.firstError, 'network');
});

test('undo deletes children before parents, then takes the top card off', async () => {
  const w = world();
  const nodes = planFolderImport(dir(null, [], [
    dir('A', [f('1.jpg')], [dir('A1', [f('2.jpg')], [dir('A1a', [f('3.jpg')])])]),
    dir('B', [f('4.jpg')]),
  ])).nodes;
  const res = await runFolderImport(nodes, w.deps);
  w.log.length = 0;
  await undoFolderImport(res, w.deps);
  assert.deepEqual(w.log, ['delete A1a', 'delete A1', 'delete A', 'delete B', 'untop b1', 'untop b4']);
});

test('a cluster that cannot be written is reported, not counted as landed', async () => {
  const w = world();
  const deps = { ...w.deps, writeCluster: async () => { throw new Error('snapshot write failed'); } };
  const res = await runFolderImport(tree(), deps);
  assert.equal(res.placed, 0);
  assert.equal(res.writeFailed, 3);
  assert.equal(res.firstError, 'snapshot write failed');
});

test('layout: top clusters centre on the drop point; subfolders never overlap files', () => {
  const tops = layoutTops(2, { x: 1000, y: 500 });
  assert.equal(tops.length, 2);
  assert.ok(tops[0].x < 1000 && tops[1].x + tops[1].w > 1000);
  const cards = buildClusterCards(['c1', 'c2'], [
    { id: 'i1', item: { file: f('a.jpg'), route: 'image', kind: 'image', w: 300, h: 200 }, up: { src: 'r2:a', width: 3000, height: 2000 } },
  ]);
  const boards = cards.filter((c) => c.kind === 'board');
  const image = cards.find((c) => c.kind === 'image');
  assert.equal(boards.length, 2);
  assert.ok(image.y >= Math.max(...boards.map((b) => b.y + b.h)));
});

// ── Wiring ──────────────────────────────────────────────────────────────────

test('the canvas reads a dropped folder before its first await, and hands it to App', () => {
  const canvas = read('components/CanvasSurface.jsx');
  const drop = canvas.slice(canvas.indexOf('const handleDrop = async (e) => {'));
  const capture = drop.indexOf('captureDropEntries(e.dataTransfer)');
  const firstAwait = drop.indexOf('await ');
  assert.ok(capture > 0 && capture < firstAwait,
    'Chrome empties dataTransfer.items once the handler yields — the entries must be taken first');
  assert.match(drop, /if \(hasDirectory\(dropEntries\) && onImportFolder\)/);
  assert.match(read('App.jsx'), /onImportFolder=\{importFolder\}/);
});

test('App asks once for the whole folder, guards the tab, and writes clusters the move path way', () => {
  const app = read('App.jsx');
  const fn = app.slice(app.indexOf('const importFolder = useCallback('));
  assert.match(fn, /preflightImport\?\.\(\{\s*n: plan\.cost, kinds: plan\.kinds, source: 'folder',\s*folder: \{ files: plan\.files, clusters: plan\.clusters \},/);
  assert.match(fn, /slicePlan\(plan\.nodes, Math\.min\(plan\.cost, Number\(take\) \|\| 0\)\)/);
  assert.match(fn, /window\.addEventListener\('beforeunload', guard\)/);
  assert.match(fn, /window\.removeEventListener\('beforeunload', guard\)/);
  // Written through the cluster's live room: synced first, then merged — never
  // a whole-state write plus a room reset, which destroys a concurrent edit by
  // anyone who opened the cluster mid-import (the reset force-reloads every
  // client from board_state).
  const write = fn.slice(fn.indexOf('const writeCluster = async (id, cards) => {'), fn.indexOf('const upload = (item'));
  assert.match(write, /loadYBoard\(id, \{[^}]*user: null/);
  const synced = write.indexOf('await handle.whenRoomSynced(');
  const merged = write.indexOf('handle.ydoc.transact(');
  assert.ok(synced > 0 && merged > synced, 'the room handshake must finish before the cards are added');
  assert.match(write, /await saveBoardSnapshot\(id, handle\.ydoc\);/);
  assert.doesNotMatch(write, /forceResetBoardRoom|__soleilEmitBoardReset/, 'an additive write must never reset the room');
  assert.match(fn, /originalName: meaningfulFileName\(item\.file\)/, 'imported files keep their names too');
});

test('a refused top card stops the import and takes the cluster back', async () => {
  const w = world();
  const res = await runFolderImport(tree(), { ...w.deps, placeTopCard: () => null });
  assert.equal(res.stopped.code, 'cap');
  assert.equal(w.clusters.get('b1').deleted, true);
  assert.deepEqual(res.created, []);
  assert.equal(w.uploads(), 0, 'nothing uploads into a cluster the board refused');
});

test('a subfolder that cannot be created costs that subfolder, not its parent', async () => {
  const w = world();
  let n = 0;
  const createCluster = async (args) => {
    n++;
    if (args.name === 'Day 2') throw new Error('createBoard failed');
    return w.deps.createCluster(args);
  };
  const res = await runFolderImport(tree(), { ...w.deps, createCluster });
  assert.equal(res.failed, 1, 'Day 2 held one file');
  assert.equal(res.firstError, 'createBoard failed');
  const diner = readCards(w.docs.get('b1'));
  assert.equal(diner.filter((c) => c.kind === 'image').length, 2, 'the parent is still written with its own files');
  assert.ok(n >= 2);
});

test('a card-cap stop is not pitched as storage — the board already showed its wall', () => {
  const app = read('App.jsx');
  const fn = app.slice(app.indexOf('const importFolder = useCallback('));
  assert.match(fn, /if \(res\.stopped && res\.stopped\.code !== 'cap'\) \{[\s\S]{0,400}?pitchStorageGate\(\);/);
  assert.match(fn, /const placed = muts\.addCard\?\.\(card\);[\s\S]{0,200}?return placed \?\? null;/,
    'placeTopCard hands back the refusal, so the import can stop on it');
});
