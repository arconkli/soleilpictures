// One conversion job, start to finish. The shape of the work is decided by
// playPlan (boards/src/lib/playCopy.js, shared with the Worker); this file
// only runs it.

import { mkdtemp, rm, chown, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { playPlan, probeDuration } from '../../boards/src/lib/playCopy.js';
import { run, isRoot, isStopping, MEDIA_UID, MEDIA_GID } from './ffmpeg.js';
import { probeArgs, copyArgs, posterArgs, posterDims, displayDims, trimProbe, scrubError } from './args.js';
import * as api from './api.js';

const HEARTBEAT_MS = 60_000;
const PROBE_TIMEOUT_MS = 60_000;
const POSTER_TIMEOUT_MS = 120_000;
const MIN_ENCODE_MS = 20 * 60_000;
const MAX_ENCODE_MS = 12 * 60 * 60_000;

// At least 20 minutes, or 3 seconds of wall clock per second of media for a
// long one, never more than 12 hours: a hung ffmpeg must not hold a lease
// (and a 16-core box) forever.
export function encodeTimeoutMs(durationSec) {
  const d = Number.isFinite(durationSec) ? durationSec : 0;
  return Math.min(MAX_ENCODE_MS, Math.max(MIN_ENCODE_MS, d * 3000));
}

async function probeOf(url) {
  const out = await run('ffprobe', probeArgs(url), { timeoutMs: PROBE_TIMEOUT_MS });
  return JSON.parse(out.toString());
}

function result(probe, durationSec, extra = {}) {
  return { probe: trimProbe(probe), durationSec: durationSec ?? null, copy: null, poster: null, error: null, reason: null, ...extra };
}

// Never throws for a job's own failure: that is reported through finish().
// Returns nothing; the caller only needs to know it is done.
export async function processJob(job, { zscale }) {
  const key = job.key;
  let dir = null;
  let probe = null;
  let durationSec = null;
  const beat = setInterval(() => {
    api.heartbeat(key).catch((e) => console.warn(`[media] heartbeat failed for ${key}: ${scrubError(e?.message)}`));
  }, HEARTBEAT_MS);

  try {
    const input = api.sourceUrl(job);
    probe = await probeOf(input);
    durationSec = probeDuration(probe);
    const plan = playPlan(probe, { ext: job.ext, kind: job.kind });

    if (plan.action === 'none') {
      await api.finish(key, 'skip', result(probe, durationSec));
      return;
    }
    if (plan.action === 'refuse') {
      await api.finish(key, 'failed', result(probe, durationSec, { reason: plan.reason }));
      return;
    }

    dir = await mkdtemp(join(tmpdir(), 'media-'));
    // ffmpeg runs as an unprivileged user and must be able to write here.
    if (isRoot()) await chown(dir, MEDIA_UID, MEDIA_GID);
    const audioJob = job.kind === 'audio';
    const copyPath = join(dir, audioJob ? 'copy.m4a' : 'copy.mp4');

    await run('ffmpeg', copyArgs({ plan, probe, kind: job.kind, input, output: copyPath, zscale }), {
      timeoutMs: encodeTimeoutMs(durationSec),
    });

    // The copy's real size, read back from the file we are about to ship.
    const outProbe = await probeOf(copyPath);
    const outDims = displayDims(outProbe) || { w: 0, h: 0 };
    const copyBytes = (await stat(copyPath)).size;

    // A poster failing costs a card its picture, not its playback.
    let poster = null;
    const srcDims = displayDims(probe);
    let posterPath = null;
    if (!audioJob && srcDims) {
      posterPath = join(dir, 'poster.webp');
      const at = durationSec > 0 ? Math.min(durationSec * 0.12, Math.max(0, durationSec - 0.1)) : 0;
      try {
        await run('ffmpeg', posterArgs({ input, output: posterPath, at, hdr: plan.hdr, zscale }), {
          timeoutMs: POSTER_TIMEOUT_MS,
        });
        poster = posterDims(srcDims);
      } catch (e) {
        console.warn(`[media] poster failed for ${key}: ${scrubError(e?.message)}`);
        posterPath = null;
      }
    }

    await api.uploadFile(key, 'copy', copyPath, copyBytes, audioJob ? 'audio/mp4' : 'video/mp4');
    if (poster && posterPath) {
      try {
        await api.uploadFile(key, 'poster', posterPath, (await stat(posterPath)).size, 'image/webp');
      } catch (e) {
        console.warn(`[media] poster upload failed for ${key}: ${scrubError(e?.message)}`);
        poster = null;
      }
    }

    await api.finish(key, 'done', result(probe, durationSec, {
      copy: { w: outDims.w, h: outDims.h, bytes: copyBytes },
      poster,
    }));
  } catch (e) {
    // On SIGTERM we killed ffmpeg ourselves: say nothing, and the lease
    // expiring hands the job to the next claim.
    if (isStopping()) return;
    console.error(`[media] job ${key} failed: ${scrubError(e?.message)}`);
    try {
      await api.finish(key, 'failed', result(probe || {}, durationSec, { error: scrubError(e?.message) }));
    } catch (e2) {
      console.error(`[media] could not report failure for ${key}: ${scrubError(e2?.message)}`);
    }
  } finally {
    clearInterval(beat);
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
