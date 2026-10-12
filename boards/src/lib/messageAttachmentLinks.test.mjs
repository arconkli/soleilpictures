// COMMS-07: a file attachment in a message was plain text — no way to open or
// save it except dragging it onto a canvas, and on a phone not even that.
// Files are now download links under their own name; images open full size.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { attachmentUrl, attachmentMetaLabel, formatAttachmentSize } from './messageAttachmentLinks.js';

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
