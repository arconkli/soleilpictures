// The unread share_notifications read (useShareNotifications), against a fake
// client that records what it was asked for. `scope` came with 0452, and the
// app ships before or after that migration is applied to the shared database,
// so a read naming the missing column must still bring the toasts.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  SHARE_NOTIFICATION_COLUMNS,
  readUnreadShareNotifications,
  _resetScopeProbeForTests,
} from './shareNotificationsRead.js';

function fakeClient(answers) {
  const asked = [];
  const client = {
    from(table) {
      const q = { table, cols: null, filters: [] };
      const chain = {
        select(cols) { q.cols = cols; return chain; },
        eq(k, v) { q.filters.push(['eq', k, v]); return chain; },
        is(k, v) { q.filters.push(['is', k, v]); return chain; },
        order(k, o) {
          q.filters.push(['order', k, o]);
          asked.push(q);
          return Promise.resolve(answers.shift());
        },
      };
      return chain;
    },
  };
  return { client, asked };
}

const ROWS = [{ id: 'n1', board_id: 'b1', kind: 'joined', scope: 'workspace' }];

beforeEach(() => _resetScopeProbeForTests());

test('asks for scope with the other columns, for the reader, unread, oldest first', async () => {
  const { client, asked } = fakeClient([{ data: ROWS, error: null }]);
  const res = await readUnreadShareNotifications(client, 'u1');
  assert.deepEqual(res.data, ROWS);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].table, 'share_notifications');
  assert.equal(asked[0].cols, `${SHARE_NOTIFICATION_COLUMNS}, scope`);
  assert.deepEqual(asked[0].filters, [
    ['eq', 'user_id', 'u1'],
    ['is', 'dismissed_at', null],
    ['order', 'created_at', { ascending: true }],
  ]);
});

test('before 0452 (42703, no such column) it reads again without scope, and stops asking', async () => {
  const missing = { code: '42703', message: 'column share_notifications.scope does not exist' };
  const plain = [{ id: 'n1', board_id: 'b1', kind: 'share' }];
  const { client, asked } = fakeClient([
    { data: null, error: missing },
    { data: plain, error: null },
    { data: plain, error: null },
  ]);
  const first = await readUnreadShareNotifications(client, 'u1');
  assert.deepEqual(first.data, plain);
  assert.equal(first.error, null);
  assert.deepEqual(asked.map((q) => q.cols), [`${SHARE_NOTIFICATION_COLUMNS}, scope`, SHARE_NOTIFICATION_COLUMNS]);
  await readUnreadShareNotifications(client, 'u1');
  assert.equal(asked.length, 3);
  assert.equal(asked[2].cols, SHARE_NOTIFICATION_COLUMNS);
});

test('any other error comes back as it is, with no second read', async () => {
  const denied = { code: '42501', message: 'permission denied' };
  const { client, asked } = fakeClient([{ data: null, error: denied }]);
  const res = await readUnreadShareNotifications(client, 'u1');
  assert.equal(res.error, denied);
  assert.equal(asked.length, 1);
});

test('the columns are the ones the toast reads', () => {
  assert.equal(SHARE_NOTIFICATION_COLUMNS, 'id, board_id, role, shared_by, created_at, kind, detail');
});
