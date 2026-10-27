// One view job: a photo some browser can't draw, made into a WebP every
// browser can (boards/src/lib/fileView.js decides which files, and the
// names). vips does the decoding, as the unprivileged user, with no secrets,
// from a local copy of the file: unlike ffmpeg it can't read our Worker's
// URL, and a file on disk can't send it anywhere else. A camera raw first
// gives up its picture through exiftool or LibRaw (raw.js), and a Photoshop
// document through our own reader (psd.js, in a process of its own), both
// the same unprivileged way.

import { mkdtemp, rm, chown, stat, open, readFile, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VIEW_EDGE, VIEW_SM_EDGE, VIEW_MAX_BYTES, VIEW_MAX_PIXELS } from '../../boards/src/lib/fileView.js';
import { run, isRoot, isStopping, MEDIA_UID, MEDIA_GID } from './ffmpeg.js';
import {
  decoderOf, sniffLoader, sniffRaw, sniffPsd, SOURCE_LOADERS, thumbnailArgs, uprightDims, vipsEnv, jp2kLevel,
  stripWebpMetadata,
} from './viewArgs.js';
import { rawPicture } from './raw.js';
import { scrubError } from './args.js';
import * as api from './api.js';

const HEARTBEAT_MS = 60_000;
const DOWNLOAD_TIMEOUT_MS = 15 * 60_000;
const HEADER_TIMEOUT_MS = 60_000;
const THUMB_TIMEOUT_MS = 10 * 60_000;
const PSD_TIMEOUT_MS = 10 * 60_000;
const PSD_MAIN = fileURLToPath(new URL('./psdMain.js', import.meta.url));

// A file this makes no view of, and why (the record's reason).
class Refused extends Error {
  constructor(reason, message = reason) {
    super(message);
    this.reason = reason;
  }
}

// The original, into a file, never more than `max` bytes of it.
async function download(url, path, max) {
  const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!res.ok || !res.body) throw new Error(`source ${res.status}`);
  let got = 0;
  const cap = new Transform({
    transform(chunk, _enc, done) {
      got += chunk.length;
      done(got > max ? new Refused('too_large') : null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body), cap, createWriteStream(path, { mode: 0o644 }));
}

async function headOf(path, n = 16) {
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(n);
    const { bytesRead } = await fh.read(buf, 0, n, 0);
    return new Uint8Array(buf.subarray(0, bytesRead));
  } finally {
    await fh.close();
  }
}

const field = async (path, name, env) => (await run('vipsheader', ['-f', name, path], {
  timeoutMs: HEADER_TIMEOUT_MS, env,
})).toString().trim();

async function sizeOf(path, env) {
  const [w, h] = await Promise.all([field(path, 'width', env), field(path, 'height', env)]);
  return { w: Number(w), h: Number(h) };
}

// What vips wrote, minus every tag it should not have kept (see thumbnailArgs).
async function stripFile(path) {
  await writeFile(path, stripWebpMetadata(new Uint8Array(await readFile(path))));
}

// The views of the local file `src`, made in `dir` (which vips can write),
// read with one of `loaders`. `original` is the original's size when `src` is
// a picture made of it (a raw's JPEG, a document's flattened picture), not the
// original itself. Throws Refused for a file it makes no view of.
export async function makeViews(src, dir, { loaders = SOURCE_LOADERS, original = null } = {}) {
  const loader = sniffLoader(await headOf(src));
  if (!loader || !loaders.includes(loader)) throw new Refused('unsupported', 'not a format views are made of');
  const env = vipsEnv(loader);
  // vips must agree with the bytes before it decodes a pixel.
  const read = await field(src, 'vips-loader', env);
  if (read !== loader) throw new Refused('unsupported', `read as ${read || 'nothing'}`);
  const size = await sizeOf(src, env);
  if (!(size.w > 0) || !(size.h > 0)) throw new Refused('unsupported', 'no size');
  if (size.w * size.h > VIEW_MAX_PIXELS) throw new Refused('too_large');

  // JPEG 2000: decoded at the right level first (see jp2kLevel).
  let input = src;
  if (loader === 'jp2kload') {
    const levels = Number(await field(src, 'n-pages', env)) || 1;
    input = join(dir, 'level.v');
    await run('vips', ['copy', `${src}[page=${jp2kLevel(size.w, size.h, levels, VIEW_EDGE)}]`, input], { timeoutMs: THUMB_TIMEOUT_MS, env });
  }
  const viewPath = join(dir, 'view.webp');
  await run('vips', thumbnailArgs(input, viewPath, VIEW_EDGE, 80), { timeoutMs: THUMB_TIMEOUT_MS, env });
  await stripFile(viewPath);
  // Our own WebP from here on: the block stays on.
  const own = vipsEnv('webpload');
  const view = await sizeOf(viewPath, own);
  // The small one is made from the view, and only when it would be smaller.
  // Without it the card shows the view at every size, as a small photo would.
  const smPath = join(dir, 'view_sm.webp');
  let viewSm = null;
  if (Math.max(view.w, view.h) > VIEW_SM_EDGE) {
    try {
      await run('vips', thumbnailArgs(viewPath, smPath, VIEW_SM_EDGE, 72), { timeoutMs: THUMB_TIMEOUT_MS, env: own });
      await stripFile(smPath);
      viewSm = await sizeOf(smPath, own);
    } catch (e) {
      console.warn(`[media] small view failed: ${scrubError(e?.message)}`);
    }
  }
  const shot = original || size;
  return { loader, original: uprightDims(shot.w, shot.h, view), view, viewSm, viewPath, smPath };
}

// A Photoshop document's flattened picture (or its thumbnail), through
// psdMain.js: { path, loader, original }.
async function psdPicture(src, dir) {
  const tiff = join(dir, 'flat.tif');
  const jpeg = join(dir, 'thumb.jpg');
  const out = await run(process.execPath, ['--max-old-space-size=1536', PSD_MAIN, src, tiff, jpeg,
    String(VIEW_EDGE), String(VIEW_MAX_PIXELS)], { timeoutMs: PSD_TIMEOUT_MS });
  let said = null;
  try { said = JSON.parse(out.toString().trim().split('\n').pop()); } catch (_) { /* below */ }
  if (said?.refused) throw new Refused(said.refused === 'too_large' ? 'too_large' : 'unsupported', said.message);
  if (said?.made !== 'tiff' && said?.made !== 'jpeg') throw new Error('the Photoshop reader said nothing');
  const original = said.w > 0 && said.h > 0 ? { w: said.w, h: said.h } : null;
  return said.made === 'tiff'
    ? { path: tiff, loader: 'tiffload', original, via: 'psd' }
    : { path: jpeg, loader: 'jpegload', original, via: 'psd_thumbnail' };
}

// The views of a job's downloaded file `src`, by how its format is read.
export async function viewsOf(decoder, src, dir) {
  if (decoder === 'vips') return { ...(await makeViews(src, dir)), via: 'vips' };
  const head = await headOf(src);
  let picture;
  if (decoder === 'raw') {
    if (!sniffRaw(head)) throw new Refused('unsupported', 'not a camera raw');
    picture = await rawPicture(src, dir, {
      sizeOf: (path, loader) => sizeOf(path, vipsEnv(loader)),
      refuse: (reason, message) => new Refused(reason, message),
    });
  } else {
    if (!sniffPsd(head)) throw new Refused('unsupported', 'not a Photoshop document');
    picture = await psdPicture(src, dir);
  }
  const made = await makeViews(picture.path, dir, { loaders: [picture.loader], original: picture.original });
  return { ...made, via: picture.via };
}

// Never throws for a job's own failure: that is reported through finish().
export async function processView(job) {
  const key = job.key;
  let dir = null;
  const beat = setInterval(() => {
    api.heartbeat(key).catch((e) => console.warn(`[media] heartbeat failed for ${key}: ${scrubError(e?.message)}`));
  }, HEARTBEAT_MS);

  try {
    const decoder = decoderOf(job.ext);
    if (!decoder) throw new Refused('unsupported', `no views of .${job.ext}`);
    if (Number(job.sizeBytes) > VIEW_MAX_BYTES) throw new Refused('too_large');
    dir = await mkdtemp(join(tmpdir(), 'view-'));
    // vips runs as an unprivileged user and must be able to write here.
    if (isRoot()) await chown(dir, MEDIA_UID, MEDIA_GID);
    // A raw keeps its extension (decoderOf vouched for it): exiftool and
    // LibRaw read some makes by it, and LibRaw writes source.tiff beside it.
    const src = join(dir, decoder === 'raw' ? `source.${job.ext.toLowerCase()}` : 'source');
    await download(api.sourceUrl(job), src, VIEW_MAX_BYTES);
    const made = await viewsOf(decoder, src, dir);

    await api.uploadFile(key, 'view', made.viewPath, (await stat(made.viewPath)).size, 'image/webp');
    let viewSm = made.viewSm;
    if (viewSm) {
      try {
        await api.uploadFile(key, 'view_sm', made.smPath, (await stat(made.smPath)).size, 'image/webp');
      } catch (e) {
        console.warn(`[media] small view upload failed for ${key}: ${scrubError(e?.message)}`);
        viewSm = null;
      }
    }
    await api.finish(key, 'done', {
      probe: { loader: made.loader, via: made.via, w: made.original.w, h: made.original.h },
      view: made.view,
      viewSm,
      original: made.original,
    });
  } catch (e) {
    // On SIGTERM we killed vips ourselves: say nothing, and the lease
    // expiring hands the job to the next claim.
    if (isStopping()) return;
    const refused = e instanceof Refused;
    if (!refused) console.error(`[media] view ${key} failed: ${scrubError(e?.message)}`);
    try {
      await api.finish(key, 'failed', { reason: refused ? e.reason : 'error', error: scrubError(e?.message) });
    } catch (e2) {
      console.error(`[media] could not report failure for ${key}: ${scrubError(e2?.message)}`);
    }
  } finally {
    clearInterval(beat);
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
