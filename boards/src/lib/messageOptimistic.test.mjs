// Sends, reactions, edits, pins and deletes show before the server answers,
// roll back with a toast when it refuses, and a send can't be saved twice.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { newMessageId } from './messageStore.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const thread = read('../components/MessageThread.jsx');
const slice = (from, to) => thread.slice(thread.indexOf(from), thread.indexOf(to));

test('a delete goes at once, with Undo and no confirm dialog; a failure brings it back', () => {
  const fn = slice('const handleDelete', '// Resolves false when the save failed');
  assert.doesNotMatch(fn, /feedback\.confirm/);
  assert.ok(fn.indexOf('removeLocal(msg.id)') < fn.indexOf('await deleteMessage('), 'shown gone before the server answers');
  assert.match(fn, /catch \(e\) \{[\s\S]*?rollback\(opId\);[\s\S]*?feedback\.toast\(\{ type: 'error'/);
  assert.match(fn, /undoToast\(feedback,/);
  assert.match(fn, /const back = upsertLocal\(/, 'Undo shows the message again at once too');
});

test('a send keeps one id from Enter to saved, and a retry can’t save it twice', () => {
  const send = slice('const handleSend', 'const retryPending');
  assert.match(send, /id: newMessageId\(\)/);
  assert.match(send, /sendLocal\(row\)/);
  const deliver = slice('const deliverPending', 'const handleSend');
  assert.match(deliver, /id: row\.id,/);
  assert.match(deliver, /e\?\.code === '23505'/);
  assert.match(deliver, /confirmSend\(opId, saved\)/);
  assert.doesNotMatch(deliver, /await broadcastConversationMessage/, 'a slow socket must never hold a saved message at Sending…');
  assert.doesNotMatch(deliver, /await refetch\(\)/, 'no 200-row read per send');
  assert.ok(deliver.indexOf('confirmSend(opId, saved)') < deliver.indexOf('broadcastConversationMessage('),
    'the broadcast goes after the confirm, outside the failure path');
});

test('sendMessage passes the id the bubble already has', () => {
  const lib = read('./messages.js');
  const fn = lib.slice(lib.indexOf('export async function sendMessage'));
  assert.match(fn.slice(0, fn.indexOf('\n}\n')), /\.\.\.\(id \? \{ id \} : \{\}\)/);
});

test('a reaction shows at once, takes the server’s map, and rolls back on failure', () => {
  const fn = slice('const handleReact', 'const handleReply');
  assert.ok(fn.indexOf('patchLocal(') < fn.indexOf('await toggleReaction('));
  assert.match(fn, /toggleReactionMap\(msg\.reactions, emoji, userId\)/);
  assert.match(fn, /settle\(opId, reactions && typeof reactions === 'object' \? \{ patch: \{ reactions \} \} : \{\}\)/);
  assert.match(fn, /catch \(e\) \{\s*rollback\(opId\);/);
});

test('an edit shows at once; a failed save reopens the editor with your text', () => {
  const fn = slice('const handleEdit', 'const handleReact');
  assert.ok(fn.indexOf('patchLocal(') < fn.indexOf('await editMessage('));
  assert.match(fn, /rollback\(opId\);[\s\S]*?return false;/);
  const bubble = read('../components/MessageBubble.jsx');
  const submit = bubble.slice(bubble.indexOf('const submitEdit'), bubble.indexOf('const submitEdit') + 600);
  assert.match(submit, /if \(ok === false\) \{ setEditBody\(v\); setEditing\(true\); \}/);
  assert.match(submit, /savingRef\.current/, 'Enter twice saves once');
});

test('a pin shows at once and says so when it fails', () => {
  const fn = slice('const handlePin', '// Say whether it worked');
  assert.ok(fn.indexOf('patchLocal(') < fn.indexOf('await togglePin('));
  assert.match(fn, /rollback\(opId\);\s*feedback\.toast\(\{ type: 'error'/);
});

test('a message being sent is laid out in the feed with the rest, not in a list of its own', () => {
  assert.doesNotMatch(thread, /pendingMsgs/);
  assert.match(thread, /onRetrySend=\{retryPending\}\s*onDiscardSend=\{discardPending\}/);
});

test('message ids are v4 UUIDs', () => {
  const id = newMessageId();
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(newMessageId(), id);
});
