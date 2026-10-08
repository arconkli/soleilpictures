// filesDrag.test.mjs — what dragging from Files onto a board does.
//
//   node --test src/lib/filesDrag.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import {
  COPYABLE_KINDS, canDragFromFiles, plainCardForCopy, fileKeyOf, onBoardIndex,
  buildFilesPayload, parseFilesPayload, planMoveToPoint, planCrossDrop, summarizeDrop,
} from './filesDrag.js';

const img = (id, src, extra = {}) => ({ id, kind: 'image', src, x: 0, y: 0, w: 200, h: 100, ...extra });

test('a copy carries the file, not the card\'s place on its board', () => {
  const frag = new Y.Doc().getXmlFragment('f');
  const c = plainCardForCopy({
    id: 'a', kind: 'image', src: 'r2:k', w: 10, h: 10, z: 7, groupId: 'g',
    createdAt: 't', createdBy: 'u', updatedAt: 't', updatedBy: 'u', sourceRef: { boardId: 'x', cardId: 'y' },
    live: frag, caption: 'hi',
  });
  assert.deepEqual(c, { kind: 'image', src: 'r2:k', w: 10, h: 10, caption: 'hi' });
});

test('clusters and uploads still in flight never drag as files', () => {
  assert.equal(canDragFromFiles({ id: 'b', kind: 'board' }), false);
  assert.equal(canDragFromFiles({ id: 'b', kind: 'boardlink' }), false);
  assert.equal(canDragFromFiles({ id: 'p', kind: 'image', pending: true }), false);
  assert.equal(canDragFromFiles({ id: 'p', kind: 'image', pending: true, src: 'r2:k' }), true);
  assert.equal(canDragFromFiles({ id: 'n', kind: 'note' }), true);
});

test('the stored file is the identity copies share', () => {
  assert.equal(fileKeyOf({ kind: 'pdf', src: 'r2:thumb', pdfSrc: 'r2:doc' }), 'r2:doc');
  assert.equal(fileKeyOf({ kind: 'file', fileSrc: 'r2:f' }), 'r2:f');
  assert.equal(fileKeyOf({ kind: 'image', src: 'r2:i' }), 'r2:i');
  assert.equal(fileKeyOf({ kind: 'note' }), null);
  const idx = onBoardIndex([img('a', 'r2:1'), img('b', 'r2:1'), { id: 'n', kind: 'note', src: 'r2:1x' }]);
  assert.equal(idx.get('r2:1'), 'a');
  assert.equal(idx.has('r2:1x'), false);
});

test('payload round-trips and refuses junk', () => {
  const raw = buildFilesPayload({ sourceBoardId: 'B', sourceName: 'Refs', cards: [img('a', 'r2:1', { z: 3 }), { id: 'c', kind: 'board' }] });
  const p = parseFilesPayload(raw);
  assert.equal(p.sourceBoardId, 'B');
  assert.equal(p.sourceName, 'Refs');
  assert.deepEqual(p.cards.map((c) => c.id), ['a']);
  assert.equal(p.cards[0].z, undefined);
  assert.equal(buildFilesPayload({ sourceBoardId: 'B', cards: [{ id: 'c', kind: 'board' }] }), null);
  assert.equal(parseFilesPayload('nope'), null);
  assert.equal(parseFilesPayload(JSON.stringify({ v: 2, sourceBoardId: 'B', cards: [img('a')] })), null);
  assert.equal(parseFilesPayload(JSON.stringify({ v: 1, sourceBoardId: 'B', cards: [{ kind: 'image' }] })), null);
});

test('a same-board drop centres the block on the drop point and keeps its shape', () => {
  const moves = planMoveToPoint([img('a', 's', { x: 0, y: 0 }), img('b', 's', { x: 300, y: 0 })], { x: 1000, y: 500 });
  // Block is 500×100; its centre (250, 50) lands on (1000, 500).
  assert.deepEqual(moves, [
    { id: 'a', patch: { x: 750, y: 450 } },
    { id: 'b', patch: { x: 1050, y: 450 } },
  ]);
  // The board's live geometry wins over the payload's (it may be stale).
  const live = new Map([['a', img('a', 's', { x: 100, y: 100, w: 20, h: 20 })]]);
  assert.deepEqual(planMoveToPoint([img('a', 's')], { x: 0, y: 0 }, live), [{ id: 'a', patch: { x: -10, y: -10 } }]);
  assert.deepEqual(planMoveToPoint([], { x: 0, y: 0 }), []);
});

test('from another cluster: files become linked copies at the drop point', () => {
  let n = 0;
  const { copies, moves, moveOnly } = planCrossDrop(
    [img('a', 'r2:1'), { id: 'n', kind: 'note' }, { id: 'g', kind: 'grid' }],
    { x: 500, y: 500 },
    { sourceBoardId: 'SRC', boardCards: [], makeId: () => `new-${n++}` },
  );
  assert.equal(copies.length, 1);
  assert.equal(copies[0].id, 'new-0');
  assert.equal(copies[0].src, 'r2:1');
  assert.deepEqual(copies[0].sourceRef, { boardId: 'SRC', cardId: 'a' });
  // A single card keeps its size and centres on the point.
  assert.deepEqual([copies[0].x, copies[0].y, copies[0].w, copies[0].h], [400, 450, 200, 100]);
  assert.deepEqual(moves, []);
  assert.deepEqual(moveOnly.map((c) => c.id), ['n', 'g']);
});

test('a file this board already shows moves that copy instead; ⌥ makes another', () => {
  const board = [img('here', 'r2:1', { x: 0, y: 0 })];
  const plan = planCrossDrop([img('a', 'r2:1'), img('b', 'r2:1')], { x: 100, y: 50 }, { sourceBoardId: 'S', boardCards: board });
  assert.equal(plan.copies.length, 0);
  assert.deepEqual(plan.moves, [{ id: 'here', patch: { x: 0, y: 0 } }]);
  const extra = planCrossDrop([img('a', 'r2:1')], { x: 0, y: 0 }, { sourceBoardId: 'S', boardCards: board, extraCopy: true });
  assert.equal(extra.copies.length, 1);
  assert.equal(extra.moves.length, 0);
});

test('several photographs arrive as a block, not a strip', () => {
  const many = Array.from({ length: 12 }, (_, i) => img(`p${i}`, `r2:${i}`, { w: 300, h: 200 }));
  const { copies } = planCrossDrop(many, { x: 0, y: 0 }, { sourceBoardId: 'S' });
  assert.equal(copies.length, 12);
  const xs = copies.map((c) => c.x), ys = copies.map((c) => c.y);
  const width = Math.max(...copies.map((c) => c.x + c.w)) - Math.min(...xs);
  const height = Math.max(...copies.map((c) => c.y + c.h)) - Math.min(...ys);
  assert.ok(height > 0 && width / height < 6, `block is ${width}×${height}`);
  assert.equal(new Set(copies.map((c) => c.id)).size, 12);
});

test('copyable kinds are the ones whose content is plain fields', () => {
  for (const k of ['image', 'video', 'audio', 'pdf', 'file', 'link', 'palette']) assert.ok(COPYABLE_KINDS.has(k), k);
  for (const k of ['note', 'doc', 'grid', 'board', 'boardlink']) assert.ok(!COPYABLE_KINDS.has(k), k);
});

test('the toast says what happened', () => {
  assert.equal(summarizeDrop({ copied: 1, sourceName: 'Refs' }), 'Linked 1 file from “Refs”');
  assert.equal(summarizeDrop({ copied: 3, moved: 1 }), 'Linked 3 files · moved 1 already on this board');
  assert.equal(summarizeDrop({ moved: 2 }), 'Moved 2 already on this board');
});
