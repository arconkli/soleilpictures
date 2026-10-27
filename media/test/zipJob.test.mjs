import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { deflateSync, crc32 } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZipInRounds, Refused } from '../src/zipJob.js';
import { run } from '../src/ffmpeg.js';
import { storedZip } from '../../boards/src/lib/zipFixture.mjs';

const ZIP_MAIN = fileURLToPath(new URL('../src/zipMain.js', import.meta.url));

// A real 4x4 grey PNG.
function tinyPng() {
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0); head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(4, 0); ihdr.writeUInt32BE(4, 4); ihdr[8] = 8;
  const rows = Buffer.concat(Array.from({ length: 4 }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(4, 0x80)])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

// Serves `body` at any path, with Range (206) unless `ranges` is false, and counts the bytes it sends.
async function serve(body, { ranges = true } = {}) {
  const served = { bytes: 0, requests: 0 };
  const server = createServer((req, res) => {
    served.requests++;
    const m = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || '');
    if (!m || !ranges) {
      served.bytes += body.length;
      res.writeHead(200, { 'content-length': body.length });
      res.end(body);
      return;
    }
    const s = Number(m[1]); const e = Math.min(Number(m[2]), body.length - 1);
    const part = body.subarray(s, e + 1);
    served.bytes += part.length;
    res.writeHead(206, { 'content-range': `bytes ${s}-${e}/${body.length}`, 'content-length': part.length });
    res.end(part);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/z`, served, close: () => server.close() };
}

const bytesOfZip = async (entries) => Buffer.from(await storedZip(entries).arrayBuffer());
// Tests aren't root, so the child runs without `isolate`.
const runLocal = (argv) => run(process.execPath, [ZIP_MAIN, ...argv], { timeoutMs: 60_000, maxBytes: 1024 * 1024 });

test('a 20 MB zip gives up its picture for under a megabyte, in at most three rounds', async () => {
  const png = tinyPng();
  const body = await bytesOfZip([
    { path: 'video/timelapse.mp4', bytes: randomBytes(20 * 1024 * 1024) },
    { path: 'QuickLook/Thumbnail.png', bytes: png },
  ]);
  const srv = await serve(body);
  const work = await mkdtemp(join(tmpdir(), 'zipjob-'));
  let rounds = 0;
  try {
    const { made } = await readZipInRounds({
      url: srv.url, size: body.length, mode: 'design', ext: 'procreate', work,
      runChild: (argv) => { rounds++; return runLocal(argv); },
    });
    assert.equal(made.entry, 'QuickLook/Thumbnail.png');
    assert.equal(made.via, 'zip');
    assert.deepEqual(await readFile(made.path), png);
    assert.ok(srv.served.bytes < 1024 * 1024, `served ${srv.served.bytes}`);
    assert.ok(rounds <= 3, `${rounds} rounds`);
  } finally {
    srv.close();
  }
});

test('a server that answers 200 to a Range is refused, not trusted', async () => {
  const body = await bytesOfZip([{ path: 'video/a.mp4', bytes: randomBytes(9 * 1024 * 1024) }]);
  const srv = await serve(body, { ranges: false });
  const work = await mkdtemp(join(tmpdir(), 'zipjob-'));
  try {
    await assert.rejects(
      readZipInRounds({ url: srv.url, size: body.length, mode: 'design', ext: 'procreate', work, runChild: runLocal }),
      (e) => e instanceof Refused && e.reason === 'error',
    );
  } finally {
    srv.close();
  }
});

test('a zip with no picture in it is refused no_picture', async () => {
  const body = await bytesOfZip([{ path: 'Data/doc.json', bytes: '{}' }]);
  const srv = await serve(body);
  const work = await mkdtemp(join(tmpdir(), 'zipjob-'));
  try {
    await assert.rejects(
      readZipInRounds({ url: srv.url, size: body.length, mode: 'design', ext: 'sketch', work, runChild: runLocal }),
      (e) => e instanceof Refused && e.reason === 'no_picture',
    );
  } finally {
    srv.close();
  }
});

test('a child that asks for bytes outside the file, or says nothing, is refused', async () => {
  const body = await bytesOfZip([{ path: 'a.txt', bytes: 'hi' }]);
  const srv = await serve(body);
  try {
    for (const said of [{ need: [[0, body.length + 1]] }, { need: [[5, 5]] }, { need: [[0.5, 3]] }, {}]) {
      const work = await mkdtemp(join(tmpdir(), 'zipjob-'));
      await assert.rejects(
        readZipInRounds({
          url: srv.url, size: body.length, mode: 'design', ext: 'sketch', work,
          runChild: async () => Buffer.from(`${JSON.stringify(said)}\n`),
        }),
        (e) => e instanceof Refused && e.reason === 'error',
        JSON.stringify(said),
      );
    }
    const work = await mkdtemp(join(tmpdir(), 'zipjob-'));
    await assert.rejects(
      readZipInRounds({
        url: srv.url, size: body.length, mode: 'design', ext: 'sketch', work,
        runChild: async () => Buffer.from('{"made":{"file":"../../etc/passwd","entry":"x"}}\n'),
      }),
      (e) => e instanceof Refused,
      'a file name outside the folder',
    );
  } finally {
    srv.close();
  }
});

test('a child that prints more than its cap is killed', async () => {
  await assert.rejects(
    run(process.execPath, ['-e', 'process.stdout.write("x".repeat(3e6)); setTimeout(() => {}, 30000)'], { timeoutMs: 20_000, maxBytes: 1024 }),
    /output_too_large/,
  );
});

test('a zip\'s contact sheet takes out only the pictures it shows, by byte ranges', async () => {
  const png = tinyPng();
  const body = await bytesOfZip([
    { path: 'Location scouts/take 1.mov', bytes: randomBytes(20 * 1024 * 1024) },
    { path: 'Location scouts/Dock/a.png', bytes: png },
    { path: 'Location scouts/b.png', bytes: png },
    { path: 'Location scouts/notes.txt', bytes: 'Dock at 06:10' },
    { path: '__MACOSX/Location scouts/._b.png', bytes: 'litter' },
  ]);
  const srv = await serve(body);
  const work = await mkdtemp(join(tmpdir(), 'zipjob-'));
  try {
    const { made } = await readZipInRounds({ url: srv.url, size: body.length, mode: 'sheet', ext: 'zip', work, runChild: runLocal });
    assert.deepEqual(made.tiles.map((t) => [t.kind, t.name, t.path]), [
      ['folder', 'Dock', '0'], ['photo', 'b.png', '1'], ['file', 'notes.txt', '2'], ['file', 'take 1.mov', '3'],
    ]);
    assert.equal(made.tiles[0].count, 1);
    assert.deepEqual(made.summary, { files: 4, folders: 2, bytes: 20 * 1024 * 1024 + png.length * 2 + 13 });
    assert.deepEqual(made.files.map((f) => f.i), [1]);
    assert.deepEqual(await readFile(made.files[0].path), png);
    assert.ok(srv.served.bytes < 1024 * 1024, `served ${srv.served.bytes}: never the film`);
  } finally {
    srv.close();
  }
});

test('the contact sheet holds the zip reader to what it may say', async () => {
  const body = await bytesOfZip([{ path: 'a.png', bytes: tinyPng() }]);
  const srv = await serve(body);
  const said = (made) => async () => Buffer.from(`${JSON.stringify({ made })}\n`);
  const sheet = async (made) => readZipInRounds({ url: srv.url, size: body.length, mode: 'sheet', ext: 'zip',
    work: await mkdtemp(join(tmpdir(), 'zipjob-')), runChild: said(made) });
  const photo = { kind: 'photo', name: 'a.png', ext: 'png', size: 10 };
  try {
    for (const [made, why] of [
      [{ tiles: [photo], files: [{ i: 0, file: '../t0.png' }] }, 'a file outside its folder'],
      [{ tiles: [photo], files: [{ i: 0, file: 't0.svg' }] }, 'a file no picture is'],
      [{ tiles: [photo], files: [{ i: 0, file: 't0.jpg' }] }, 'a file its tile is not'],
      [{ tiles: [{ ...photo, kind: 'file' }], files: [{ i: 0, file: 't0.png' }] }, 'a file of a tile that is no picture'],
      [{ tiles: [photo], files: [{ i: 0, file: 't0.png' }, { i: 0, file: 't0.png' }] }, 'the same file twice'],
      [{ tiles: [{ ...photo, kind: 'script' }], files: [] }, 'a tile of no kind'],
      [{ tiles: Array.from({ length: 13 }, () => photo), files: [] }, 'more tiles than a sheet holds'],
      [{ tiles: [], files: [] }, 'no tiles'],
    ]) {
      await assert.rejects(sheet(made), (e) => e instanceof Refused && e.reason === 'error', why);
    }
    const { made } = await sheet({ tiles: [{ ...photo, name: 'x'.repeat(5000), path: '/etc/passwd' }], summary: { files: -1, folders: 1.5, bytes: 7 }, files: [] });
    assert.equal(made.tiles[0].name.length, 200, 'names cut short');
    assert.equal(made.tiles[0].path, '0', 'a tile is named by its place');
    assert.deepEqual(made.summary, { files: 0, folders: 0, bytes: 7 }, 'whole numbers only');
  } finally {
    srv.close();
  }
});
