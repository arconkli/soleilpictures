// COMMS-07: a file attachment in a message was plain text — no way to open or
// save it except dragging it onto a canvas, and on a phone not even that.
// Files are now download links under their own name; images open full size.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { attachmentUrl, attachmentMetaLabel, formatAttachmentSize, imageBoxStyle } from './messageAttachmentLinks.js';

const BASE = 'https://x.supabase.co';

test('the object URL, and a download URL that keeps the real name', () => {
  assert.equal(attachmentUrl(BASE, 'ws/u/abc.pdf'),
    'https://x.supabase.co/storage/v1/object/public/message-attachments/ws/u/abc.pdf');
  assert.equal(attachmentUrl(BASE, 'ws/u/abc.pdf', { download: 'Call sheet #2.pdf' }),
    'https://x.supabase.co/storage/v1/object/public/message-attachments/ws/u/abc.pdf?download=Call%20sheet%20%232.pdf');
  assert.equal(attachmentUrl('', 'ws/u/abc.pdf'), '');
  assert.equal(attachmentUrl(BASE, null), '');
});

test('type and size label', () => {
  assert.equal(attachmentMetaLabel({ name: 'cut.mp4', size: 3.4 * 1024 * 1024 }), 'MP4 · 3.4 MB');
  assert.equal(attachmentMetaLabel({ name: 'notes', mime: 'application/zip', size: 900 }), 'ZIP · 900 B');
  assert.equal(attachmentMetaLabel({ name: 'x.pdf' }), 'PDF');
  assert.equal(formatAttachmentSize(2048), '2 KB');
  assert.equal(formatAttachmentSize(null), '');
});

test('the bubble links files and images', () => {
  const src = readFileSync(new URL('../components/MessageBubble.jsx', import.meta.url), 'utf8');
  assert.match(src, /<a className="msg-attachment-file"[\s\S]*?download=\{att\.name \|\| 'file'\}/);
  assert.match(src, /<a className="msg-attachment-image" href=\{publicUrl\(att\.storage_path\)\}/);
  assert.doesNotMatch(src, /\{att\.kind === 'file' && \(\s*<span className="msg-attachment-file">/);
});

// COMMS-16: opening a thread smooth-scrolled through the whole history, and
// images then loaded at full height above the newest message, leaving the
// reader mid-thread. The first page now lands instantly, images reserve
// their box before they load (bounded in height), and a load while the
// reader is at the bottom keeps them there.
test('an image reserves its box from the recorded dimensions, bounded in height', () => {
  assert.deepEqual(imageBoxStyle({ width: 1600, height: 900 }),
    { aspectRatio: '1600 / 900', width: 'min(100%, 569px)', height: 'auto' });
  // A tall portrait is capped at 320px high: 320 * 1000/3000 ≈ 107px wide.
  assert.equal(imageBoxStyle({ width: 1000, height: 3000 }).width, 'min(100%, 107px)');
  // A small image never stretches past its own width.
  assert.equal(imageBoxStyle({ width: 120, height: 80 }).width, 'min(100%, 120px)');
  assert.equal(imageBoxStyle({ name: 'old.png' }), null);
});

test('the thread opens at the bottom instantly and re-pins as images load', () => {
  const src = readFileSync(new URL('../components/MessageThread.jsx', import.meta.url), 'utf8');
  assert.match(src, /requestAnimationFrame\(\(\) => jumpToBottom\(!!prevId\)\)/);
  assert.match(src, /el\.addEventListener\('load', onLoad, true\)/);
  const bubble = readFileSync(new URL('../components/MessageBubble.jsx', import.meta.url), 'utf8');
  assert.match(bubble, /style=\{imageBoxStyle\(att\) \|\| undefined\}/);
});
