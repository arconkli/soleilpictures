// The converter's runner for ffmpeg and every other decoder. Modelled on
// scout/src/ffmpeg.js (audit IN-2, 2026-10-06) and carrying the same
// reasoning; the differences are that the input here is a URL on our own
// Worker rather than a local file, and that every decoder is dropped to an
// unprivileged user.

import { spawn } from 'node:child_process';
import { open, readdir, readFile, mkdtemp, mkdir, chmod, chown } from 'node:fs/promises';
import { constants as FS } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

// The node process runs as root only so it can hand each decoder to an
// unprivileged user. A decoder parsing a stranger's bytes is the likeliest
// thing here to have a memory bug, so it gets no secrets (a bare env:
// MEDIA_BOX_SECRET never reaches it) and no rights beyond its job's work
// folder (makeJobDir). On a laptop we are not root and just run as ourselves.
export function isRoot() {
  return process.getuid?.() === 0;
}

// Children currently running, so SIGTERM can kill them: child → its kill.
const children = new Map();
let stopping = false;
// Unprivileged children running now (see run's stray sweep).
let unprivileged = 0;

export function isStopping() {
  return stopping;
}

export function killAll() {
  stopping = true;
  for (const kill of children.values()) kill();
}

// Whether a process, by its /proc/<pid>/status, is a live one of `uid`'s. A
// zombie runs nothing and can't be killed, only reaped, which init does: the
// gpg helpers LibreOffice starts for a Word, Excel or PowerPoint file end that
// way, orphaned, for a few seconds after every such run.
export function isStray(status, uid = MEDIA_UID) {
  const uids = /^Uid:\s+([0-9]+)\s+([0-9]+)\s+([0-9]+)/m.exec(status);
  if (!uids || !uids.slice(1, 4).some((u) => Number(u) === uid)) return false;
  const state = /^State:\s+([A-Za-z])/m.exec(status)?.[1];
  return state !== 'Z' && state !== 'X';
}

// Every process the unprivileged user has, killed. Between decoder runs it
// has none, so whatever is left is a decoder that outlived its run: a helper
// that left its process group, or one a hostile file had fork itself away.
// Nothing it planted can then change under the root process's feet. Root only.
export async function killStrays() {
  if (!isRoot()) return 0;
  let n = 0;
  for (const name of await readdir('/proc').catch(() => [])) {
    if (!/^[0-9]+$/.test(name)) continue;
    const status = await readFile(`/proc/${name}/status`, 'utf8').catch(() => '');
    if (isStray(status)) {
      try { process.kill(Number(name), 'SIGKILL'); n += 1; } catch (_) { /* already gone */ }
    }
  }
  return n;
}

// How a child is started. As root, a decoder runs as MEDIA_UID; `isolate`
// also takes the network away (a namespace of its own with no interfaces,
// unshare -n), which only root can make, so setpriv drops it to MEDIA_UID
// after, with no supplementary groups and no way to gain privileges back. A
// decoder that reads a local file needs no network; ffmpeg reads our Worker's
// URL, so it runs unisolated.
export function spawnPlan(bin, args, { root = isRoot(), isolate = false } = {}) {
  if (!root) return { cmd: bin, argv: args, ids: null };
  if (!isolate) return { cmd: bin, argv: args, ids: { uid: MEDIA_UID, gid: MEDIA_GID } };
  return {
    cmd: 'unshare',
    argv: ['-n', '--', 'setpriv', `--reuid=${MEDIA_UID}`, `--regid=${MEDIA_GID}`, '--clear-groups', '--no-new-privs',
      '--', bin, ...args],
    ids: null,
  };
}

// Resolves with stdout (or stderr when capture is 'stderr'). Rejects on a
// non-zero exit, a spawn error or the timeout, which is SIGKILL (a wedged
// ffmpeg ignores anything gentler). The message carries only the tail of
// stderr; callers scrub it before it leaves this box. `env` adds settings to
// the child's bare environment (vips' untrusted-loader block), never secrets.
// `group` starts the child in a process group of its own and kills the whole
// group, for a program that starts helpers (LibreOffice's soffice starts
// soffice.bin). Once the last unprivileged child has ended, every process the
// unprivileged user still has is killed before this settles (killStrays).
export function run(bin, args, { timeoutMs, capture = 'stdout', env = null, isolate = false, group = false } = {}) {
  return new Promise((resolve, reject) => {
    if (stopping) {
      reject(new Error('shutting down'));
      return;
    }
    const plan = spawnPlan(bin, args, { isolate });
    const opts = {
      env: { PATH, HOME: '/tmp', ...(env || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: group,
    };
    if (plan.ids) {
      opts.uid = plan.ids.uid;
      opts.gid = plan.ids.gid;
    }
    const dropped = isRoot();
    let child;
    try {
      child = spawn(plan.cmd, plan.argv, opts);
    } catch (e) {
      reject(e);
      return;
    }
    const kill = () => {
      try {
        if (group && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch (_) { /* already gone */ }
    };
    children.set(child, kill);
    if (dropped) unprivileged += 1;
    const out = [];
    const err = [];
    let settled = false;
    const finish = (fn, v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      children.delete(child);
      if (group) kill();
      if (!dropped) { fn(v); return; }
      unprivileged -= 1;
      if (unprivileged > 0) { fn(v); return; }
      killStrays().then((n) => {
        if (n) console.warn(`[media] killed ${n} process(es) left behind by ${bin}`);
      }, () => {}).finally(() => fn(v));
    };
    const timer = setTimeout(() => {
      kill();
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

// A job's folders: `dir`, the root process's own (it can't be renamed or
// swapped by anyone else), and `work` inside it, the one folder decoders may
// write. Whatever the root process takes back out of `work` it opens with
// openOwn.
export async function makeJobDir(prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  const work = join(dir, 'work');
  await mkdir(work, { mode: 0o700 });
  if (isRoot()) {
    await chmod(dir, 0o711);
    await chown(work, MEDIA_UID, MEDIA_GID);
  }
  return { dir, work };
}

// A file a decoder wrote, opened as the file it is: never through a symbolic
// link (O_NOFOLLOW), never a device, a pipe or a folder, and never a second
// name for some other file (one link only). A decoder a hostile file took
// over could otherwise leave its output pointing at a file only root can
// read, and have root upload it. Resolves with the open FileHandle and its
// size; the caller closes it.
export async function openOwn(path) {
  const fh = await open(path, FS.O_RDONLY | FS.O_NOFOLLOW | FS.O_NONBLOCK);
  try {
    const st = await fh.stat();
    if (!st.isFile() || st.nlink !== 1) throw new Error('not a file of its own');
    return { fh, size: st.size };
  } catch (e) {
    await fh.close().catch(() => {});
    throw e;
  }
}

// The whole of a file a decoder wrote (openOwn), for small ones.
export async function readOwn(path, maxBytes = 64 * 1024 * 1024) {
  const { fh, size } = await openOwn(path);
  try {
    if (size > maxBytes) throw new Error('too big to read back');
    const buf = Buffer.alloc(size);
    let got = 0;
    while (got < size) {
      const { bytesRead } = await fh.read(buf, got, size - got, got);
      if (!bytesRead) break;
      got += bytesRead;
    }
    return buf.subarray(0, got);
  } finally {
    await fh.close();
  }
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
