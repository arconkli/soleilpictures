import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readHead, decodeText, looksBinary } from './fileHead.js';

const enc = (s) => new TextEncoder().encode(s);
// A fetch that ignores Range and streams the whole body in 1 KB chunks,
// counting what it was asked for and how much was pulled.
function fakeFetch(body, { status = 200 } = {}) {
  const seen = { range: null, pulled: 0, cancelled: false };
  const impl = async (_url, init) => {
    seen.range = init?.headers?.Range ?? null;
    let at = 0;
    const stream = new ReadableStream({
      pull(c) {
        if (at >= body.length) { c.close(); return; }
        const chunk = body.subarray(at, at + 1024); at += chunk.length; seen.pulled = at; c.enqueue(chunk);
      },
      cancel() { seen.cancelled = true; },
    });
    return new Response(stream, { status });
  };
  return { impl, seen };
}

test('a head stops at its ceiling even when the server sends everything', async () => {
  const body = new Uint8Array(100 * 1024).fill(97);
  const { impl, seen } = fakeFetch(body);
  const { bytes, complete } = await readHead('u', 4096, { fetchImpl: impl });
  assert.equal(bytes.length, 4096);
  assert.equal(complete, false);
  assert.equal(seen.range, 'bytes=0-4095');
  assert.ok(seen.pulled <= 4096 + 1024, `pulled ${seen.pulled}`);
  assert.equal(seen.cancelled, true);
});

test('a small file is read whole, with no Range, and called complete', async () => {
  const { impl, seen } = fakeFetch(enc('hello\n'));
  const { bytes, complete } = await readHead('u', 4096, { fetchImpl: impl, size: 6 });
  assert.equal(new TextDecoder().decode(bytes), 'hello\n');
  assert.equal(complete, true);
  assert.equal(seen.range, null);
});

test('an empty file is complete without a request; a failed one throws', async () => {
  let asked = false;
  const r = await readHead('u', 10, { size: 0, fetchImpl: async () => { asked = true; } });
  assert.deepEqual([r.bytes.length, r.complete, asked], [0, true, false]);
  await assert.rejects(readHead('u', 10, { fetchImpl: fakeFetch(enc('x'), { status: 403 }).impl }));
});

test('text decodes with its BOM, a cut character is dropped, Windows-1252 still reads', () => {
  assert.equal(decodeText(Uint8Array.from([0xef, 0xbb, 0xbf, ...enc('café')])), 'café');
  assert.equal(decodeText(Uint8Array.from([0xff, 0xfe, 0x68, 0, 0x69, 0])), 'hi');
  assert.equal(decodeText(Uint8Array.from([...enc('ab'), 0xc3]), { complete: false }), 'ab');
  assert.equal(decodeText(Uint8Array.from([0x63, 0x61, 0x66, 0xe9])), 'café');
});

test('binary is not text: a NUL, or one byte in ten a control character', () => {
  assert.equal(looksBinary(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x00])), true);
  assert.equal(looksBinary(enc('plain\ttext\r\n')), false);
  assert.equal(looksBinary(Uint8Array.from([1, 2, 3, 4, 5, 97, 98, 99, 100, 101])), true);
  assert.equal(decodeText(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])), null);
});
