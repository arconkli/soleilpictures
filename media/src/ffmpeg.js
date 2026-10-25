// The converter's ffmpeg runner. Modelled on scout/src/ffmpeg.js (audit IN-2,
// 2026-10-06) and carrying the same reasoning; the differences are that the
// input here is a URL on our own Worker rather than a local file, and that
// ffmpeg is dropped to an unprivileged user.

import { spawn } from 'node:child_process';

// EVERY INPUT IS A FILE A STRANGER UPLOADED. ffmpeg picks a demuxer from a
// file's CONTENT, not its name, and some demuxers follow references: an HLS or
// DASH manifest or a concat list saved as "clip.mov" can name local paths or
// other URLs, which on this host means reading its files or reaching its
// network, then handing the result back inside a "video". So an input may only
// be the one https URL the Worker gave us (or a local file we wrote ourselves,
// for probing our own output), and only in a real audio or video container:
// no hls, dash, concat or image2, which are exactly the formats that follow
// references. Plain `http` is absent on purpose: https only, over tls and tcp.
export const INPUT_GUARD = Object.freeze([
  '-protocol_whitelist', 'file,https,tls,tcp',
  '-format_whitelist', 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,avi,mpegts,mpeg,mxf,asf,flv,ogg,wav,w64,aiff,caf,mp3,aac,flac,amr,ac3,eac3,dv,wv,ape,au',
]);

const PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
export const MEDIA_UID = Number(process.env.MEDIA_UID || 10001);
export const MEDIA_GID = Number(process.env.MEDIA_GID || 10001);

// The node process runs as root only so it can hand ffmpeg to an unprivileged
// user. A decoder parsing a stranger's bytes is the likeliest thing here to
// have a memory bug, so it gets no secrets (a bare env: MEDIA_BOX_SECRET never
// reaches it) and no rights beyond its own temp dir. On a laptop we are not
// root and just run as ourselves.
export function isRoot() {
  return process.getuid?.() === 0;
}

// Children currently running, so SIGTERM can kill them.
const children = new Set();
let stopping = false;

export function isStopping() {
  return stopping;
}

export function killAll() {
  stopping = true;
  for (const c of children) {
    try { c.kill('SIGKILL'); } catch (_) { /* already gone */ }
  }
}

// Resolves with stdout (or stderr when capture is 'stderr'). Rejects on a
// non-zero exit, a spawn error or the timeout, which is SIGKILL (a wedged
// ffmpeg ignores anything gentler). The message carries only the tail of
// stderr; callers scrub it before it leaves this box.
export function run(bin, args, { timeoutMs, capture = 'stdout' } = {}) {
  return new Promise((resolve, reject) => {
    if (stopping) {
      reject(new Error('shutting down'));
      return;
    }
    const opts = {
      env: { PATH, HOME: '/tmp' },
      stdio: ['ignore', 'pipe', 'pipe'],
    };
    if (isRoot()) {
      opts.uid = MEDIA_UID;
      opts.gid = MEDIA_GID;
    }
    let child;
    try {
      child = spawn(bin, args, opts);
    } catch (e) {
      reject(e);
      return;
    }
    children.add(child);
    const out = [];
    const err = [];
    let settled = false;
    const finish = (fn, v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      children.delete(child);
      fn(v);
    };
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (_) { /* already gone */ }
      finish(reject, new Error(`${bin} timed out`));
    }, timeoutMs);

    // Keep only a bounded tail of stderr: a long encode can be chatty.
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => {
      err.push(d);
      if (err.length > 64) err.shift();
    });
    child.on('error', (e) => finish(reject, e));
    child.on('close', (code) => {
      if (code !== 0) {
        finish(reject, new Error(`${bin} exited ${code}: ${Buffer.concat(err).toString().slice(-300)}`));
        return;
      }
      finish(resolve, capture === 'stderr' ? Buffer.concat(err) : Buffer.concat(out));
    });
  });
}

// zscale (libzimg) does the HDR tone map. Not every ffmpeg build has it, so
// look once at startup; without it an HDR source is encoded without the tone
// map (washed out, but it plays) rather than failing.
let zscale = null;
export async function hasZscale() {
  if (zscale !== null) return zscale;
  try {
    const out = await run('ffmpeg', ['-nostdin', '-hide_banner', '-filters'], { timeoutMs: 15_000 });
    zscale = out.toString().includes(' zscale ');
  } catch (_) {
    zscale = false;
  }
  return zscale;
}
