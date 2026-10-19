// lib/docRoomPresence.js: what of a presence crosses a shared doc's mirror,
// and its wire format against y-protocols' own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { docPresenceOf, encodePresence, decodePresence, PRESENCE_MAX_ENTRIES } from './docRoomPresence.js';

const CARD = 'doc-123';

test('only this doc’s fields cross, with the name and color, as p:<client id>', () => {
  const member = {
    user: { id: 'b3c1-user-uuid', name: 'Andrew', color: '#4f8df8', email: 'a@x.co' },
    cursor: { x: 10, y: 20 },                     // the canvas cursor: never
    location: { boardId: 'board-1', docCardId: CARD },
    docCaret: { boardId: CARD, pageId: 'p1', head: 'AQID' },
    docCursor: { boardId: 'doc-other', pageId: 'p9', x: 1, y: 2 },   // another doc: never
  };
  assert.deepEqual(docPresenceOf(member, CARD, 42), {
    docCaret: { boardId: CARD, pageId: 'p1', head: 'AQID' },
    user: { id: 'p:42', name: 'Andrew', color: '#4f8df8' },
  });
  const guest = { user: { name: 'Sam', color: '#2fb67c', guest: true }, docSelection: { boardId: CARD, pageId: 'p1', from: 'a', to: 'b' } };
  assert.equal(docPresenceOf(guest, CARD, 7).user.guest, true);
  assert.equal(docPresenceOf(guest, CARD, 7).user.id, 'p:7');
});

test('nothing crosses for a presence not in this doc, or without a user', () => {
  assert.equal(docPresenceOf({ user: { name: 'A' }, cursor: { x: 1 } }, CARD, 1), null);
  assert.equal(docPresenceOf({ docCaret: { boardId: CARD } }, CARD, 1), null);
  assert.equal(docPresenceOf(null, CARD, 1), null);
  assert.equal(docPresenceOf({ user: { name: 'A' }, docCaret: { boardId: CARD } }, '', 1), null);
  const huge = { user: { name: 'A' }, docSelection: { boardId: CARD, rects: Array(500).fill({ x: 1, y: 2, w: 3, h: 4 }) } };
  assert.equal(docPresenceOf(huge, CARD, 1), null, 'an oversized state does not cross');
});

test('the wire format is an awareness update: y-protocols reads ours, and we read its', () => {
  const doc = new Y.Doc();
  const aw = new Awareness(doc);
  clearInterval(aw._checkInterval);
  const bytes = encodePresence([
    { id: 101, clock: 3, state: { user: { id: 'p:101', name: 'Sam' }, docCaret: { boardId: CARD } } },
    { id: 102, clock: 1, state: null },
  ]);
  applyAwarenessUpdate(aw, bytes, null);
  assert.equal(aw.getStates().get(101).user.name, 'Sam');
  assert.equal(aw.getStates().has(102), false);
  assert.equal(aw.meta.get(101).clock, 3);

  const doc2 = new Y.Doc();
  const theirs = new Awareness(doc2);
  clearInterval(theirs._checkInterval);
  theirs.setLocalState({ user: { name: 'Mo' }, docCursor: { boardId: CARD, x: 1 } });
  const back = decodePresence(encodeAwarenessUpdate(theirs, [doc2.clientID]));
  assert.equal(back.length, 1);
  assert.equal(back[0].id, doc2.clientID);
  assert.equal(back[0].state.user.name, 'Mo');
  aw.destroy(); theirs.destroy();
});

test('anything that is not an update reads as nothing', () => {
  assert.deepEqual(decodePresence(new Uint8Array([1, 2])), []);
  assert.deepEqual(decodePresence(new Uint8Array([])), []);
  const many = encodePresence(Array.from({ length: PRESENCE_MAX_ENTRIES + 5 }, (_, i) => ({ id: i, clock: 1, state: null })));
  assert.equal(decodePresence(many).length, PRESENCE_MAX_ENTRIES, 'we never send more than the cap');
});
