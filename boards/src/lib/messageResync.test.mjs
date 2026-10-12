// COMMS-04: an open thread and the inbox read again whenever the live feed
// may have dropped something — the channel rejoining, the tab coming back,
// the network returning, an inbox ping for the thread — and a peer's edit,
// delete, restore, pin, reaction or "X added Y" nudges the others to read.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { watchForResync } from './messageResync.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const wait = (ms) => new Promise(r => setTimeout(r, ms));

function fakeDoc() {
  const d = new EventTarget();
  d.visibilityState = 'visible';
  return d;
}

test('coming back to the tab and the network returning both read again, coalesced', async () => {
  const win = new EventTarget();
  const doc = fakeDoc();
  let runs = 0;
  const r = watchForResync(() => { runs++; }, { win, doc, delayMs: 5 });
  doc.dispatchEvent(new Event('visibilitychange'));
  win.dispatchEvent(new Event('online'));
  r.kick();
  await wait(20);
  assert.equal(runs, 1, 'waking a laptop fires all three at once: one read');
  win.dispatchEvent(new Event('online'));
  await wait(20);
  assert.equal(runs, 2);
  r.stop();
});

test('a tab going INTO the background does not read', async () => {
  const doc = fakeDoc();
  let runs = 0;
  const r = watchForResync(() => { runs++; }, { win: new EventTarget(), doc, delayMs: 5 });
  doc.visibilityState = 'hidden';
  doc.dispatchEvent(new Event('visibilitychange'));
  await wait(20);
  assert.equal(runs, 0);
  r.stop();
});

test('stop() drops a pending read and the listeners', async () => {
  const win = new EventTarget();
  let runs = 0;
  const r = watchForResync(() => { runs++; }, { win, doc: fakeDoc(), delayMs: 5 });
  r.kick();
  r.stop();
  win.dispatchEvent(new Event('online'));
  await wait(20);
  assert.equal(runs, 0);
});

test('a failing read is contained', async () => {
  const r = watchForResync(async () => { throw new Error('offline'); }, { win: new EventTarget(), doc: fakeDoc(), delayMs: 1 });
  const warn = console.warn; console.warn = () => {};
  try { r.kick(); await wait(10); } finally { console.warn = warn; r.stop(); }
});

test('the thread reads again on a rejoin and on an inbox ping for itself', () => {
  const src = read('../hooks/useMessageThread.js');
  assert.match(src, /onSubscribed: resync\.kick/);
  assert.match(src, /subscribeInbox\(userId,[\s\S]*?payload\?\.conversation_id === conversationId\) resync\.kick\(\)/);
  const rt = read('./messageRealtime.js');
  assert.match(rt, /channel\.subscribe\(\(status\) => \{ if \(status === 'SUBSCRIBED'\) onSubscribed\?\.\(\); \}\)/);
});

test('the inbox list reads again on a REjoin, refocus and reconnect', () => {
  const src = read('../hooks/useConversationList.js');
  assert.match(src, /watchForResync\(schedule\)/);
  assert.match(src, /if \(joined\) resync\.kick\(\);/);
});

test('every change to a message already in the thread nudges the peers', () => {
  const src = read('../components/MessageThread.jsx');
  for (const kind of ['delete', 'restore', 'edit', 'react', 'pin', 'participants']) {
    assert.match(src, new RegExp(`broadcastConversationChange\\(\\{ conversationId, changed: '${kind}'`), kind);
  }
  // The nudge rides 'chat-message' so tabs opened before this shipped still read.
  const rt = read('./messageRealtime.js');
  assert.match(rt, /export function broadcastConversationChange[\s\S]*?broadcastConversationMessage\(/);
});
