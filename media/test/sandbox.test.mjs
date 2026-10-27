import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, symlink, link, mkdir, rm, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  spawnPlan, openOwn, readOwn, makeJobDir, killStrays, isStray, run, MEDIA_UID, MEDIA_GID,
} from '../src/ffmpeg.js';

test('as root a decoder runs as the unprivileged user; isolated, with no network and no way back up', () => {
  assert.deepEqual(spawnPlan('vips', ['x'], { root: false, isolate: true }), { cmd: 'vips', argv: ['x'], ids: null },
    'on a laptop, as ourselves');
  assert.deepEqual(spawnPlan('ffmpeg', ['-i', 'u'], { root: true }),
    { cmd: 'ffmpeg', argv: ['-i', 'u'], ids: { uid: MEDIA_UID, gid: MEDIA_GID } });
  const p = spawnPlan('soffice', ['--headless', 'f.docx'], { root: true, isolate: true });
  assert.equal(p.cmd, 'unshare');
  assert.equal(p.ids, null, 'started as root, so the namespace can be made; setpriv drops it after');
  assert.deepEqual(p.argv, ['-n', '--', 'setpriv', `--reuid=${MEDIA_UID}`, `--regid=${MEDIA_GID}`, '--clear-groups',
    '--no-new-privs', '--', 'soffice', '--headless', 'f.docx']);
});

test('what a decoder wrote is read back only as a file of its own: no link, no second name, no device', async () => {
  const d = await mkdtemp(join(tmpdir(), 'own-'));
  try {
    await writeFile(join(d, 'view.webp'), 'RIFF....WEBP');
    assert.equal((await readOwn(join(d, 'view.webp'))).toString(), 'RIFF....WEBP');
    const { fh, size } = await openOwn(join(d, 'view.webp'));
    assert.equal(size, 12);
    await fh.close();
    await writeFile(join(d, 'secret'), 'root only');
    await symlink(join(d, 'secret'), join(d, 'link.webp'));
    await assert.rejects(openOwn(join(d, 'link.webp')), 'a symbolic link is never followed');
    await link(join(d, 'secret'), join(d, 'hard.webp'));
    await assert.rejects(openOwn(join(d, 'hard.webp')), /not a file of its own/, 'a second name for another file');
    await mkdir(join(d, 'dir.webp'));
    await assert.rejects(openOwn(join(d, 'dir.webp')), 'a folder');
    execFileSync('mkfifo', [join(d, 'fifo.webp')]);
    await assert.rejects(openOwn(join(d, 'fifo.webp')), /not a file of its own/, 'a pipe, opened without waiting');
    await writeFile(join(d, 'big'), Buffer.alloc(10));
    await assert.rejects(readOwn(join(d, 'big'), 5), /too big/);
  } finally {
    await rm(d, { recursive: true, force: true });
  }
});

test('a job has a folder of its own with a work folder inside for the decoders', async () => {
  const { dir, work } = await makeJobDir('jobtest-');
  try {
    assert.equal(work, join(dir, 'work'));
    assert.ok((await stat(work)).isDirectory());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a stray is a live process of the unprivileged user, by any of its ids; a zombie is left to init', () => {
  const status = (state, uids) => `Name:\tgpgconf\nState:\t${state}\nTgid:\t2543\nPPid:\t1\nUid:\t${uids}\nGid:\t10001\t10001\t10001\t10001\n`;
  const own = `${MEDIA_UID}\t${MEDIA_UID}\t${MEDIA_UID}\t${MEDIA_UID}`;
  assert.equal(isStray(status('S (sleeping)', own)), true);
  assert.equal(isStray(status('R (running)', own)), true);
  assert.equal(isStray(status('D (disk sleep)', own)), true);
  assert.equal(isStray(status('S (sleeping)', `0\t0\t${MEDIA_UID}\t0`)), true, 'a saved id is enough');
  assert.equal(isStray(status('Z (zombie)', own)), false);
  assert.equal(isStray(status('X (dead)', own)), false);
  assert.equal(isStray(status('S (sleeping)', '0\t0\t0\t0')), false);
  assert.equal(isStray(''), false);
});

test('off root there are no strays to kill, and a group run is killed whole on its timeout', async () => {
  if (process.getuid?.() === 0) return;
  assert.equal(await killStrays(), 0);
  const started = Date.now();
  await assert.rejects(run('sh', ['-c', 'sleep 30 & sleep 30'], { timeoutMs: 300, group: true }), /timed out/);
  assert.ok(Date.now() - started < 5000);
  assert.equal((await run('sh', ['-c', 'echo ok'], { timeoutMs: 5000, isolate: true })).toString().trim(), 'ok');
});
