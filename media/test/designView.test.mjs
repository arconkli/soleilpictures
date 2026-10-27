import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { designPicture, sourceSize } from '../src/view.js';
import { Refused } from '../src/refused.js';
import { Refused as ZipRefused } from '../src/zipJob.js';

const chunk = (type, data) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
};
const png = (w, h) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', randomBytes(w * h + 10)), chunk('IEND', Buffer.alloc(0))]);
};

// The finder runs as itself here (tests aren't root, so nothing is isolated).
async function picture(name, bytes, opts) {
  const work = await mkdtemp(join(tmpdir(), 'designview-'));
  const src = join(work, name);
  await writeFile(src, bytes);
  return { work, found: await designPicture(src, name.slice(name.lastIndexOf('.') + 1), work, opts) };
}

test('a design file\'s picture comes back named for the decoder that reads it', async () => {
  const big = png(6, 6);
  const { work, found } = await picture('source.afdesign', Buffer.concat([randomBytes(100), big, randomBytes(100)]));
  assert.deepEqual(found, { path: join(work, 'picture.png'), loader: 'pngload', picture: 'png' });
  assert.deepEqual(await readFile(found.path), big);
});

test('an Illustrator file that is a PDF asks for its first page; one with no picture is refused no_picture', async () => {
  assert.deepEqual((await picture('source.ai', Buffer.from('%PDF-1.7\n1 0 obj\n'))).found, { pdf: true });
  await assert.rejects(picture('source.eps', Buffer.from('%!PS-Adobe-3.0 EPSF-3.0\nshowpage\n')),
    (e) => e instanceof Refused && e.reason === 'no_picture');
});

test('a finder that names any other file, or says nothing, is a failure, not a picture', async () => {
  for (const said of ['{"made":{"file":"../../etc/passwd"}}', '{"made":{"file":"picture.svg"}}', 'oops', '']) {
    await assert.rejects(picture('source.indd', Buffer.from('x'), { runChild: async () => Buffer.from(`${said}\n`) }),
      (e) => !(e instanceof Refused), said);
  }
});

test('a zip is read at the size its source answers a HEAD with', async () => {
  const fake = (status, headers) => async (_url, init) => {
    assert.equal(init.method, 'HEAD');
    return new Response(null, { status, headers });
  };
  assert.equal(await sourceSize('https://w.example/s', fake(200, { 'content-length': '31473971' })), 31473971);
  await assert.rejects(sourceSize('https://w.example/s', fake(404, {})), /source 404/);
  await assert.rejects(sourceSize('https://w.example/s', fake(200, {})), (e) => e instanceof Refused);
  assert.equal(ZipRefused, Refused, 'one refusal, whichever piece refuses');
});
