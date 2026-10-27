// The zip reader's own process (zipJob.js), run as the unprivileged user with
// no network, a bare environment and a capped heap. It holds a sparse copy of
// a zip (a file of the zip's size with only some of its bytes in it) and
// can't fetch anything: when it needs bytes it holds no copy of, it says which
// and exits, and the root process fetches them and runs it again.
//
//   node zipMain.js <mode> <ext> <sparse> <have> <size> <outDir>
//
// <have> is a JSON file of the ranges ([start, end)) the copy holds. Prints
// ONE line of JSON:
//   {"need":[[start,end],…]}                      fetch these and ask again
//   {"made":{"file":"picture.png","entry":"…"}}   the picture, in <outDir>
//   {"refused":"no_picture"|"not_zip"|"too_big"|"crc"|"encrypted"|…}
// Anything else is a crash.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RangeFile, NeedRange, covered } from './rangeFile.js';
import { designEntry, entryWindow, ZIP_CD_MAX_BYTES } from './zipPick.js';
import { zipDirectoryBounds, readZipDirectory, openEntry, ZipReadError } from '../../boards/src/lib/zipRead.js';

const [mode, ext, sparsePath, havePath, size, outDir] = process.argv.slice(2);
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

async function design(rf, have) {
  const { cdStart, cdEnd } = await zipDirectoryBounds(rf);          // may throw NeedRange (tail)
  if (cdEnd - cdStart > ZIP_CD_MAX_BYTES) return out({ refused: 'too_big' });
  if (!covered(have, cdStart, cdEnd)) return out({ need: [[cdStart, cdEnd]] });
  const { entries } = await readZipDirectory(rf);
  const entry = designEntry(entries, ext);
  if (!entry) return out({ refused: 'no_picture' });
  const win = entryWindow(entry, Number(size));
  if (!covered(have, ...win)) return out({ need: [win] });
  const blob = await openEntry(rf, entry);                           // inflates, checks CRC and size
  const name = /\.jpe?g$/i.test(entry.path) ? 'picture.jpg' : 'picture.png';
  await writeFile(join(outDir, name), Buffer.from(await blob.arrayBuffer()), { flag: 'wx', mode: 0o644 });
  return out({ made: { file: name, entry: entry.path } });
}

try {
  const have = JSON.parse(await readFile(havePath, 'utf8'));
  const rf = new RangeFile(sparsePath, have, Number(size));
  if (mode !== 'design') throw new Error(`unknown mode ${mode}`);
  await design(rf, have);
} catch (e) {
  if (e instanceof NeedRange) out({ need: e.ranges });
  else if (e instanceof ZipReadError) out({ refused: e.code });
  else throw e;
}
