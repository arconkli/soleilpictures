// projectsHome.test.mjs — node --test src/lib/projectsHome.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  boardRecency, projectList, jumpBackIn, isTopLevelProject, projectOfferDue, spotBesideContent, JUMP_BACK_MAX,
} from './projectsHome.js';

const WS = 'ws-1';
const B = (id, parent, extra = {}) => ({ id, parent_board_id: parent, workspace_id: WS, ...extra });
const boards = {
  root: B('root', null, { updated_at: '2026-09-01T00:00:00Z' }),
  old:  B('old', 'root', { updated_at: '2026-09-02T00:00:00Z' }),
  // updated_at is stale but the thumbnail was re-rendered later: recency follows the later one
  live: B('live', 'root', { updated_at: '2026-09-01T00:00:00Z', thumb_updated_at: '2026-09-20T00:00:00Z' }),
  mid:  B('mid', 'root', { updated_at: '2026-09-10T00:00:00Z' }),
  sub:  B('sub', 'mid', { updated_at: '2026-09-25T00:00:00Z' }),
  gone: B('gone', 'root', { updated_at: '2026-09-30T00:00:00Z', deleted_at: '2026-09-30T01:00:00Z' }),
  theirs: { ...B('theirs', 'root', { updated_at: '2026-09-29T00:00:00Z' }), _shared: true },
  other: { ...B('other', 'root', { updated_at: '2026-09-28T00:00:00Z' }), workspace_id: 'ws-2' },
};

test('recency is the later of updated_at and thumb_updated_at', () => {
  assert.equal(boardRecency(boards.live), Date.parse('2026-09-20T00:00:00Z'));
  assert.equal(boardRecency(boards.old), Date.parse('2026-09-02T00:00:00Z'));
  assert.equal(boardRecency(null), 0);
  assert.equal(boardRecency({ created_at: '2026-09-03T00:00:00Z' }), Date.parse('2026-09-03T00:00:00Z'));
});

test('projects are the root\'s live, own children, newest first', () => {
  const ids = projectList(boards, 'root', { workspaceId: WS }).map((b) => b.id);
  assert.deepEqual(ids, ['live', 'mid', 'old']);
  assert.ok(!ids.includes('sub'), 'a nested cluster is part of a project, not a project');
  assert.ok(!ids.includes('gone') && !ids.includes('theirs') && !ids.includes('other'));
  assert.deepEqual(projectList(null, 'root'), []);
  assert.deepEqual(projectList(boards, null), []);
});

test('jump back in leads with this device\'s recents, then fills from recency', () => {
  const ids = jumpBackIn(boards, ['old', 'gone', 'theirs', 'nope'], 'root', { workspaceId: WS }).map((b) => b.id);
  assert.equal(ids[0], 'old', 'the last board opened here comes first');
  assert.equal(ids.length, JUMP_BACK_MAX);
  assert.deepEqual(ids, ['old', 'sub', 'live'], 'then the most recently touched own boards, root and nested included');
  assert.ok(!ids.includes('gone') && !ids.includes('theirs'));
});

test('a new device (no recents) still gets something to jump back into', () => {
  const ids = jumpBackIn(boards, [], 'root', { workspaceId: WS }).map((b) => b.id);
  assert.deepEqual(ids, ['sub', 'live', 'mid']);
  assert.deepEqual(jumpBackIn({}, [], 'root'), []);
});

test('only a direct child of the root is a top-level project', () => {
  assert.equal(isTopLevelProject(boards, 'mid', 'root'), true);
  assert.equal(isTopLevelProject(boards, 'root', 'root'), false, 'the root is Studio, not a project');
  assert.equal(isTopLevelProject(boards, 'sub', 'root'), false);
  assert.equal(isTopLevelProject(boards, 'gone', 'root'), false);
  assert.equal(isTopLevelProject(boards, 'nope', 'root'), false);
});

test('the project offer is due at 60% of the person\'s own cap', () => {
  assert.equal(projectOfferDue({ count: 29, limit: 50 }), false);
  assert.equal(projectOfferDue({ count: 30, limit: 50 }), true);
  assert.equal(projectOfferDue({ count: 60, limit: 100 }), true);
  assert.equal(projectOfferDue({ count: 10, limit: 0 }), false, 'no cap, no offer');
  assert.equal(projectOfferDue({ count: null, limit: 50 }), false);
});

test('a new cluster card goes beside the work, top-aligned, never on it', () => {
  const cards = [{ x: 60, y: 120, w: 300, h: 200 }, { x: 400, y: 80, w: 220, h: 220 }];
  assert.deepEqual(spotBesideContent(cards), { x: 660, y: 80 });
  assert.deepEqual(spotBesideContent([]), { x: 60, y: 60 }, 'an empty canvas uses the usual corner');
  assert.deepEqual(spotBesideContent([{ x: 'nope' }, null]), { x: 60, y: 60 });
});
