// A zip-based design file, or a zip, read without downloading it. A Procreate
// file is gigabytes of timelapse around a small picture, so the box reads the
// zip in rounds of Range GETs into a sparse local copy: its end (the end of
// central directory), then its central directory, then the one entry that is
// the picture (or, for a zip's contact sheet, the few pictures it shows). A
// zip under SPARSE_WHOLE_BYTES is just downloaded whole in round 0.
//
// The root process fetches; a child (zipMain.js) parses, as the unprivileged
// user with no network, and can only answer with the byte ranges it needs or
// the picture it made. Whatever it asks for is checked here: whole numbers,
// inside the file, and a budget for the job (ZIP_FETCH_MAX_BYTES).

import { open, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './ffmpeg.js';
import { mergeRanges, covered } from './rangeFile.js';
import { ZIP_TAIL_BYTES, ZIP_FETCH_MAX_BYTES, MAX_NEED_RANGES } from './zipPick.js';
import { SHEET_TILES } from '../../boards/src/lib/archiveSheet.js';
import { Refused } from './refused.js';

export { Refused };

const ZIP_MAIN = fileURLToPath(new URL('./zipMain.js', import.meta.url));
const SPARSE_WHOLE_BYTES = 8 * 1024 * 1024;
const MAX_ROUNDS = 5;
const CHILD_TIMEOUT_MS = 120_000;
const CHILD_MAX_BYTES = 1024 * 1024;
const FETCH_TIMEOUT_MS = 10 * 60_000;
// What the child may say it refused for; anything else is "unsupported".
const REFUSALS = new Set(['no_picture', 'not_zip', 'too_big', 'crc', 'encrypted']);

// The child, sandboxed as psdMain.js is: no network, a capped heap. Resolves
// with its stdout.
export function defaultRunChild(argv) {
  return run(process.execPath, ['--max-old-space-size=1024', ZIP_MAIN, ...argv], {
    isolate: true, capture: 'stdout', maxBytes: CHILD_MAX_BYTES, timeoutMs: CHILD_TIMEOUT_MS,
  });
}

// [start, end) of the file into the sparse copy, by one Range GET that must
// answer 206 with exactly those bytes.
async function fetchInto(fh, url, start, end, fetchImpl) {
  const res = await fetchImpl(url, {
    headers: { Range: `bytes=${start}-${end - 1}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (res.status !== 206 || !res.body) throw new Refused('error', `source answered ${res.status} to a range`);
  const said = res.headers?.get?.('content-range');
  if (said && !said.startsWith(`bytes ${start}-${end - 1}/`)) throw new Refused('error', 'source answered another range');
  let at = start;
  for await (const chunk of res.body) {
    if (at + chunk.length > end) throw new Refused('error', 'source sent more than the range');
    await fh.write(chunk, 0, chunk.length, at);
    at += chunk.length;
  }
  if (at !== end) throw new Refused('error', 'source sent less than the range');
}

// The design picture the child made: a plain name in its folder.
function pictureMade({ file, entry }, work) {
  if (typeof file !== 'string' || !file || basename(file) !== file) throw new Refused('error', 'the zip reader named a file outside its folder');
  return { path: join(work, file), entry: String(entry || ''), via: 'zip' };
}

const TILE_KINDS = new Set(['folder', 'photo', 'file']);
const PHOTO_FILE = /^t(\d{1,2})\.(jpg|jpeg|png|webp|gif|tif|tiff|heic|heif)$/;
const whole = (n) => (Number.isSafeInteger(n) && n >= 0 ? n : 0);

// A zip's contact sheet as the child said it, held to what it may say: at
// most SHEET_TILES tiles of the three kinds, names cut short, whole numbers,
// and only its pictures' own files, t<i>.<ext>, each a photo tile's, once. A
// tile is named by its place (`path`), never by a path out of the zip.
function sheetMade(made, work) {
  if (!Array.isArray(made.tiles) || !made.tiles.length || made.tiles.length > SHEET_TILES) {
    throw new Refused('error', 'the zip reader said no tiles');
  }
  const tiles = made.tiles.map((t, i) => {
    if (!TILE_KINDS.has(t?.kind)) throw new Refused('error', 'the zip reader named a tile it may not');
    const ext = typeof t.ext === 'string' && /^[a-z0-9]{1,10}$/.test(t.ext) ? t.ext : '';
    return { kind: t.kind, name: String(t.name ?? '').slice(0, 200), path: String(i), count: whole(t.count), ext, size: whole(t.size) };
  });
  const seen = new Set();
  const files = (Array.isArray(made.files) ? made.files : []).map((f) => {
    const m = PHOTO_FILE.exec(typeof f?.file === 'string' ? f.file : '');
    const i = m ? Number(m[1]) : -1;
    if (!m || f.i !== i || seen.has(i) || tiles[i]?.kind !== 'photo' || tiles[i].ext !== m[2]) {
      throw new Refused('error', 'the zip reader named a file it may not');
    }
    seen.add(i);
    return { i, path: join(work, f.file) };
  });
  const s = made.summary && typeof made.summary === 'object' ? made.summary : {};
  return { tiles, summary: { files: whole(s.files), folders: whole(s.folders), bytes: whole(s.bytes) }, files };
}

// Reads the zip at `url` (`size` bytes) into `work`, which the child may write
// (view.js makeJobDir). → { made }: for mode 'design' the picture, { path,
// entry, via }; for 'sheet' the contact sheet, { tiles, summary, files: [{ i,
// path }] }. Throws Refused.
export async function readZipInRounds({ url, size, mode, ext, work, fetchImpl = fetch, runChild = defaultRunChild }) {
  const sparse = join(work, 'sparse.zip');
  const fh = await open(sparse, 'wx', 0o644);
  try {
    await fh.truncate(size);
    let have = [];
    let spent = 0;
    const get = async (start, end) => {
      if (end <= start) return;
      spent += end - start;
      if (spent > ZIP_FETCH_MAX_BYTES) throw new Refused('too_large');
      await fetchInto(fh, url, start, end, fetchImpl);
      have = mergeRanges([...have, [start, end]]);
    };
    // Round 0: the whole file when it is small, else its end.
    if (size <= SPARSE_WHOLE_BYTES) await get(0, size);
    else await get(Math.max(0, size - ZIP_TAIL_BYTES), size);

    for (let round = 1; round <= MAX_ROUNDS; round++) {
      // A fresh name each round, so the child can't swap a file the root reads.
      const havePath = join(work, `have-${round}.json`);
      await writeFile(havePath, JSON.stringify(have), { flag: 'wx', mode: 0o644 });
      const out = await runChild([mode, ext, sparse, havePath, String(size), work]);
      let said = null;
      try { said = JSON.parse(out.toString().trim().split('\n').pop()); } catch (_) { /* below */ }
      if (said?.made) return { made: mode === 'sheet' ? sheetMade(said.made, work) : pictureMade(said.made, work) };
      if (said?.refused) throw new Refused(REFUSALS.has(said.refused) ? said.refused : 'unsupported', String(said.refused));
      if (!Array.isArray(said?.need) || !said.need.length || said.need.length > MAX_NEED_RANGES) {
        throw new Refused('error', 'the zip reader said nothing');
      }
      for (const r of said.need) {
        const [s, e] = Array.isArray(r) ? r : [];
        if (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || s >= e || e > size) {
          throw new Refused('error', 'the zip reader asked for bytes outside the file');
        }
      }
      for (const [s, e] of mergeRanges(said.need)) if (!covered(have, s, e)) await get(s, e);
    }
    throw new Refused('error', 'too many rounds');
  } finally {
    await fh.close();
  }
}
