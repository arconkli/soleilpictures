// Scout — video and audio interrogation, via ffmpeg.
//
// WHY THIS IS HERE AT ALL, and why it is not optional in production.
//
// iPhones record HEVC (H.265) inside a .mov, and **Chrome and Firefox cannot
// play HEVC**. Only Safari can. This is precisely the HEIC bug documented at
// the top of media.js, one media type over: a texted clip would upload fine,
// produce a card that looks correct, and be a black rectangle for most of the
// people the board is shared with — and testing it on a Mac in Safari would
// hide that completely.
//
// It also supplies two things the browser upload path gets for free from the
// DOM and this one cannot:
//
//   · duration — uploads.js reads it off a <video> element (uploads.js:581);
//     there is no element here, and `uploadVideo` FAILS CLOSED without it.
//   · a poster frame — captured from a <canvas> in the browser
//     (uploads.js:610). A video card with no poster is a black rectangle until
//     someone presses play, which on a moodboard is the same as invisible.
//
// DEGRADES, NEVER FAILS. The Dockerfile installs ffmpeg so the deployed bot
// always has it, but the supported way to test Scout is to run this process on
// a laptop — and a laptop may not. Every function here returns null rather than
// throwing when the binary is absent, and the caller keeps the original bytes.
// A clip that lands without a poster is degraded; a clip that does not land at
// all is a lost photo.

import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Transcoding is the one genuinely expensive thing this service does, and it
// runs on a shared-cpu-1x. Bounded so a 4K 10-minute clip cannot wedge the
// machine and take the ingest stream down with it — over the bound the original
// is stored untouched, which is the honest degradation: Safari plays it, other
// browsers offer a download.
const MAX_TRANSCODE_SEC = Number(process.env.SCOUT_MAX_TRANSCODE_SEC || 180);
const MAX_TRANSCODE_BYTES = Number(process.env.SCOUT_MAX_TRANSCODE_BYTES || 120 * 1024 * 1024);
// Wall-clock ceilings. A hung ffmpeg holds a burst open forever otherwise, and
// the batcher serializes per conversation — so one stuck clip blocks every
// later message from that person.
const PROBE_TIMEOUT_MS = 20_000;
const POSTER_TIMEOUT_MS = 30_000;
const TRANSCODE_TIMEOUT_MS = Number(process.env.SCOUT_TRANSCODE_TIMEOUT_MS || 8 * 60_000);

// Codecs no non-Safari browser will decode. The whole reason this module exists.
const NEEDS_TRANSCODE = new Set(['hevc', 'h265', 'prores', 'mpeg4', 'vp6f']);

function run(bin, args, { timeoutMs, capture = 'stdout' } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      reject(e);
      return;
    }
    const out = [];
    const err = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch (_) { /* already gone */ }
      reject(new Error(`${bin} timed out`));
    }, timeoutMs);

    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`${bin} exited ${code}: ${Buffer.concat(err).toString().slice(-300)}`));
        return;
      }
      resolve(capture === 'stderr' ? Buffer.concat(err) : Buffer.concat(out));
    });
  });
}

// Probed once per process. `ffmpeg -version` is the cheapest possible check and
// distinguishes "not installed" from "installed but this file is unreadable",
// which matters: the first is an environment fact and the second is per-file.
let available = null;
export async function hasFfmpeg() {
  if (available !== null) return available;
  try {
    await run('ffprobe', ['-version'], { timeoutMs: 5_000 });
    await run('ffmpeg', ['-version'], { timeoutMs: 5_000 });
    available = true;
  } catch (_) {
    available = false;
    console.warn('[scout] ffmpeg not found — video keeps its original codec, '
      + 'gets no poster frame, and audio reports no duration. Install ffmpeg, '
      + 'or run the container, for full media support.');
  }
  return available;
}

// Work on a real file rather than a pipe. ffmpeg needs to SEEK to grab a frame
// from the middle of a clip, and a stdin pipe is not seekable — piping produces
// either frame zero (usually black or a lens cap) or nothing at all.
async function withTempFile(bytes, ext, fn) {
  const dir = await mkdtemp(join(tmpdir(), 'scout-'));
  const path = join(dir, `in.${ext || 'bin'}`);
  try {
    await writeFile(path, Buffer.from(bytes));
    return await fn(path, dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function firstStream(streams, type) {
  return (streams || []).find((s) => s.codec_type === type) || null;
}

/**
 * Duration, dimensions and codecs. Returns null when ffmpeg is unavailable or
 * the file is not decodable — the caller falls back to defaults rather than
 * rejecting the upload.
 */
export async function probeMedia(bytes, ext) {
  if (!await hasFfmpeg()) return null;
  try {
    return await withTempFile(bytes, ext, async (path) => {
      const raw = await run('ffprobe', [
        '-v', 'error', '-print_format', 'json',
        '-show_format', '-show_streams', path,
      ], { timeoutMs: PROBE_TIMEOUT_MS });
      const j = JSON.parse(raw.toString());
      const v = firstStream(j.streams, 'video');
      const a = firstStream(j.streams, 'audio');
      const duration = Number(j.format?.duration ?? v?.duration ?? a?.duration);

      // Rotation lives in a side-data matrix or a stream tag depending on the
      // container. A portrait iPhone clip is stored landscape with a 90°
      // rotation, exactly like EXIF orientation on a still — miss it and every
      // vertical video gets a landscape card.
      const rotation = Math.abs(Number(
        v?.side_data_list?.find((s) => s.rotation != null)?.rotation
        ?? v?.tags?.rotate ?? 0,
      )) % 180;
      const swap = rotation === 90;

      return {
        duration: Number.isFinite(duration) ? duration : null,
        width: v ? (swap ? v.height : v.width) ?? null : null,
        height: v ? (swap ? v.width : v.height) ?? null : null,
        videoCodec: v?.codec_name || null,
        audioCodec: a?.codec_name || null,
        hasVideo: !!v,
      };
    });
  } catch (e) {
    console.error('[scout] probe failed', e?.message);
    return null;
  }
}

// True when this clip would not play outside Safari.
export function needsTranscode(probe) {
  return !!probe?.hasVideo && NEEDS_TRANSCODE.has(String(probe.videoCodec || '').toLowerCase());
}

/**
 * A single frame as JPEG bytes, taken 12% into the clip.
 *
 * The offset matches captureVideoPoster's `seekTo: 0.12` (uploads.js:610) —
 * frame zero is very often a black frame, a slate, or the inside of a pocket.
 */
export async function posterFrame(bytes, ext, durationSec) {
  if (!await hasFfmpeg()) return null;
  const at = Number.isFinite(durationSec) && durationSec > 0
    ? Math.min(durationSec * 0.12, Math.max(0, durationSec - 0.1))
    : 0;
  try {
    return await withTempFile(bytes, ext, async (path) => {
      const out = await run('ffmpeg', [
        '-v', 'error',
        // -ss BEFORE -i seeks by keyframe without decoding everything up to it.
        '-ss', String(at), '-i', path,
        '-frames:v', '1',
        // Apply the container's rotation matrix, then strip it, so the poster
        // is upright as pixels rather than upright-if-your-viewer-reads-metadata.
        '-vf', 'scale=1024:-2',
        '-f', 'image2', '-c:v', 'mjpeg', '-q:v', '4',
        'pipe:1',
      ], { timeoutMs: POSTER_TIMEOUT_MS });
      return out?.length ? out : null;
    });
  } catch (e) {
    console.error('[scout] poster frame failed', e?.message);
    return null;
  }
}

/**
 * Down-convert any audio to 16 kHz mono MP3, ready for a speech model.
 *
 * Two reasons, and the first is the one that would otherwise bite silently:
 * an iMessage voice memo arrives as Apple CAF or M4A, and a speech endpoint
 * that cannot demux the container returns an empty transcript rather than an
 * error — indistinguishable from "they said nothing".
 *
 * The second is size. Speech models cap the payload, and a five-minute memo at
 * source bitrate is megabytes of it; 16 kHz mono is what the model resamples to
 * anyway, so this throws away nothing it would have used.
 *
 * Returns null when ffmpeg is missing — the caller then sends the original
 * bytes and takes its chances, which is better than not trying.
 */
export async function toTranscriptionAudio(bytes, ext) {
  if (!await hasFfmpeg()) return null;
  try {
    return await withTempFile(bytes, ext, async (path, dir) => {
      const out = join(dir, 'out.mp3');
      await run('ffmpeg', [
        '-v', 'error', '-i', path,
        '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k',
        '-y', out,
      ], { timeoutMs: TRANSCODE_TIMEOUT_MS });
      return await readFile(out);
    });
  } catch (e) {
    console.error('[scout] audio down-convert failed', e?.message);
    return null;
  }
}

/**
 * Re-encode to H.264/AAC in MP4 so every browser can play it.
 *
 * Returns null — meaning "keep the original" — when ffmpeg is missing, the clip
 * is over the bounds, or the encode fails. Never throws: a clip that Safari can
 * play is a far better outcome than a clip that never reached the board.
 */
export async function transcodeToH264(bytes, ext, probe) {
  if (!await hasFfmpeg()) return null;
  if (bytes.length > MAX_TRANSCODE_BYTES) {
    console.warn('[scout] clip over the transcode byte bound — storing the original');
    return null;
  }
  if (Number.isFinite(probe?.duration) && probe.duration > MAX_TRANSCODE_SEC) {
    console.warn('[scout] clip over the transcode duration bound — storing the original');
    return null;
  }
  try {
    return await withTempFile(bytes, ext, async (path, dir) => {
      const out = join(dir, 'out.mp4');
      await run('ffmpeg', [
        '-v', 'error', '-i', path,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24',
        // yuv420p, or Safari and most hardware decoders refuse the result —
        // an "everyone can play this" transcode that Safari cannot play would
        // be worse than not transcoding.
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k',
        // Bake the rotation into the pixels and drop the matrix, so a portrait
        // clip is portrait everywhere.
        '-metadata:s:v:0', 'rotate=0',
        '-movflags', '+faststart',
        '-y', out,
      ], { timeoutMs: TRANSCODE_TIMEOUT_MS });
      return await readFile(out);
    });
  } catch (e) {
    console.error('[scout] transcode failed, keeping the original', e?.message);
    return null;
  }
}
