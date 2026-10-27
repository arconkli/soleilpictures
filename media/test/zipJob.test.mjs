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
