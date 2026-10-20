// The Messages events carry a message's shape and never its words. See
// messageEvents.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lenBucket, sendShape, conversationKind, errorCode } from './messageEvents.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('a length is a bucket', () => {
  assert.deepEqual([0, 20, 21, 80, 81, 240, 241, 5000].map(lenBucket), ['xs', 'xs', 's', 's', 'm', 'm', 'l', 'l']);
});

test('a sent message is described by its shape alone', () => {
  const row = {
    body: 'the north gate at noon, bring the contract',
    attachments: [{ name: 'contract-final.pdf' }],
    mentions: ['user-2', 'user-3'],
    parent_id: 'msg-1',
  };
  const shape = sendShape(row);
  assert.deepEqual(shape, { chars: 's', attach_n: 1, mention_n: 2, reply: true });
  const text = JSON.stringify(shape);
  for (const word of ['north', 'gate', 'contract', 'user-2', 'msg-1']) assert.ok(!text.includes(word), word);
  assert.deepEqual(sendShape({}), { chars: 'xs', attach_n: 0, mention_n: 0, reply: false });
});

test('a conversation is a DM, a group or just you', () => {
  assert.equal(conversationKind(2), 'dm');
  assert.equal(conversationKind(5), 'group');
  assert.equal(conversationKind(1), 'solo');
  assert.equal(conversationKind(undefined), null, 'one just made is not in the list yet');
});

test('a failure is its code, never its message', () => {
  assert.equal(errorCode({ code: '23505', message: 'Key (id)=(x) already exists', details: 'quoted row' }), '23505');
  assert.equal(errorCode(new TypeError('Failed to fetch')), 'TypeError');
  assert.equal(errorCode(null), 'unknown');
});

// Every argument list handed to logEvent(EV.MSG_…) in these files, by
// bracket matching, so a later edit can't slip a message's text into one.
function msgEventCalls(src) {
  const calls = [];
  let at = 0;
  while ((at = src.indexOf('logEvent(EV.MSG_', at)) !== -1) {
    let depth = 0;
    let i = at + 'logEvent'.length;
    for (; i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')' && --depth === 0) break;
    }
    calls.push(src.slice(at, i + 1));
    at = i;
  }
  return calls;
}

test('no Messages event is handed a message, a name, a title or a search', () => {
  const files = ['../components/MessageThread.jsx', '../components/MessagesPanel.jsx', '../App.jsx'];
  const calls = files.flatMap((f) => msgEventCalls(read(f)));
  assert.ok(calls.length >= 10, `found ${calls.length} calls`);
  for (const call of calls) {
    assert.doesNotMatch(call, /\.body\b|\bbody:|searchQuery|\btitle\b|\bname\b|\bemail\b|\bemoji\b|\.message\b|\bquote\b|\bq\b(?!_)/, call);
  }
});

test('a send is logged once it is answered, either way, and a search once it ends', () => {
  const thread = read('../components/MessageThread.jsx');
  const deliver = thread.slice(thread.indexOf('const deliverPending = useCallback'), thread.indexOf('const handleSend = useCallback'));
  const failed = deliver.slice(deliver.indexOf('if (!saved) {'), deliver.indexOf('return;'));
  assert.match(failed, /logEvent\(EV\.MSG_SEND, \{ ok: false,/);
  assert.ok(deliver.indexOf('logEvent(EV.MSG_SEND, { ok: true,') > deliver.indexOf('confirmSend(opId, saved)'));
  assert.match(thread, /const closeSearch = \(\) => \{\s*endSearch\(false\);/);
  assert.match(thread, /onClick=\{\(\) => \{ endSearch\(true\); jumpTo\(m\.id\); \}\}/);
});
