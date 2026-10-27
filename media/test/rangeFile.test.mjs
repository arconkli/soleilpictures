import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RangeFile, NeedRange, mergeRanges, covered } from '../src/rangeFile.js';

test('ranges merge when they touch or overlap, and coverage needs every byte', () => {
  assert.deepEqual(mergeRanges([[10, 20], [0, 5], [5, 8], [18, 30]]), [[0, 8], [10, 30]]);
  assert.equal(covered([[0, 8], [10, 30]], 2, 8), true);
  assert.equal(covered([[0, 8], [10, 30]], 7, 11), false);
  assert.equal(covered([], 0, 0), true);
});

test('a sparse copy reads what it holds and asks for what it doesn\'t, as absolute ranges from any slice', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rf-'));
  const path = join(dir, 'sparse.bin');
  const bytes = Buffer.alloc(1000); bytes.write('HEAD', 0); bytes.write('TAIL', 996);
  await writeFile(path, bytes);
  const rf = new RangeFile(path, [[0, 100], [900, 1000]], 1000);
  assert.equal(Buffer.from(await rf.slice(0, 4).arrayBuffer()).toString(), 'HEAD');
  assert.equal(Buffer.from(await rf.slice(-4).arrayBuffer()).toString(), 'TAIL');
  const mid = rf.slice(800, 1000).slice(50, 150);
  await assert.rejects(mid.arrayBuffer(), (e) => e instanceof NeedRange && e.ranges[0][0] === 850 && e.ranges[0][1] === 950);
  const chunks = []; for await (const c of rf.slice(900, 1000).stream()) chunks.push(Buffer.from(c));
  assert.equal(Buffer.concat(chunks).length, 100);
});
