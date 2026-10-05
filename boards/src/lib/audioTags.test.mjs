// Tag parsers are byte-walkers, and byte-walkers fail silently — a wrong
// offset yields plausible-looking garbage rather than an error. So the fixtures
// here are BUILT to spec in the test, and the assertions check that the exact
// bytes come back out.
//
// The nasty cases are the ones that differ between versions: ID3v2.2's 3-char
// frame ids and 3-byte sizes, v2.4's syncsafe frame sizes vs v2.3's plain
// integers, UTF-16 descriptions needing a two-byte terminator, and MP4's `meta`
// box carrying a version/flags field its siblings do not.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readCoverFromBuffer, readId3Picture, readFlacPicture, readMp4Cover,
} from './audioTags.js';

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 9, 9]);

const bytes = (...parts) => {
  const total = parts.reduce((n, p) => n + (typeof p === 'string' ? p.length : p.length), 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    if (typeof p === 'string') { for (let i = 0; i < p.length; i++) out[o++] = p.charCodeAt(i); }
    else { out.set(p, o); o += p.length; }
  }
  return out;
};
const u32 = (n) => Uint8Array.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const u24 = (n) => Uint8Array.from([(n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const ss = (n) => Uint8Array.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);

// ── ID3 ─────────────────────────────────────────────────────────────────────

function id3v23(pic = JPEG, { mime = 'image/jpeg', picType = 3, desc = 'cover' } = {}) {
  const body = bytes(Uint8Array.of(0), mime, Uint8Array.of(0), Uint8Array.of(picType), desc, Uint8Array.of(0), pic);
  const frame = bytes('APIC', u32(body.length), Uint8Array.of(0, 0), body);
  return bytes('ID3', Uint8Array.of(3, 0, 0), ss(frame.length), frame);
}

test('ID3v2.3 APIC', () => {
  const got = readId3Picture(id3v23());
  assert.deepEqual(Array.from(got.bytes), Array.from(JPEG));
  assert.equal(got.mime, 'image/jpeg');
  assert.equal(got.ext, 'jpg');
});

test('ID3v2.4 frame sizes are SYNCSAFE, not plain integers', () => {
  // 0x80 in a plain size is 128; syncsafe it is 0. Getting this backwards
  // walks straight past the frame and finds nothing.
  const body = bytes(Uint8Array.of(0), 'image/png', Uint8Array.of(0), Uint8Array.of(3), 'c', Uint8Array.of(0), PNG);
  const frame = bytes('APIC', ss(body.length), Uint8Array.of(0, 0), body);
  const tag = bytes('ID3', Uint8Array.of(4, 0, 0), ss(frame.length), frame);
  const got = readId3Picture(tag);
  assert.equal(got.mime, 'image/png');
  assert.equal(got.ext, 'png');
  assert.deepEqual(Array.from(got.bytes), Array.from(PNG));
});

test('ID3v2.2 uses 3-character ids, 3-byte sizes and a format CODE', () => {
  const body = bytes(Uint8Array.of(0), 'JPG', Uint8Array.of(3), 'c', Uint8Array.of(0), JPEG);
  const frame = bytes('PIC', u24(body.length), body);
  const tag = bytes('ID3', Uint8Array.of(2, 0, 0), ss(frame.length), frame);
  const got = readId3Picture(tag);
  assert.equal(got.mime, 'image/jpeg');
  assert.deepEqual(Array.from(got.bytes), Array.from(JPEG));
});

test('a UTF-16 description needs a TWO-byte terminator', () => {
  // With a one-byte scan the description's trailing 0x00 ends it early and the
  // image comes back with two junk bytes glued to the front.
  const desc = Uint8Array.of(0xff, 0xfe, 0x63, 0x00, 0x00, 0x00); // BOM + "c" + terminator
  const body = bytes(Uint8Array.of(1), 'image/jpeg', Uint8Array.of(0), Uint8Array.of(3), desc, JPEG);
  const frame = bytes('APIC', u32(body.length), Uint8Array.of(0, 0), body);
  const tag = bytes('ID3', Uint8Array.of(3, 0, 0), ss(frame.length), frame);
  assert.deepEqual(Array.from(readId3Picture(tag).bytes), Array.from(JPEG));
});

test('the FRONT COVER wins over an earlier picture of another type', () => {
  const mk = (pic, type) => {
    const body = bytes(Uint8Array.of(0), 'image/jpeg', Uint8Array.of(0), Uint8Array.of(type), 'd', Uint8Array.of(0), pic);
    return bytes('APIC', u32(body.length), Uint8Array.of(0, 0), body);
  };
  const back = mk(PNG, 4);      // back cover, first
  const front = mk(JPEG, 3);    // front cover, second
  const frames = bytes(back, front);
  const tag = bytes('ID3', Uint8Array.of(3, 0, 0), ss(frames.length), frames);
  assert.deepEqual(Array.from(readId3Picture(tag).bytes), Array.from(JPEG));
});

test('an APIC frame preceded by other frames is still found', () => {
  // encoding byte + 4 characters = 5 bytes of body. Declaring 6 would seek
  // one byte past the frame and land mid-APIC.
  const title = bytes('TIT2', u32(5), Uint8Array.of(0, 0), Uint8Array.of(0), 'Kick');
  const apic = id3v23().slice(10);
  const frames = bytes(title, apic);
  const tag = bytes('ID3', Uint8Array.of(3, 0, 0), ss(frames.length), frames);
  assert.ok(readId3Picture(tag));
});

test('a tag with no picture, or no tag at all, returns null', () => {
  const title = bytes('TIT2', u32(5), Uint8Array.of(0, 0), Uint8Array.of(0), 'Kick');
  assert.equal(readId3Picture(bytes('ID3', Uint8Array.of(3, 0, 0), ss(title.length), title)), null);
  assert.equal(readId3Picture(bytes('RIFF', u32(0))), null);
  assert.equal(readId3Picture(new Uint8Array(0)), null);
  assert.equal(readCoverFromBuffer(null), null);
});

test('a truncated tag does not throw or return garbage', () => {
  const full = id3v23();
  for (const cut of [11, 20, 30, full.length - 3]) {
    assert.doesNotThrow(() => readId3Picture(full.slice(0, cut)));
  }
});

// ── FLAC ────────────────────────────────────────────────────────────────────

function flacWith(pic, mime = 'image/jpeg', picType = 3, last = true) {
  const block = bytes(u32(picType), u32(mime.length), mime, u32(0),
                      u32(0), u32(0), u32(0), u32(0), u32(pic.length), pic);
  const hdr = Uint8Array.of((last ? 0x80 : 0) | 6);
  return bytes('fLaC', hdr, u24(block.length), block);
}

test('FLAC PICTURE block', () => {
  const got = readFlacPicture(flacWith(JPEG));
  assert.deepEqual(Array.from(got.bytes), Array.from(JPEG));
  assert.equal(got.mime, 'image/jpeg');
});

test('FLAC: a picture after a STREAMINFO block is still found', () => {
  const streaminfo = bytes(Uint8Array.of(0), u24(34), new Uint8Array(34));
  const picBlock = flacWith(PNG, 'image/png').slice(4);
  const got = readFlacPicture(bytes('fLaC', streaminfo, picBlock));
  assert.equal(got.mime, 'image/png');
  assert.deepEqual(Array.from(got.bytes), Array.from(PNG));
});

test('FLAC with no picture block returns null', () => {
  const streaminfo = bytes(Uint8Array.of(0x80), u24(34), new Uint8Array(34));
  assert.equal(readFlacPicture(bytes('fLaC', streaminfo)), null);
  assert.equal(readFlacPicture(bytes('nope', new Uint8Array(20))), null);
});

// ── MP4 ─────────────────────────────────────────────────────────────────────

const box = (type, payload) => bytes(u32(payload.length + 8), type, payload);

function mp4With(pic, flags = 13) {
  const data = box('data', bytes(u32(flags), u32(0), pic));
  const covr = box('covr', data);
  const ilst = box('ilst', covr);
  // `meta` carries a 4-byte version/flags field BEFORE its children — the one
  // box in this chain that does. Forgetting it mis-seeks by exactly 4 bytes.
  const meta = box('meta', bytes(u32(0), ilst));
  const udta = box('udta', meta);
  return box('moov', udta);
}

test('MP4 covr, through the meta box version/flags quirk', () => {
  const got = readMp4Cover(mp4With(JPEG, 13));
  assert.deepEqual(Array.from(got.bytes), Array.from(JPEG));
  assert.equal(got.mime, 'image/jpeg');
  assert.equal(readMp4Cover(mp4With(PNG, 14)).mime, 'image/png');
});

test('MP4: an unknown data flag falls back to sniffing the bytes', () => {
  assert.equal(readMp4Cover(mp4With(PNG, 0)).mime, 'image/png');
  assert.equal(readMp4Cover(mp4With(JPEG, 0)).mime, 'image/jpeg');
  // Not an image at all → refused rather than uploaded as one.
  assert.equal(readMp4Cover(mp4With(Uint8Array.of(1, 2, 3, 4), 0)), null);
});

test('MP4 with moov but no cover returns null', () => {
  const moov = box('moov', box('udta', box('meta', bytes(u32(0), box('ilst', new Uint8Array(0))))));
  assert.equal(readMp4Cover(moov), null);
  assert.equal(readMp4Cover(box('ftyp', bytes('M4A '))), null);
});

test('a box claiming a size past the buffer end is refused, not read', () => {
  // The obvious way to crash a box walker.
  const bad = bytes(u32(0xffffff), 'moov', new Uint8Array(8));
  assert.doesNotThrow(() => readMp4Cover(bad));
  assert.equal(readMp4Cover(bad), null);
});

test('readCoverFromBuffer dispatches to whichever container it is', () => {
  assert.equal(readCoverFromBuffer(id3v23()).mime, 'image/jpeg');
  assert.equal(readCoverFromBuffer(flacWith(PNG, 'image/png')).mime, 'image/png');
  assert.equal(readCoverFromBuffer(mp4With(JPEG)).mime, 'image/jpeg');
  assert.equal(readCoverFromBuffer(bytes('RIFF', new Uint8Array(40))), null);
});
