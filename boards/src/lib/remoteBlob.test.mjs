import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { RemoteBlob } from './remoteBlob.js';
import { readZipDirectory, openEntry } from './zipRead.js';
import { storedZip } from './zipFixture.mjs';

// A server holding `bytes` that answers a Range as R2 does (206 and the
// piece), or ignores it (`ignoreRange`: 200 and the whole file).
function server(bytes, { ignoreRange = false, short = 0 } = {}) {
  const asked = [];
  const fetchImpl = async (url, { headers } = {}) => {
    const range = headers?.Range || null;
    asked.push(range);
    const m = /^bytes=(\d+)-(\d+)$/.exec(range || '');
    if (!m || ignoreRange) return new Response(bytes, { status: 200 });
    const piece = bytes.subarray(Number(m[1]), Number(m[2]) + 1 - short);
    return new Response(piece, { status: 206 });
  };
  return { fetchImpl, asked };
}

const bytesOf = (n) => Uint8Array.from({ length: n }, (_, i) => i % 251);

test('a slice is read with one Range GET of exactly its bytes', async () => {
  const data = bytesOf(100);
  const { fetchImpl, asked } = server(data);
  const blob = new RemoteBlob('https://r2.example/f.zip', data.length, { fetchImpl });
  assert.equal(blob.size, 100);
  const got = new Uint8Array(await blob.slice(10, 20).arrayBuffer());
  assert.deepEqual([...got], [...data.subarray(10, 20)]);
  assert.deepEqual(asked, ['bytes=10-19']);
});

test('slices nest and count back from the end, as a Blob does', async () => {
  const data = bytesOf(100);
  const { fetchImpl, asked } = server(data);
  const blob = new RemoteBlob('u', 100, { fetchImpl });
  assert.equal(blob.slice(5).slice(2, 4).size, 2);
  assert.deepEqual([...new Uint8Array(await blob.slice(5).slice(2, 4).arrayBuffer())], [7, 8]);
  assert.deepEqual([...new Uint8Array(await blob.slice(-4).arrayBuffer())], [...data.subarray(96)]);
  assert.equal(blob.slice(90, 500).size, 10);
  assert.equal(blob.slice(50, 10).size, 0);
  assert.equal((await blob.slice(50, 10).arrayBuffer()).byteLength, 0);
  assert.deepEqual(asked, ['bytes=7-8', 'bytes=96-99']);
});

test('a server that answers a piece with the whole file is refused; the whole file may be', async () => {
  const data = bytesOf(64);
  const { fetchImpl } = server(data, { ignoreRange: true });
  const blob = new RemoteBlob('u', 64, { fetchImpl });
  await assert.rejects(() => blob.slice(0, 8).arrayBuffer(), /range 200/);
  assert.equal((await blob.arrayBuffer()).byteLength, 64);
});

test('a piece shorter than asked is an error, not a short read', async () => {
  const data = bytesOf(64);
  const { fetchImpl } = server(data, { short: 3 });
  await assert.rejects(() => new RemoteBlob('u', 64, { fetchImpl }).slice(0, 32).arrayBuffer(), /29 of 32/);
});

test('blob() and stream() read the same piece, and a stream feeds the inflater', async () => {
  const text = 'Dock at 06:10. Long lens. '.repeat(40);
  const packed = zlib.deflateRawSync(Buffer.from(text));
  const data = new Uint8Array([1, 2, 3, ...packed, 9, 9]);
  const { fetchImpl, asked } = server(data);
  const blob = new RemoteBlob('u', data.length, { fetchImpl });
  const piece = blob.slice(3, 3 + packed.length, 'application/octet-stream');
  const b = await piece.blob();
  assert.ok(b instanceof Blob);
  assert.equal(b.size, packed.length);
  assert.equal(b.type, 'application/octet-stream');
  const inflated = await new Response(piece.stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
  assert.equal(inflated, text);
  assert.deepEqual(asked, [`bytes=3-${2 + packed.length}`, `bytes=3-${2 + packed.length}`]);
});

test('the zip reader walks a zip it holds none of', async () => {
  const zip = storedZip([
    { path: 'Location scouts/Dock/a.jpg', bytes: 'jpeg bytes' },
    { path: 'Location scouts/b.png', bytes: 'png bytes' },
    { path: 'Location scouts/notes.txt', bytes: 'Dock at 06:10' },
  ], 'Location scouts.zip');
  const data = new Uint8Array(await zip.arrayBuffer());
  const { fetchImpl, asked } = server(data);
  const remote = new RemoteBlob('u', data.length, { fetchImpl });
  const { entries } = await readZipDirectory(remote, { locked: true });
  assert.deepEqual(entries.map((e) => e.path), ['Location scouts/Dock/a.jpg', 'Location scouts/b.png', 'Location scouts/notes.txt']);
  // The tail, then the directory: two reads, never the whole zip.
  assert.equal(asked.length, 2);
  const notes = await openEntry(remote, entries[2]);
  assert.equal(await (await notes.blob()).text(), 'Dock at 06:10');
});
