// soleil-media: the converter box. Claims jobs from our Worker, runs ffmpeg
// (playable copies), vips (views of photos) or LibreOffice (views of
// documents), hands the outputs back. See README.md.
//
// Scale to zero without Fly's proxy: after IDLE_EXIT_MS with no work the
// process exits 0 and the machine stays stopped; the Worker's next /wake
// request auto-starts it, and a boot always starts the loop.

import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import * as api from './api.js';
import { hasZscale, killAll, killStrays } from './ffmpeg.js';
import { processJob } from './job.js';
import { processView } from './view.js';
import { scrubError } from './args.js';
import { isViewKind } from '../../boards/src/lib/fileView.js';

const PORT = Number(process.env.PORT || 8080);
const SECRET = process.env.MEDIA_BOX_SECRET || '';
const IDLE_EXIT_MS = Number(process.env.IDLE_EXIT_MS || 300_000);
const IDLE_POLL_MS = 15_000;
const BACKOFF_MS = 30_000;

if (!SECRET || !process.env.MEDIA_API_BASE) {
  console.error('[media] MEDIA_BOX_SECRET and MEDIA_API_BASE are required');
  process.exit(1);
}

// Hash first so the compare is constant-time whatever the lengths.
const digest = (s) => createHash('sha256').update(String(s)).digest();
function authorised(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  return !!m && timingSafeEqual(digest(m[1]), digest(SECRET));
}

let looping = false;
let stopping = false;
let wakeSleep = null;

// A sleep a /wake can cut short.
function sleep(ms) {
  return new Promise((resolve) => {
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      wakeSleep = null;
      resolve();
    }
    wakeSleep = done;
  });
}

let lastWork = Date.now();

async function loop() {
  if (looping) return;
  looping = true;
  const zscale = await hasZscale();
  console.log(`[media] work loop started (zscale ${zscale ? 'yes' : 'no'})`);
  try {
    while (!stopping) {
      let job = null;
      let failed = false;
      try {
        job = await api.claim();
      } catch (e) {
        failed = true;
        console.warn(`[media] claim failed (${e?.status || scrubError(e?.message)}), backing off`);
      }
      if (job) {
        console.log(`[media] job ${job.key} (${job.kind}, attempt ${job.attempts})`);
        // A job starts with nothing of the unprivileged user's running.
        await killStrays().catch(() => {});
        if (isViewKind(job.kind)) await processView(job);
        else await processJob(job, { zscale });
        lastWork = Date.now();
        continue;
      }
      // No work, or a Worker that can't be asked: either way the machine stops
      // once idle, or a Worker that is down would keep it running for good.
      if (Date.now() - lastWork >= IDLE_EXIT_MS) {
        console.log('[media] idle, exiting');
        process.exit(0);
      }
      await sleep(failed ? BACKOFF_MS : IDLE_POLL_MS);
    }
  } finally {
    looping = false;
  }
}

const server = createServer((req, res) => {
  const path = (req.url || '').split('?')[0];
  if (req.method === 'GET' && path === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    return;
  }
  if (req.method === 'POST' && path === '/wake') {
    if (!authorised(req)) {
      res.writeHead(401).end();
      return;
    }
    lastWork = Date.now();
    if (wakeSleep) wakeSleep();
    loop().catch((e) => console.error(`[media] loop crashed: ${scrubError(e?.message)}`));
    res.writeHead(202).end();
    return;
  }
  res.writeHead(404).end();
});

server.listen(PORT, () => console.log(`[media] listening on ${PORT}`));

// A boot is almost always caused by a wake.
loop().catch((e) => console.error(`[media] loop crashed: ${scrubError(e?.message)}`));

// Stop claiming, kill the running ffmpeg (its job's lease will expire and
// the next claim retries it), and go.
process.on('SIGTERM', () => {
  stopping = true;
  killAll();
  if (wakeSleep) wakeSleep();
  setTimeout(() => process.exit(0), 500).unref();
});
