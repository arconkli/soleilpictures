import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decoderOf, sniffLoader, sniffListed, gzipName, SOURCE_LOADERS } from '../src/viewArgs.js';
import { ZIP_EXTS, LISTED_EXTS } from '../../boards/src/lib/fileView.js';

const bytes = (...xs) => new Uint8Array(xs);
const at = (offset, ...xs) => { const b = new Uint8Array(offset + xs.length); b.set(xs, offset); return b; };

test('a zip is drawn as a sheet of what is inside it, any other archive as its names', () => {
  for (const ext of ZIP_EXTS) assert.equal(decoderOf(ext), 'sheet', ext);
  for (const ext of [...LISTED_EXTS, 'RAR', '7Z']) assert.equal(decoderOf(ext), 'listing', ext);
});

test('a picture inside a zip may be a WebP or a GIF, which no other view reads', () => {
  assert.equal(sniffLoader(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50)), 'webpload');
  assert.equal(sniffLoader(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45)), null, 'a WAV is RIFF too');
  assert.equal(sniffLoader(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)), 'gifload');
  assert.equal(sniffLoader(bytes(0x47, 0x49, 0x46, 0x38, 0x37, 0x61)), 'gifload');
  assert.ok(!SOURCE_LOADERS.includes('webpload') && !SOURCE_LOADERS.includes('gifload'), 'a downloaded file is never read as one');
});

test('only an archive bsdtar is asked to list reaches it', () => {
  assert.ok(sniffListed(bytes(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 4)), '7z');
  assert.ok(sniffListed(bytes(0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00)), 'RAR 4');
  assert.ok(sniffListed(bytes(0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00)), 'RAR 5');
  assert.ok(sniffListed(bytes(0x1f, 0x8b, 8, 0)), 'gzip');
  assert.ok(sniffListed(bytes(0x42, 0x5a, 0x68, 0x39)), 'bzip2');
  assert.ok(sniffListed(bytes(0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00)), 'xz');
  assert.ok(sniffListed(at(257, 0x75, 0x73, 0x74, 0x61, 0x72)), 'a POSIX tar');
  // An ISO image, cpio, mtree's text and a zip are libarchive's too, never listed.
  assert.ok(!sniffListed(new TextEncoder().encode('#mtree\n./etc/passwd type=file\n')));
  assert.ok(!sniffListed(bytes(0x30, 0x37, 0x30, 0x37, 0x30, 0x31)), 'cpio');
  assert.ok(!sniffListed(bytes(0x50, 0x4b, 0x03, 0x04)), 'a zip is a sheet');
  assert.ok(!sniffListed(at(256, 0x75, 0x73, 0x74, 0x61, 0x72)), 'ustar a byte early');
  assert.ok(!sniffListed(null));
});

test('a .gz that holds no archive is named by what gzip kept of its name', () => {
  const name = (s, flags = 0x08, extra = null) => {
    const head = [0x1f, 0x8b, 8, flags, 0, 0, 0, 0, 0, 3];
    if (extra) head.push(extra.length & 0xff, extra.length >> 8, ...extra);
    return new Uint8Array([...head, ...[...s].map((c) => c.charCodeAt(0)), 0, 0x55]);
  };
  assert.equal(gzipName(name('call-sheet.csv')), 'call-sheet.csv');
  assert.equal(gzipName(name('../../etc/day 4.csv')), 'day 4.csv', 'a path keeps only its last part');
  assert.equal(gzipName(name('café.txt')), 'café.txt', 'ISO 8859-1');
  assert.equal(gzipName(name('notes.txt', 0x0c, [1, 2, 3])), 'notes.txt', 'after an extra field');
  assert.equal(gzipName(name('notes.txt', 0x00)), null, 'no name kept');
  assert.equal(gzipName(bytes(0x42, 0x5a, 0x68)), null, 'not a gzip');
  assert.equal(gzipName(new Uint8Array([0x1f, 0x8b, 8, 0x08, 0, 0, 0, 0, 0, 3, 0x61, 0x62])), null, 'a name with no end');
});
