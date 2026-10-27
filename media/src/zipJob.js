// A zip-based design file read without downloading it. A Procreate file is
// gigabytes of timelapse around a small picture, so the box reads the zip in
// rounds of Range GETs into a sparse local copy: its end (the end of central
// directory), then its central directory, then the one entry that is the
// picture. A zip under SPARSE_WHOLE_BYTES is just downloaded whole in round 0.
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
import { ZIP_TAIL_BYTES, ZIP_FETCH_MAX_BYTES } from './zipPick.js';

const ZIP_MAIN = fileURLToPath(new URL('./zipMain.js', import.meta.url));
const SPARSE_WHOLE_BYTES = 8 * 1024 * 1024;
const MAX_ROUNDS = 5;
const MAX_NEED_RANGES = 8;
const CHILD_TIMEOUT_MS = 120_000;
const CHILD_MAX_BYTES = 1024 * 1024;
const FETCH_TIMEOUT_MS = 10 * 60_000;
// What the child may say it refused for; anything else is "unsupported".
const REFUSALS = new Set(['no_picture', 'not_zip', 'too_big', 'crc', 'encrypted']);

// A file this makes no picture of, and why (the view record's reason).
export class Refused extends Error {
  constructor(reason, message = reason) {
    super(message);
    this.reason = reason;
  }
}

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

// Reads the picture out of the zip at `url` (`size` bytes) into `work`, which
// the child may write (view.js makeJobDir). → { made: { path, entry, via } }.
// Throws Refused.
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
      if (said?.made) {
        const { file, entry } = said.made;
        if (typeof file !== 'string' || !file || basename(file) !== file) throw new Refused('error', 'the zip reader named a file outside its folder');
        return { made: { path: join(work, file), entry: String(entry || ''), via: 'zip' } };
      }
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
