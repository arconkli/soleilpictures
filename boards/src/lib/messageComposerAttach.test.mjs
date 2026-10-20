// COMMS-19: in the message composer a failed upload showed "Uploading…" then
// nothing, and a card or cluster dropped on it attached invisibly — no chip,
// Send stayed disabled, and it went out only if you also typed. A failed file
// now stays as its own chip that says so, with Retry; dropped refs show as
// removable chips and are enough to send.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../components/MessageComposer.jsx', import.meta.url), 'utf8');

test('a failed upload says so, on its own chip, with Retry', () => {
  assert.match(src, /att \? \{ \.\.\.i, status: 'done', att, file: null \} : \{ \.\.\.i, status: 'failed' \}/);
  assert.match(src, /item\.status === 'failed' && \(/);
  assert.match(src, /role="alert">Couldn't upload</);
  assert.match(src, /onClick=\{\(\) => retryItem\(item\)\}>Retry</);
  // A file removed while it uploaded doesn't come back when the upload lands.
  assert.match(src, /if \(!d\.items\.some\(\(i\) => i\.key === item\.key\)\) return d;/);
});

test('uploads run beside the typing: the field is never disabled, Send waits for them', () => {
  const field = src.slice(src.indexOf('<GrowingTextarea'), src.indexOf('/>', src.indexOf('<GrowingTextarea')));
  assert.doesNotMatch(field, /disabled=/);
  assert.match(src, /uploadQueue\.run\(\(\) => uploadMessageFile\(item\.file, \{ workspaceId, userId \}\)\)/);
  assert.match(src, /const uploading = items\.some\(\(i\) => i\.status === 'uploading'\);/);
  assert.match(src, /if \(isBusy\) return;/);
});

test('dropped refs render as chips and count toward Send', () => {
  assert.match(src, /pendingEntityRefs\.map\(\(r, i\) => \(/);
  assert.match(src, /const hasPayload = attachments\.length > 0 \|\| pendingEntityRefs\.length > 0;/);
  assert.match(src, /if \(!v && !hasPayload\) return;/);
  assert.match(src, /disabled=\{isBusy \|\| \(!body\.trim\(\) && !hasPayload\)\}/);
});

test('a send takes what it sent out of the draft at once, and leaves a failed file for Retry', () => {
  const send = src.slice(src.indexOf('const send = async'), src.indexOf('// Insert a URL chip'));
  assert.match(send, /const sent = items\.filter\(\(i\) => i\.status === 'done'\);/);
  assert.match(send, /\{ now: true \}\);/);
});
