// canvasToolEvents: a closed list of actions, closed values, buckets for counts,
// and a logger that counts every call but sends once per 5 minutes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CANVAS_TOOL_ACTIONS, TOOL_GROUP, SEND_EVERY_MS, nBucket, canvasToolProps, createCanvasToolLogger,
} from './canvasToolEvents.js';

const FOREIGN = { text: 'secret', name: 'n', title: 't', color: '#fff', url: 'https://x.test', fileName: 'a.jpg', src: 'r2:a' };

test('an unknown action is not an event', () => {
  assert.equal(canvasToolProps('nope'), null);
  assert.equal(canvasToolProps(undefined), null);
  assert.equal(canvasToolProps('__proto__'), null);
  assert.equal(canvasToolProps('toString'), null);
});

test('foreign keys never pass, for any action', () => {
  for (const action of Object.keys(CANVAS_TOOL_ACTIONS)) {
    const props = canvasToolProps(action, { ...FOREIGN, boardId: 'b1' });
    for (const k of Object.keys(FOREIGN)) assert.equal(k in props, false, `${action} leaked ${k}`);
    const allowed = new Set(['action', 'board_id', ...Object.keys(CANVAS_TOOL_ACTIONS[action])]);
    for (const k of Object.keys(props)) assert.ok(allowed.has(k), `${action} carried ${k}`);
  }
});

test('a value outside the action\'s set is dropped', () => {
  assert.deepEqual(canvasToolProps('tidy', { how: 'sideways' }), { action: 'tidy' });
  assert.deepEqual(canvasToolProps('pick', { tool: 'laser', via: 'telepathy' }), { action: 'pick' });
  assert.deepEqual(canvasToolProps('zorder', { how: 'front' }), { action: 'zorder', how: 'front' });
  // a key the action does not take is dropped even when its value is fine
  assert.deepEqual(canvasToolProps('rotate', { how: 'front', via: 'rail', n: 3 }), { action: 'rotate' });
  assert.deepEqual(canvasToolProps('grid_fill', { via: 'upload' }), { action: 'grid_fill', via: 'upload' });
});

test('n is a bucket, never a count', () => {
  assert.equal(nBucket(0), null);
  assert.equal(nBucket(-3), null);
  assert.equal(nBucket(NaN), null);
  assert.equal(nBucket('x'), null);
  assert.equal(nBucket(1), '1');
  assert.equal(nBucket(2), '2-4');
  assert.equal(nBucket(4), '2-4');
  assert.equal(nBucket(5), '5-9');
  assert.equal(nBucket(9), '5-9');
  assert.equal(nBucket(10), '10-24');
  assert.equal(nBucket(24), '10-24');
  assert.equal(nBucket(25), '25+');
  assert.equal(nBucket(5000), '25+');
  assert.deepEqual(canvasToolProps('move', { n: 7 }), { action: 'move', n: '5-9' });
  assert.deepEqual(canvasToolProps('move', { n: 0 }), { action: 'move' });
});

test('board_id is kept as a string of at most 64 characters', () => {
  assert.equal(canvasToolProps('undo', { boardId: 'abc' }).board_id, 'abc');
  assert.equal(canvasToolProps('undo', { boardId: 12 }).board_id, '12');
  assert.equal(canvasToolProps('undo', { boardId: 'x'.repeat(100) }).board_id.length, 64);
  assert.equal('board_id' in canvasToolProps('undo', {}), false);
  assert.equal('board_id' in canvasToolProps('undo', { boardId: '' }), false);
});

test('every action round-trips, with one valid value for each key it takes', () => {
  for (const [action, spec] of Object.entries(CANVAS_TOOL_ACTIONS)) {
    const opts = { boardId: 'b1' };
    const expected = { action, board_id: 'b1' };
    for (const [key, set] of Object.entries(spec)) {
      if (key === 'n') { opts.n = 3; expected.n = '2-4'; }
      else { opts[key] = set[0]; expected[key] = set[0]; }
    }
    assert.deepEqual(canvasToolProps(action, opts), expected, action);
  }
});

test('thirteen tool groups, every action but pick mapped, nothing else', () => {
  assert.deepEqual(new Set(Object.values(TOOL_GROUP)).size, 13);
  for (const action of Object.keys(CANVAS_TOOL_ACTIONS)) {
    assert.equal(action in TOOL_GROUP, action !== 'pick', action);
  }
  for (const action of Object.keys(TOOL_GROUP)) assert.ok(action in CANVAS_TOOL_ACTIONS, action);
});

test('every call is counted; the event is sent once per action and cluster per 5 minutes', () => {
  let t = 1_000_000;
  const sent = []; const counted = [];
  const log = createCanvasToolLogger({
    send: (name, props) => sent.push([name, props]), count: (k) => counted.push(k), now: () => t, eventName: 'canvas_tool',
  });
  log('align', { how: 'left', n: 3, boardId: 'b1' });
  log('align', { how: 'left', n: 3, boardId: 'b1' });             // the same pick again
  log('distribute', { how: 'horizontal', n: 3, boardId: 'b1' });   // same group, its own action
  log('align', { how: 'left', n: 3, boardId: 'b2' });              // another cluster
  assert.deepEqual(counted, ['tool.align', 'tool.align', 'tool.align', 'tool.align']);
  assert.equal(sent.length, 3);
  t += SEND_EVERY_MS - 1;
  log('align', { how: 'left', boardId: 'b1' });
  assert.equal(sent.length, 3, 'still inside the window');
  t += 1;
  log('align', { how: 'left', boardId: 'b1' });
  assert.equal(sent.length, 4, 'a later band still gets its sample');
  assert.equal(sent[3][0], 'canvas_tool');
});

test('the dedupe key keeps which tool: two tools on one cluster both send', () => {
  let t = 5_000_000;
  const sent = [];
  const log = createCanvasToolLogger({ send: (n, p) => sent.push(p), count: () => {}, now: () => t });
  log('pick', { tool: 'draw', via: 'key', boardId: 'b1' });
  log('pick', { tool: 'arrow', via: 'key', boardId: 'b1' });
  assert.deepEqual(sent.map((p) => p.tool), ['draw', 'arrow']);
  log('pick', { tool: 'draw', via: 'key', boardId: 'b1' });
  assert.equal(sent.length, 2, 'the same pick inside 5 minutes is one send');
  t += SEND_EVERY_MS;
  log('pick', { tool: 'draw', via: 'key', boardId: 'b1' });
  assert.equal(sent.length, 3, 'after 5 minutes it is sent again');
});

test('pick sends but is not counted as a tool row; an unknown action does neither', () => {
  const sent = []; const counted = [];
  const log = createCanvasToolLogger({ send: (n, p) => sent.push(p), count: (k) => counted.push(k) });
  log('pick', { tool: 'draw', via: 'key' });
  log('nope', {});
  assert.equal(sent.length, 1);
  assert.deepEqual(counted, []);
});

test('a throwing sink never reaches the caller', () => {
  const log = createCanvasToolLogger({ send: () => { throw new Error('x'); }, count: () => { throw new Error('y'); } });
  assert.doesNotThrow(() => log('undo', {}));
});

test('the Map is cleared after 500 distinct keys, so it stays bounded', () => {
  let t = 0;
  const sent = [];
  const log = createCanvasToolLogger({ send: (n, p) => sent.push(p), count: () => {}, now: () => t });
  for (let i = 0; i < 600; i++) log('undo', { boardId: 'b' + i });
  assert.equal(sent.length, 600);
  log('undo', { boardId: 'b599' });
  assert.equal(sent.length, 600, 'recent keys are still remembered');
});
