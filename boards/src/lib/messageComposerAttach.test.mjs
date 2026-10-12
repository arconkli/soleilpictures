// COMMS-19: in the message composer a failed upload showed "Uploading…" then
// nothing, and a card or cluster dropped on it attached invisibly — no chip,
// Send stayed disabled, and it went out only if you also typed. Failures now
// toast; dropped refs show as removable chips and are enough to send.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../components/MessageComposer.jsx', import.meta.url), 'utf8');

test('a failed upload says so', () => {
  assert.match(src, /if \(att\) uploaded\.push\(att\); else failed\.push\(f\.name \|\| 'file'\);/);
  assert.match(src, /Couldn't attach \$\{failed\[0\]\}/);
});

test('dropped refs render as chips and count toward Send', () => {
  assert.match(src, /pendingEntityRefs\.map\(\(r, i\) => \(/);
  assert.match(src, /const hasPayload = attachments\.length > 0 \|\| pendingEntityRefs\.length > 0;/);
  assert.match(src, /if \(!v && !hasPayload\) return;/);
  assert.match(src, /disabled=\{isBusy \|\| \(!body\.trim\(\) && !hasPayload\)\}/);
});
