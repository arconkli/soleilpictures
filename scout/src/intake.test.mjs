// Scout's intake and media guards (the 2026-10-06 security audit).
//
// Run by the boards `npm test` invocation, like media.test.mjs. Scout has not
// launched, so these are the only thing standing between a fix made today and
// the day it starts reading strangers' messages.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';

import { isDirectChat, burstKey } from './batcher.js';
import { INPUT_GUARD, hasFfmpeg, probeMedia } from './ffmpeg.js';
import { normalizeImage, readExif } from './media.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('only a 1:1 chat is read, and a burst belongs to one sender', () => {
  assert.equal(isDirectChat({ id: 'iMessage;-;+15550001111', type: 'dm' }), true);
  assert.equal(isDirectChat({ id: 'iMessage;+;chat123456', type: 'group' }), false);
  // Either signal alone is enough to skip.
  assert.equal(isDirectChat({ id: 'iMessage;+;chat123456' }), false);
  assert.equal(isDirectChat({ id: 'iMessage;-;+15550001111', type: 'group' }), false);
  assert.equal(isDirectChat({}), false);
  assert.notEqual(burstKey('imessage', { id: 'c' }, '+15550001111'), burstKey('imessage', { id: 'c' }, '+15550002222'));

  const index = read('./index.js');
  assert.match(index, /if \(!isDirectChat\(space\) \|\| message\?\.direction === 'outbound'\) continue;/);
  assert.match(index, /const key = burstKey\(platform, space, handle\);/);
});

test('every ffmpeg and ffprobe input may only be the local file, in a real container', () => {
  assert.deepEqual(INPUT_GUARD.slice(0, 3), ['-protocol_whitelist', 'file', '-format_whitelist']);
  const formats = INPUT_GUARD[3].split(',');
  for (const banned of ['hls', 'concat', 'lavfi', 'image2', 'tty', 'subviewer', 'webvtt', 'srt']) {
    assert.ok(!formats.includes(banned), `${banned} must not be an allowed input format`);
  }
  const src = read('./ffmpeg.js');
  const calls = [...src.matchAll(/run\('(ffmpeg|ffprobe)', \[([\s\S]*?)\], \{/g)]
    .filter(([, , args]) => !args.includes("'-version'"));
  assert.ok(calls.length >= 4, 'probe, poster, audio and transcode');
  for (const [, bin, args] of calls) assert.match(args, /\.\.\.INPUT_GUARD/, `an ${bin} call reads input without the guard`);
});

test('a playlist or concat list saved as a video is refused (when ffmpeg is installed)', async (t) => {
  if (!await hasFfmpeg()) { t.skip('ffmpeg is not installed here'); return; }
  const playlist = Buffer.from('#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:1.0,\nfile:///etc/hosts\n#EXT-X-ENDLIST\n');
  assert.equal(await probeMedia(playlist, 'mov'), null);
  assert.equal(await probeMedia(Buffer.from("ffconcat version 1.0\nfile '/etc/hosts'\n"), 'mov'), null);
});

test('an iPhone HEIC becomes a JPEG that opens everywhere, and keeps where and when it was taken', async () => {
  // A real HEVC-coded HEIC, 64×48, carrying a capture date and coordinates.
  const heic = readFileSync(new URL('./fixtures/geo.heic', import.meta.url));
  assert.equal((await sharp(heic).metadata()).compression, 'hevc');

  const out = await normalizeImage(heic, 'image/heic', 'IMG_0001.HEIC');
  assert.equal(out.mimeType, 'image/jpeg');
  const meta = await sharp(out.bytes).metadata();
  assert.equal(meta.format, 'jpeg');
  assert.deepEqual([meta.width, meta.height], [64, 48]);
  assert.equal(meta.exif, undefined, 'the stored JPEG carries no EXIF; the card carries time and place');

  const { shotAt, geo } = readExif(out.exif);
  assert.equal(shotAt, '2026-08-11T09:14:02.000Z');
  assert.ok(Math.abs(geo[0] - 34.09806) < 0.001 && Math.abs(geo[1] + 118.32889) < 0.001, `geo ${geo}`);
});

test('HEIC is decoded in WebAssembly, and sharp is past its libheif advisories', () => {
  const pkg = JSON.parse(read('../package.json'));
  assert.ok(!pkg.dependencies.heif2jpeg, 'heif2jpeg is a native libheif build on a host holding the service-role key');
  assert.ok(pkg.dependencies['heic-decode']);
  assert.match(read('./media.js'), /import decodeHeic from 'heic-decode';/);
  const [major, minor, patch] = JSON.parse(read('../node_modules/sharp/package.json')).version.split('.').map(Number);
  assert.ok(major > 0 || minor > 35 || (minor === 35 && patch >= 4), 'sharp >= 0.35.4');
});
