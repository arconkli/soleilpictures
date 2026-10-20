// A thread marks itself read only once its newest message has been seen, and
// records that message's SERVER time, never the device clock's, moving
// forward only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('markRead writes the newest seen message’s server time, and only forward', () => {
  const lib = read('./messages.js');
  const fn = lib.slice(lib.indexOf('export async function markRead'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /const at = upTo \|\| new Date\(\)\.toISOString\(\);/);
  assert.match(body, /\.update\(\{ last_read_at: at \}\)/);
  assert.match(body, /\.or\(`last_read_at\.is\.null,last_read_at\.lt\."\$\{at\}"`\)/, 'a stale tab can’t take a read back');
});

test('the thread marks up to its newest server row, never a send in flight', () => {
  const src = read('../hooks/useMessageThread.js');
  assert.match(src, /const newest = \[\.\.\.view\]\.reverse\(\)\.find\(m => !m\.sendState\) \|\| null;/);
  assert.match(src, /markRead\(\{ conversationId, userId, upTo \}\)/);
});

test('the end of the thread on screen opens the read gate', () => {
  const thread = read('../components/MessageThread.jsx');
  assert.match(thread, /readGate: bottomSeen && newAfter !== undefined,/, 'and never before the old read position is known');
  assert.match(thread, /new IntersectionObserver\(\(\[e\]\) => setBottomSeen\(e\.isIntersecting\), \{ root, threshold: 0 \}\)/);
  assert.match(thread, /<div className="msg-thread-end" ref=\{endRef\} aria-hidden="true" \/>/);
});
