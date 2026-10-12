// COMMS-23: a stale read could paint the wrong thing. The thread isn't
// remounted on a conversation switch, so the last conversation's messages sat
// under the new header until its read landed; and an older read resolving
// after a newer one (an incoming nudge racing the post-send refetch) took
// back a message you had just sent. Only the newest read paints now, a
// switch never shows the previous rows, and a loading thread isn't "empty".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('only the newest read paints; an overtaken one waits for it', () => {
  const src = read('../hooks/useMessageThread.js');
  assert.match(src, /const seq = \+\+seqRef\.current;/);
  assert.equal((src.match(/if \(superseded\(\)\) return latestReadRef\.current;/g) || []).length, 2,
    'checked after both awaits');
  assert.match(src, /latestReadRef\.current = read;\s*return read;/);
});

test('a switch never shows the previous conversation\'s rows', () => {
  const src = read('../hooks/useMessageThread.js');
  assert.match(src, /messages\[0\]\.conversation_id !== conversationId \? NO_MESSAGES : messages/);
  assert.match(src, /setMessages\(prev => \(prev\.length && prev\[0\]\.conversation_id !== conversationId \? \[\] : prev\)\)/);
});

test('a thread still loading is not shown as empty', () => {
  const thread = read('../components/MessageThread.jsx');
  assert.match(thread, /\) : isEmpty && loading \? \(/);
});

// The supersede pattern, exercised: three overlapping reads, resolved out of
// order — only the last-issued one paints, and every caller resumes after it.
test('the pattern: out-of-order reads paint the newest only', async () => {
  let seq = 0; let latest = null; const painted = [];
  const reads = [];
  const refetch = (label) => {
    const mine = ++seq;
    let release;
    const gate = new Promise(r => { release = r; });
    const p = (async () => {
      await gate;
      if (mine !== seq) return latest;
      painted.push(label);
    })();
    latest = p;
    reads.push(release);
    return p;
  };
  const a = refetch('send'); const b = refetch('nudge'); const c = refetch('resync');
  reads[2](); reads[0](); reads[1]();
  await Promise.all([a, b, c]);
  assert.deepEqual(painted, ['resync']);
});
