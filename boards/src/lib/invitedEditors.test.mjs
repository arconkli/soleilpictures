// People invited to edit one shared cluster: can write it, but are not members
// of its workspace. Source checks pin the pieces that talk to the database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { workspaceForChild } from './subClusterWorkspace.js';

const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const fnText = (src, startMarker) => {
  const i = src.indexOf(startMarker);
  assert.ok(i >= 0, `${startMarker} not found`);
  const j = src.indexOf('\nexport ', i + startMarker.length);
  return src.slice(i, j < 0 ? undefined : j);
};

test('workspaceForChild uses the parent workspace, else the fallback', () => {
  const boards = { p: { workspace_id: 'owner-ws' }, q: {} };
  assert.equal(workspaceForChild(boards, 'p', 'mine'), 'owner-ws');
  assert.equal(workspaceForChild(boards, 'q', 'mine'), 'mine');
  assert.equal(workspaceForChild(boards, 'missing', 'mine'), 'mine');
  assert.equal(workspaceForChild(null, 'p', 'mine'), 'mine');
  assert.equal(workspaceForChild(undefined, null, 'mine'), 'mine');
});

const api = read('./boardsApi.js');

test('saveBoardVersion makes its own id and asks for no row back', () => {
  const t = fnText(api, 'export async function saveBoardVersion');
  assert.match(t, /randomUUID\(\)/);
  assert.ok(!t.includes('.select('));
  assert.ok(!t.includes('.single()'));
});

test('renameBoard goes through the rename_board RPC', () => {
  const t = fnText(api, 'export async function renameBoard');
  assert.match(t, /rpc\('rename_board'/);
  assert.ok(!t.includes('logMetaChanges('));
});

test('index syncs remember a refused write, but not the card limit', () => {
  assert.match(fnText(api, 'export async function syncCardIndex'), /_indexWriteRefused\.has\(boardId\)/);
  assert.match(fnText(api, 'export async function syncGroupIndex'), /_indexWriteRefused\.has\(boardId\)/);
  assert.match(api, /Demo accounts are limited to/);
  assert.match(api, /_noteIndexRefusal\(boardId, ups\.error\)/);
});

test('yboard skips version saves for someone who cannot write', () => {
  const y = read('./yboard.js');
  assert.match(y, /canWriteBoardOnce\(boardId\)\.then\(\(ok\) => \{ canWrite = ok; \}\)/);
  assert.equal((y.match(/canWrite === false/g) || []).length, 2);
  assert.match(y, /if \(canWrite !== false\) saveBoardVersion/);
  assert.match(y, /data\?\.session\) reportSaveFailure\(e, 'board_snapshot_close'\)/);
});
