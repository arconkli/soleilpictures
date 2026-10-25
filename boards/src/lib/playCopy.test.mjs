// Which files get a copy every browser can play, what the copy is called, and
// what a finished copy writes back onto its card (lib/playCopy.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  copyKeys, copyKeyFor, isCopyKey, mediaKindOfKey, extOfKey, copyHint, playPlan, copyDims,
  knownCopy, probeDuration, PLAY_COPY_MAX_SECONDS, PLAY_COPY_MAX_BYTES,
} from './playCopy.js';
import { copyCardPatch } from './playCopyClient.js';

const WS = '0b6e2f0a-6c55-4b8e-9d0a-2a3f1c9e7b11';

test('a copy is named after its original', () => {
  assert.deepEqual(copyKeys(`${WS}/abc.mov`), {
    video: `${WS}/previews/abc.play.mp4`, audio: `${WS}/previews/abc.play.m4a`, poster: `${WS}/previews/abc.poster.webp`,
  });
  assert.equal(copyKeyFor(`${WS}/abc.aiff`, 'audio'), `${WS}/previews/abc.play.m4a`);
  assert.equal(copyKeyFor(`${WS}/abc.mkv`, 'video'), `${WS}/previews/abc.play.mp4`);
  // No extension: the suffix is added, nothing is cut off.
  assert.equal(copyKeys(`${WS}/abc`).video, `${WS}/previews/abc.play.mp4`);
  // Only the last extension goes: a dotted name keeps the rest.
  assert.equal(copyKeys(`${WS}/take.2.final.mov`).video, `${WS}/previews/take.2.final.play.mp4`);
  // A nested original gets its previews/ beside it.
  assert.equal(copyKeys(`${WS}/scout/abc.mov`).poster, `${WS}/scout/previews/abc.poster.webp`);
});

test('a copy is never mistaken for an original', () => {
  for (const k of Object.values(copyKeys(`${WS}/abc.mov`))) {
    assert.equal(isCopyKey(k), true, k);
    assert.equal(mediaKindOfKey(k), null, `${k} is never converted again`);
  }
  assert.equal(isCopyKey(`${WS}/abc.mp4`), false);
  assert.equal(isCopyKey(`${WS}/display.mp4`), false, 'a name that merely contains "play"');
  assert.equal(isCopyKey(`${WS}/x.play.mp4`), false, 'only under previews/');
  assert.equal(isCopyKey(`${WS}/previews/0b6e2f0a-6c55-4b8e-9d0a-2a3f1c9e7b11.webp`), false, "an image's preview");
});

test('the kind comes from the extension', () => {
  for (const e of ['mov', 'MP4', 'mkv', 'avi', 'wmv', 'flv', 'mpg', 'mts', 'mxf', 'webm', '3gp']) {
    assert.equal(mediaKindOfKey(`${WS}/x.${e}`), 'video', e);
  }
  for (const e of ['wav', 'aiff', 'aif', 'flac', 'm4a', 'caf', 'wma', 'amr', 'opus', 'ogg', 'mp3']) {
    assert.equal(mediaKindOfKey(`${WS}/x.${e}`), 'audio', e);
  }
  for (const k of [`${WS}/x.jpg`, `${WS}/x.pdf`, `${WS}/x`, '', null]) assert.equal(mediaKindOfKey(k), null);
  assert.equal(extOfKey(`${WS}/x.MOV`), 'mov');
});

const h264 = { codec: 'avc1', prof: 'High', w: 1920, h: 1080, bitrate: 12_000_000, audio: { codec: 'mp4a' } };

test('an upload skips the converter only when it surely plays everywhere', () => {
  assert.equal(copyHint({ kind: 'video', ext: 'mp4', media: h264 }), false, 'a phone H.264 MP4');
  assert.equal(copyHint({ kind: 'video', ext: 'mov', media: { ...h264, audio: null } }), false, 'silent');
  assert.equal(copyHint({ kind: 'video', ext: 'mov', media: { ...h264, codec: 'hvc1', prof: 'Main 10' } }), true, 'iPhone HEVC');
  assert.equal(copyHint({ kind: 'video', ext: 'mov', media: { ...h264, codec: 'apch' } }), true, 'ProRes');
  assert.equal(copyHint({ kind: 'video', ext: 'mov', media: { ...h264, prof: 'High 4:2:2' } }), true);
  assert.equal(copyHint({ kind: 'video', ext: 'mov', media: { ...h264, audio: { codec: 'lpcm' } } }), true, 'PCM sound');
  assert.equal(copyHint({ kind: 'video', ext: 'mp4', media: { ...h264, bitrate: 80_000_000 } }), true, 'too heavy to stream');
  assert.equal(copyHint({ kind: 'video', ext: 'mp4', media: { ...h264, w: 4096, h: 2160 } }), true, 'over 4K');
  assert.equal(copyHint({ kind: 'video', ext: 'mp4', media: null }), true, 'unread: let the converter look');
  assert.equal(copyHint({ kind: 'video', ext: 'mkv', media: h264 }), true, 'container');
  assert.equal(copyHint({ kind: 'audio', ext: 'mp3' }), false);
  assert.equal(copyHint({ kind: 'audio', ext: 'wav' }), false);
  assert.equal(copyHint({ kind: 'audio', ext: 'aiff' }), true);
  assert.equal(copyHint({ kind: 'audio', ext: 'm4a' }), true, 'could be ALAC');
  assert.equal(copyHint({ kind: 'image', ext: 'png' }), false);
});

const probe = ({ v = null, a = null, format = 'mov,mp4,m4a,3gp,3g2,mj2', duration = '12.5', size = '1000000', bit_rate = '8000000' } = {}) => ({
  format: { format_name: format, duration, size, bit_rate },
  streams: [v && { codec_type: 'video', ...v }, a && { codec_type: 'audio', ...a }].filter(Boolean),
});
const V264 = { codec_name: 'h264', pix_fmt: 'yuv420p', profile: 'High', width: 1920, height: 1080 };
const AAAC = { codec_name: 'aac' };

test('the converter leaves alone what plays everywhere', () => {
  assert.deepEqual(playPlan(probe({ v: V264, a: AAAC }), { ext: 'mp4' }), { action: 'none' });
  assert.deepEqual(playPlan(probe({ v: V264 }), { ext: 'mov' }), { action: 'none' }, 'no sound');
  assert.deepEqual(playPlan(probe({ v: null, a: { codec_name: 'mp3' }, format: 'mp3' }), { ext: 'mp3' }), { action: 'none' });
  assert.deepEqual(playPlan(probe({ a: { codec_name: 'pcm_s24le' }, format: 'wav' }), { ext: 'wav' }), { action: 'none' });
  assert.deepEqual(playPlan(probe({ a: { codec_name: 'flac' }, format: 'flac' }), { ext: 'flac' }), { action: 'none' });
});

test('the same streams in another container are rewrapped, not re-encoded', () => {
  assert.deepEqual(playPlan(probe({ v: V264, a: AAAC, format: 'matroska,webm' }), { ext: 'mkv' }),
    { action: 'convert', video: 'copy', audio: 'copy', hdr: false });
  assert.deepEqual(playPlan(probe({ v: V264, a: { codec_name: 'pcm_s16le' } }), { ext: 'mov' }),
    { action: 'convert', video: 'copy', audio: 'encode', hdr: false }, 'camera PCM: only the sound is encoded');
  assert.equal(playPlan(probe({ v: V264, a: AAAC }), { ext: '3gp' }).action, 'convert', '.3gp');
});

test('what browsers cannot decode is encoded', () => {
  const enc = (v, a = AAAC, ext = 'mov', format) => playPlan(probe({ v, a, format }), { ext });
  assert.equal(enc({ ...V264, codec_name: 'prores', pix_fmt: 'yuv422p10le', profile: 'HQ' }).video, 'encode');
  assert.equal(enc({ ...V264, codec_name: 'hevc', pix_fmt: 'yuv420p10le', profile: 'Main 10' }).video, 'encode');
  assert.equal(enc({ ...V264, codec_name: 'av1' }, null, 'mp4').video, 'encode');
  assert.equal(enc({ ...V264, codec_name: 'wmv3' }, { codec_name: 'wmav2' }, 'wmv', 'asf').audio, 'encode');
  assert.equal(enc({ ...V264, pix_fmt: 'yuv422p10le', profile: 'High 4:2:2' }).video, 'encode', '10-bit 4:2:2 H.264');
  assert.equal(enc({ ...V264, width: 4096, height: 2160 }).video, 'encode', 'over 4K');
  assert.equal(playPlan(probe({ v: { ...V264, bit_rate: '120000000' }, a: AAAC }), { ext: 'mp4' }).video, 'encode', 'too heavy');
  // HDR is tone-mapped when it is encoded.
  assert.equal(enc({ ...V264, codec_name: 'hevc', color_transfer: 'arib-std-b67' }).hdr, true);
  assert.equal(enc({ ...V264, codec_name: 'hevc', color_transfer: 'bt709' }).hdr, false);
  // Audio a browser can't open becomes AAC.
  assert.deepEqual(playPlan(probe({ a: { codec_name: 'pcm_s16be' }, format: 'aiff' }), { ext: 'aiff' }),
    { action: 'convert', video: null, audio: 'encode', hdr: false });
  assert.equal(playPlan(probe({ a: { codec_name: 'alac' } }), { ext: 'm4a' }).audio, 'encode');
});

test('cover art is not a video', () => {
  const p = probe({ v: { codec_name: 'mjpeg', disposition: { attached_pic: 1 } }, a: { codec_name: 'mp3' }, format: 'mp3' });
  assert.deepEqual(playPlan(p, { ext: 'mp3' }), { action: 'none' });
});

test('ceilings refuse, with the reason', () => {
  assert.deepEqual(playPlan(probe({ v: V264, a: AAAC, duration: String(PLAY_COPY_MAX_SECONDS + 1) }), { ext: 'mkv' }),
    { action: 'refuse', reason: 'too_long' });
  assert.deepEqual(playPlan(probe({ v: V264, a: AAAC, size: String(PLAY_COPY_MAX_BYTES + 1) }), { ext: 'mkv' }),
    { action: 'refuse', reason: 'too_large' });
  assert.deepEqual(playPlan(probe({}), { ext: 'mov' }), { action: 'refuse', reason: 'no_streams' });
  assert.equal(probeDuration(probe({ duration: 'N/A' })), null);
});

test('the copy is 1080p at most, even-sided, never enlarged', () => {
  assert.deepEqual(copyDims(3840, 2160), { w: 1920, h: 1080 });
  assert.deepEqual(copyDims(2160, 3840), { w: 1080, h: 1920 }, 'portrait');
  assert.deepEqual(copyDims(1280, 720), { w: 1280, h: 720 });
  assert.deepEqual(copyDims(721, 405), { w: 722, h: 406 });
  assert.equal(copyDims(0, 10), null);
});

test('a finished copy writes what the card lacks', () => {
  const card = { id: 'v1', kind: 'video', src: `r2:${WS}/a.mov`, w: 360, h: 202 };
  const row = { state: 'done', storage_path: `${WS}/a.mov`, copy_path: `${WS}/previews/a.play.mp4`,
    poster_path: `${WS}/previews/a.poster.webp`, copy_w: 1080, copy_h: 1920, duration_sec: 31.0417 };
  assert.deepEqual(copyCardPatch(card, row), {
    playSrc: `r2:${WS}/previews/a.play.mp4`, poster: `r2:${WS}/previews/a.poster.webp`, duration: 31.042, h: 640,
  });
  // A card that already has its poster, length and a shape someone chose keeps them.
  const kept = { ...card, poster: 'r2:x.webp', duration: 30, h: 300 };
  assert.deepEqual(copyCardPatch(kept, row), { playSrc: `r2:${WS}/previews/a.play.mp4` });
  // Written once: the same copy again changes nothing.
  assert.deepEqual(copyCardPatch({ ...kept, playSrc: `r2:${WS}/previews/a.play.mp4` }, row), {});
  // Audio: the copy and the length, no poster, no shape.
  const audio = { id: 'a1', kind: 'audio', src: `r2:${WS}/s.aiff`, w: 380, h: 130 };
  assert.deepEqual(copyCardPatch(audio, { state: 'done', copy_path: `${WS}/previews/s.play.m4a`, duration_sec: 4 }),
    { playSrc: `r2:${WS}/previews/s.play.m4a`, duration: 4 });
});

test('only a finished copy of the card\'s own file is written', () => {
  const card = { id: 'v1', kind: 'video', src: `r2:${WS}/a.mov`, w: 360, h: 202 };
  for (const state of ['skip', 'failed', 'working', 'queued']) {
    assert.deepEqual(copyCardPatch(card, { state, storage_path: `${WS}/a.mov` }), {}, state);
  }
  assert.deepEqual(copyCardPatch(card, null), {});
  const done = { state: 'done', copy_path: `${WS}/previews/a.play.mp4` };
  assert.deepEqual(copyCardPatch(card, { ...done, storage_path: `${WS}/b.mov` }), {}, 'another file\'s row');
  assert.deepEqual(copyCardPatch(card, { ...done, copy_path: `${WS}/previews/b.play.mp4` }), {}, 'a copy not named after it');
  assert.deepEqual(copyCardPatch({ ...card, src: `r2:${WS}/b.mov` }, done), {}, 'the card moved on to another version');
});

test('a card plays its playSrc only when that is its own src\'s copy', () => {
  assert.equal(knownCopy(`r2:${WS}/a.mov`, `r2:${WS}/previews/a.play.mp4`), `r2:${WS}/previews/a.play.mp4`);
  assert.equal(knownCopy(`r2:${WS}/s.aiff`, `r2:${WS}/previews/s.play.m4a`), `r2:${WS}/previews/s.play.m4a`);
  assert.equal(knownCopy(`r2:${WS}/b.mov`, `r2:${WS}/previews/a.play.mp4`), null, 'a stale copy from another version');
  assert.equal(knownCopy(`r2:${WS}/a.mp4`, `r2:${WS}/previews/a.play.m4a`), null, 'the kind is the key\'s');
  assert.equal(knownCopy(`r2:${WS}/a.mov`, null), null);
  assert.equal(knownCopy('https://example.com/a.mov', `r2:${WS}/previews/a.play.mp4`), null);
});
