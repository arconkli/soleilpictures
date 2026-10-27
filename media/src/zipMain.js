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
//   {"made":{"file":"picture.png","entry":"…"}}   'design': the picture, in <outDir>
//   {"made":{"tiles":[…],"summary":{…},"files":[{"i":0,"file":"t0.jpg"}]}}
//                                                 'sheet': a zip's contact sheet,
//                                                 its pictures' bytes in <outDir>
//   {"refused":"no_picture"|"not_zip"|"too_big"|"crc"|"encrypted"|…}
// Anything else is a crash.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RangeFile, NeedRange, covered, mergeRanges } from './rangeFile.js';
import { designEntry, entryWindow, ZIP_CD_MAX_BYTES, MAX_NEED_RANGES, SHEET_PHOTO_MAX_BYTES } from './zipPick.js';
import { zipDirectoryBounds, readZipDirectory, openEntry, ZipReadError } from '../../boards/src/lib/zipRead.js';
import { cleanPath, sheetTiles, summaryOf } from '../../boards/src/lib/archiveSheet.js';

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

// A zip's contact sheet: its tiles (archiveSheet.js), and each picture among
// them taken out into <outDir> as t<i>.<ext>, its bytes as the zip holds them
// (the root process checks and thumbnails them). A picture that is locked,
// too big or broken stays a file's tile.
async function sheet(rf, have) {
  const { cdStart, cdEnd } = await zipDirectoryBounds(rf);
  if (cdEnd - cdStart > ZIP_CD_MAX_BYTES) return out({ refused: 'too_big' });
  if (!covered(have, cdStart, cdEnd)) return out({ need: [[cdStart, cdEnd]] });
  // A locked picture is still on the sheet, as a file's tile.
  const { entries } = await readZipDirectory(rf, { locked: true });
  const tiles = sheetTiles(entries);
  if (!tiles.length) return out({ refused: 'empty' });
  const byPath = new Map();
  for (const e of entries) {
    const path = cleanPath(e.path);
    if (path && !e.dir) byPath.set(path, e);
  }
  const photos = tiles.map((t, i) => ({ t, i, e: t.kind === 'photo' ? byPath.get(t.path) : null }))
    .filter(({ e }) => e && !(e.flags & 1) && e.size <= SHEET_PHOTO_MAX_BYTES && e.compressedSize <= SHEET_PHOTO_MAX_BYTES);
  const need = mergeRanges(photos.map(({ e }) => entryWindow(e, Number(size))).filter((w) => !covered(have, ...w)));
  if (need.length) return out({ need: need.slice(0, MAX_NEED_RANGES) });
  const files = [];
  for (const { t, i, e } of photos) {
    let blob;
    try {
      blob = await openEntry(rf, e);                                 // inflates, checks CRC and size
    } catch (err) {
      if (err instanceof NeedRange) throw err;
      continue;
    }
    const file = `t${i}.${t.ext}`;
    await writeFile(join(outDir, file), Buffer.from(await blob.arrayBuffer()), { flag: 'wx', mode: 0o644 });
    files.push({ i, file });
  }
  const short = tiles.map((t) => ({ kind: t.kind, name: t.name.slice(0, 200), count: t.count, ext: t.ext, size: t.size }));
  return out({ made: { tiles: short, summary: summaryOf(entries), files } });
}

try {
  const have = JSON.parse(await readFile(havePath, 'utf8'));
  const rf = new RangeFile(sparsePath, have, Number(size));
  if (mode === 'design') await design(rf, have);
  else if (mode === 'sheet') await sheet(rf, have);
  else throw new Error(`unknown mode ${mode}`);
} catch (e) {
  if (e instanceof NeedRange) out({ need: e.ranges });
  else if (e instanceof ZipReadError) out({ refused: e.code });
  else throw e;
}
