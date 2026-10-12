// COMMS-20: with a cluster open in two tabs (or laptop and phone), the board
// facepile listed you as "1 other person here". It skipped only this tab's
// awareness clientID; CanvasPresence and workspace presence filter by user id.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('the facepile skips your own user id, and the canvas passes it', () => {
  const stack = read('../components/PresenceStack.jsx');
  assert.match(stack, /if \(selfId && u\.id === selfId\) return;/);
  assert.match(stack, /readPeers\(awareness, selfId\)/);
  const canvas = read('../components/CanvasSurface.jsx');
  assert.match(canvas, /<PresenceStack getAwareness=\{presenceAwareness\} selfId=\{currentUser\?\.id\} \/>/);
});
