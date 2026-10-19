import test from 'node:test';
import assert from 'node:assert/strict';
import { railConversations, hereNow, pickUp } from './homeRail.js';

const names = { me: 'Andrew', maya: 'Maya Ortiz', jon: 'Jon Park', lena: 'Lena Fischer' };
const nameOf = (id) => names[id] || '';
const colorOf = (id) => `#${id.length}00000`;

function inbox() {
  const conversations = [
    { conversation_id: 'dm-maya', last_message_body: 'Recce at 2', last_message_sender_id: 'maya', last_message_at: '2026-10-19T10:00:00Z' },
    { conversation_id: 'grp', title: 'Casting', last_message_body: 'Callbacks Thursday', last_message_sender_id: 'lena', last_message_at: '2026-10-19T09:00:00Z' },
    { conversation_id: 'dm-jon', last_message_body: 'Sent it', last_message_sender_id: 'me', last_message_at: '2026-10-18T09:00:00Z' },
    { conversation_id: 'left', title: 'Old group', last_message_body: 'x', last_message_sender_id: 'jon', last_message_at: '2026-10-17T09:00:00Z' },
    { conversation_id: 'sys', title: 'Grade', last_message_body: 'You added Sam', last_message_kind: 'system', last_message_sender_id: 'me', last_message_at: '2026-10-16T09:00:00Z' },
  ];
  const participantsByConv = new Map([
    ['dm-maya', [{ user_id: 'me' }, { user_id: 'maya' }]],
    ['grp', [{ user_id: 'me' }, { user_id: 'lena' }, { user_id: 'jon' }, { user_id: 'sam', left_at: '2026-10-01' }]],
    ['dm-jon', [{ user_id: 'me' }, { user_id: 'jon' }]],
    ['left', [{ user_id: 'me', left_at: '2026-10-18' }, { user_id: 'jon' }, { user_id: 'maya' }]],
    ['sys', [{ user_id: 'me' }, { user_id: 'maya' }, { user_id: 'jon' }]],
  ]);
  const me = (id, left_at = null) => [id, { user_id: 'me', left_at }];
  const myStateByConv = new Map([me('dm-maya'), me('grp'), me('dm-jon'), me('left', '2026-10-18T00:00:00Z'), me('sys')]);
  const unreadByConv = new Map([['dm-maya', 2], ['grp', 0]]);
  return { conversations, participantsByConv, myStateByConv, unreadByConv };
}

test('railConversations: newest first, the inbox\'s previews, at most three', () => {
  const rows = railConversations(inbox(), { selfId: 'me', nameOf, colorOf });
  assert.deepEqual(rows.map(r => r.id), ['dm-maya', 'grp', 'dm-jon']);
  assert.equal(rows[0].name, 'Maya Ortiz');
  assert.equal(rows[0].preview, 'Recce at 2');
  assert.equal(rows[0].unread, 2);
  assert.equal(rows[0].dm, true);
  assert.equal(rows[1].name, 'Casting');
  assert.equal(rows[1].preview, 'Lena: Callbacks Thursday');
  assert.deepEqual(rows[1].avatars.map(a => a.initial), ['L', 'J']);
  assert.equal(rows[2].preview, 'You: Sent it');
});

test('railConversations: a group you left stays out; a system line has no prefix', () => {
  const rows = railConversations(inbox(), { selfId: 'me', nameOf, colorOf, limit: 10 });
  assert.equal(rows.some(r => r.id === 'left'), false);
  assert.equal(rows.find(r => r.id === 'sys').preview, 'You added Sam');
});

test('railConversations: nothing in, nothing out', () => {
  assert.deepEqual(railConversations(null), []);
  assert.deepEqual(railConversations({ conversations: [] }), []);
});

test('hereNow: one row a person, not you, not a tab in the background, where they are', () => {
  const boards = { film: { id: 'film', name: 'Feature film' }, x: { id: 'x', name: '  ' } };
  const peers = [
    { user: { id: 'me' }, location: { boardId: 'film' } },
    { user: { id: 'maya', name: 'Maya Ortiz' }, location: { boardId: 'film', isActive: true } },
    { user: { id: 'maya', name: 'Maya Ortiz' }, location: { boardId: 'x' } },
    { user: { id: 'jon', name: 'Jon Park' }, location: { boardId: 'x' } },
    { user: { id: 'lena', name: 'Lena' }, location: { boardId: 'film', isActive: false } },
    { user: { id: 'sam' }, location: null },
  ];
  const rows = hereNow(peers, boards, { selfId: 'me', nameOf: (p) => p.user.name || '' });
  assert.deepEqual(rows.map(r => [r.id, r.name, r.where]), [
    ['maya', 'Maya Ortiz', 'In Feature film'],
    ['jon', 'Jon Park', 'In Untitled cluster'],
    ['sam', 'Someone', 'Here now'],
  ]);
  assert.deepEqual(rows[0].loc, { boardId: 'film', isActive: true });
  assert.equal(rows[2].initial, 'S');
});

test('pickUp: the last cluster, and the next few', () => {
  const boards = {
    root: { id: 'root', workspace_id: 'w', parent_board_id: null, updated_at: '2026-10-01' },
    film: { id: 'film', workspace_id: 'w', parent_board_id: 'root', updated_at: '2026-10-19' },
    mv: { id: 'mv', workspace_id: 'w', parent_board_id: 'root', updated_at: '2026-10-16' },
    cast: { id: 'cast', workspace_id: 'w', parent_board_id: 'film', updated_at: '2026-10-18' },
  };
  const { last, rest } = pickUp(boards, ['cast'], 'root', { workspaceId: 'w' });
  assert.equal(last.id, 'cast');
  assert.deepEqual(rest.map(b => b.id), ['film', 'mv', 'root']);
  assert.deepEqual(pickUp(null, [], 'root'), { last: null, rest: [] });
});
