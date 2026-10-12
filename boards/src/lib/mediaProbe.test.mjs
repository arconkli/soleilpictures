// lib/mediaProbe.js against real files (tests/fixtures/media, made by
// scripts/make-media-fixtures.sh) and synthetic edge cases: 64-bit box sizes,
// moov at the end, not-a-container, and a server that ignores Range.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { probeMedia, mediaFacts, bytesSource, urlSource, rateFromStts } from './mediaProbe.js';

const fixture = (name) => new Uint8Array(readFileSync(new URL(`../../tests/fixtures/media/${name}`, import.meta.url)));

// A source that counts what it was asked for.
function counting(u8) {
  const src = bytesSource(u8);
  const reads = [];
  return { size: src.size, reads, read: (off, len) => { reads.push([off, len]); return src.read(off, len); } };
}

test('a faststart H.264 + AAC MP4', async () => {
  const p = await probeMedia(bytesSource(fixture('faststart-24.mp4')));
  assert.equal(p.container, 'mp4');
  assert.deepEqual([p.w, p.h, p.rot], [64, 36, 0]);
  assert.deepEqual(p.fps, [24, 1]);
  assert.equal(p.frames, 48);
  assert.equal(p.vfr, false);
  assert.equal(p.dur, 2);
  assert.equal(p.codec, 'avc1');
  assert.equal(p.prof, 'High');
  assert.deepEqual(p.audio, { codec: 'mp4a', rate: 48000, ch: 2 });
  assert.equal(p.tc, null);
});

test('moov at the end: found by jumping over mdat, without reading it', async () => {
  const u8 = fixture('moovend-2398.mp4');
  const src = counting(u8);
  const p = await probeMedia(src);
  assert.deepEqual(p.fps, [24000, 1001]);
  assert.equal(p.frames, 24);
  assert.equal(p.audio, null);
  // The 64 KB head, the box header past it, and moov itself — a handful of reads.
  assert.ok(src.reads.length <= 4, `reads: ${JSON.stringify(src.reads)}`);
});

test('29.97 drop-frame ProRes MOV: codec, PCM audio, and its start timecode', async () => {
  const p = await probeMedia(bytesSource(fixture('df2997-tc.mov')));
  assert.equal(p.container, 'mov');
  assert.equal(p.codec, 'apch');
  assert.deepEqual(p.fps, [30000, 1001]);
  assert.equal(p.frames, 12);
  assert.deepEqual(p.tc, { start: '01:00:00;00', df: true, frame: 107892 });
  assert.equal(p.audio.codec, 'sowt');
  assert.equal(p.audio.rate, 48000);
  assert.equal(p.audio.ch, 1);
});

test('variable frame rate is flagged, with the mean rate', async () => {
  const p = await probeMedia(bytesSource(fixture('vfr.mp4')));
  assert.equal(p.vfr, true);
  assert.equal(p.frames, 33);
  assert.ok(Math.abs(p.fps[0] / p.fps[1] - 55 / 3) < 0.01);
});

test('VP9 in MP4', async () => {
  const p = await probeMedia(bytesSource(fixture('frames-vp9.mp4')));
  assert.equal(p.codec, 'vp09');
  assert.deepEqual(p.fps, [24, 1]);
  assert.equal(p.frames, 48);
});

test('the stored facts are compact and hold no storage keys', async () => {
  const m = mediaFacts(await probeMedia(bytesSource(fixture('df2997-tc.mov'))));
  assert.equal(m.probed, 1);
  assert.deepEqual(m.fps, [30000, 1001]);
  assert.deepEqual(m.tc, { start: '01:00:00;00', df: 1, frame: 107892 });
  assert.ok(!JSON.stringify(m).includes('r2:'));
  assert.equal(mediaFacts(null), null);
});

test('one stray frame is still a constant rate; a real mix is variable', () => {
  assert.deepEqual(rateFromStts([[47, 1000], [1, 1001]], 24000), { fps: [24, 1], frames: 48, vfr: false });
  const v = rateFromStts([[20, 1], [13, 3]], 30);
  assert.equal(v.vfr, true);
  assert.equal(rateFromStts([], 24000), null);
});

test('not a container: null, quickly', async () => {
  const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 1, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(await probeMedia(bytesSource(webm)), null);
  assert.equal(await probeMedia(bytesSource(new Uint8Array(0))), null);
  // A truncated file — the moov it points at isn't there.
  const cut = fixture('moovend-2398.mp4').subarray(0, 600);
  assert.equal(await probeMedia(bytesSource(cut)), null);
});

test('64-bit box sizes (largesize) at the top level', async () => {
  // Re-wrap the faststart file's boxes with size=1 + a 64-bit largesize header.
  const src = fixture('faststart-24.mp4');
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const parts = [];
  let off = 0;
  while (off + 8 <= src.byteLength) {
    const size = dv.getUint32(off);
    const type = src.subarray(off + 4, off + 8);
    const body = src.subarray(off + 8, off + size);
    const hdr = new Uint8Array(16);
    const hv = new DataView(hdr.buffer);
    hv.setUint32(0, 1);
    hdr.set(type, 4);
    hv.setUint32(8, 0);
    hv.setUint32(12, body.byteLength + 16);
    parts.push(hdr, body);
    off += size;
  }
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const big = new Uint8Array(total);
  let p = 0;
  for (const part of parts) { big.set(part, p); p += part.byteLength; }
  // stco chunk offsets now point 8 bytes early per preceding box; nothing here reads samples.
  const r = await probeMedia(bytesSource(big));
  assert.deepEqual(r.fps, [24, 1]);
  assert.equal(r.frames, 48);
});

test('reading a URL: Range requests, and only the asked-for bytes when the server sends everything', async () => {
  const u8 = fixture('moovend-2398.mp4');
  const calls = [];
  const fetch206 = async (url, init) => {
    const m = /bytes=(\d+)-(\d+)/.exec(init.headers.Range);
    calls.push(init);
    const body = u8.subarray(Number(m[1]), Number(m[2]) + 1);
    return { ok: true, status: 206, arrayBuffer: async () => body.slice().buffer };
  };
  const p = await probeMedia(urlSource('https://r2.example/v.mp4', { fetchImpl: fetch206, size: u8.byteLength }));
  assert.deepEqual(p.fps, [24000, 1001]);
  assert.ok(calls.every((c) => c.cache === 'no-store'));

  // A server that ignores Range: streamed, and cancelled once enough arrived.
  let cancelled = 0, pulled = 0;
  const fetch200 = async () => {
    const CHUNK = 1024;
    let at = 0;
    return {
      ok: true, status: 200,
      body: { getReader: () => ({
        read: async () => {
          if (at >= u8.byteLength) return { done: true };
          const value = u8.subarray(at, at + CHUNK); at += CHUNK; pulled += value.byteLength;
          return { done: false, value };
        },
        cancel: async () => { cancelled++; },
      }) },
    };
  };
  const src = urlSource('https://r2.example/v.mp4', { fetchImpl: fetch200, size: u8.byteLength });
  const head = await src.read(0, 16);
  assert.equal(head.byteLength, 16);
  assert.equal(cancelled, 1);
  assert.ok(pulled <= 1024);
});
