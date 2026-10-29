// workerShowcase.test.mjs — GET /api/showcase-shot/<board>/<file>?s=<sig>, with
// the bucket and the secret faked.
//
//   node --test src/lib/workerShowcase.test.mjs
//
// What this guards:
//   * the signature is the one the database makes (migration 0820's
//     _showcase_shot_sig), pinned to a value Postgres computed, and it can never
//     pass as an email-card signature;
//   * only showcase/<uuid>/<plain file> with a known extension can be addressed;
//   * the signature is checked before the bucket is touched;
//   * headers (private, noindex, nosniff), downloads, 304, 405;
//   * worker.js routes the prefix here with the email-card secret.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  showcaseShotPath, showcaseShotSig, downloadName, SHOWCASE_TYPES, handleShowcaseShot,
} from '../worker-showcase.js';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BOARD = '11111111-2222-4333-8444-555555555555';
const SECRET = 'test-secret';
const BYTES = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);

function fakeEnv(files = { [`showcase/${BOARD}/desk-light.png`]: BYTES }) {
  const map = new Map(Object.entries(files));
  const reads = [];
  return {
    reads,
    env: {
      IMAGES: {
        get: async (k) => {
          reads.push(k);
          return map.has(k) ? { body: map.get(k), httpEtag: '"e1"' } : null;
        },
      },
    },
  };
}

async function call({ file = 'desk-light.png', sig, extra = '', method = 'GET', headers = {}, secret = async () => SECRET, files } = {}) {
  const s = sig === undefined ? await showcaseShotSig(SECRET, BOARD, file) : sig;
  const q = `${s === null ? '' : `s=${encodeURIComponent(s)}`}${extra}`;
  const url = new URL(`https://x.test/api/showcase-shot/${BOARD}/${file}?${q}`);
  const f = fakeEnv(files);
  const res = await handleShowcaseShot(url, new Request(url, { method, headers }), f.env, { secret });
  return { res, reads: f.reads };
}

test('the signature matches the one Postgres computes (migration 0820)', async () => {
  // Computed by Postgres pgcrypto with the derivation in 0820's
  // _showcase_shot_sig: this pins the Worker and the migration to one signature.
  assert.equal(await showcaseShotSig(SECRET, BOARD, 'desk-light.png'), '7852016664bfa9416ac509b0942317fa');
});

test('a showcase signature never equals an email-thumb signature for the same board', async () => {
  const enc = new TextEncoder();
  const keyBytes = await crypto.subtle.digest('SHA-256', enc.encode(`${SECRET}:email-thumb-v1`));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(`email-thumb:${BOARD}`));
  const email = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  assert.notEqual(await showcaseShotSig(SECRET, BOARD, 'desk-light.png'), email);
});

test('showcaseShotPath accepts a plain shot and lowercases the board id', () => {
  const ok = showcaseShotPath(`/api/showcase-shot/${BOARD}/desk-light.png`);
  assert.deepEqual(ok, { boardId: BOARD, file: 'desk-light.png', key: `showcase/${BOARD}/desk-light.png` });
  const up = showcaseShotPath(`/api/showcase-shot/${BOARD.toUpperCase()}/desk-light.png`);
  assert.equal(up.boardId, BOARD);
  assert.equal(up.key, `showcase/${BOARD}/desk-light.png`);
  for (const ext of Object.keys(SHOWCASE_TYPES)) {
    assert.ok(showcaseShotPath(`/api/showcase-shot/${BOARD}/a.${ext}`), ext);
  }
});

test('showcaseShotPath refuses anything that is not a plain known shot', () => {
  const P = `/api/showcase-shot/${BOARD}`;
  const bad = [
    '/api/showcase-shot/not-a-uuid/a.png',
    `${P}/a..b.png`,
    `${P}/../a.png`,
    `${P}/sub/a.png`,
    `${P}/a.png/extra`,
    `${P}/Desk.png`,
    `${P}/a.html`,
    `${P}/a.svg`,
    `${P}/a.js`,
    `${P}/a`,
    `${P}/.hidden.png`,
    `${P}/-dash.png`,
    `${P}/`,
    `${P}`,
    `${P}/..%2Fx.png`,
  ];
  for (const p of bad) assert.equal(showcaseShotPath(p), null, p);
  assert.equal(showcaseShotPath(''), null);
  assert.equal(showcaseShotPath(undefined), null);
});

test('a good signature serves the shot with private, noindex, nosniff headers', async () => {
  const { res, reads } = await call();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.match(res.headers.get('cache-control'), /^private/);
  assert.equal(res.headers.get('x-robots-tag'), 'noindex');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('etag'), '"e1"');
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), BYTES);
  assert.deepEqual(reads, [`showcase/${BOARD}/desk-light.png`]);
});

test('a wrong or missing signature is 403 and the bucket is never read', async () => {
  const wrong = await call({ sig: '0'.repeat(32) });
  assert.equal(wrong.res.status, 403);
  assert.deepEqual(wrong.reads, []);
  const missing = await call({ sig: null });
  assert.equal(missing.res.status, 403);
  assert.deepEqual(missing.reads, []);
});

test('a signature made for another file does not open this one', async () => {
  const other = await showcaseShotSig(SECRET, BOARD, 'phone.png');
  const { res, reads } = await call({ sig: other });
  assert.equal(res.status, 403);
  assert.deepEqual(reads, []);
});

test('no secret is 503 and the bucket is never read', async () => {
  for (const secret of [async () => { throw new Error('db down'); }, async () => '']) {
    const { res, reads } = await call({ secret });
    assert.equal(res.status, 503);
    assert.deepEqual(reads, []);
  }
});

test('a missing object is 404', async () => {
  const { res, reads } = await call({ files: {} });
  assert.equal(res.status, 404);
  assert.deepEqual(reads, [`showcase/${BOARD}/desk-light.png`]);
});

test('dl names the download and keeps the shot\'s own extension', async () => {
  const a = await call({ extra: `&dl=${encodeURIComponent('Japandi Living Room!!')}` });
  assert.equal(a.res.headers.get('content-disposition'), 'attachment; filename="Japandi-Living-Room.png"');
  const b = await call({ extra: '&dl=x.exe' });
  assert.equal(b.res.headers.get('content-disposition'), 'attachment; filename="x.png"');
  const plain = await call();
  assert.equal(plain.res.headers.get('content-disposition'), null);
  assert.equal(downloadName('', 'desk-light.png'), 'desk-light.png');
  assert.equal(downloadName(null, 'all.zip'), 'all.zip');
  assert.equal(downloadName('!!!', 'phone.webp'), 'phone.webp');
});

test('a zip is served as application/zip', async () => {
  const { res } = await call({ file: 'all.zip', files: { [`showcase/${BOARD}/all.zip`]: BYTES } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/zip');
});

test('if-none-match with the etag is 304', async () => {
  const { res } = await call({ headers: { 'if-none-match': '"e1"' } });
  assert.equal(res.status, 304);
});

test('anything but GET or HEAD is 405', async () => {
  const url = new URL(`https://x.test/api/showcase-shot/${BOARD}/desk-light.png`);
  const f = fakeEnv();
  const res = await handleShowcaseShot(url, new Request(url, { method: 'POST' }), f.env, { secret: async () => SECRET });
  assert.equal(res.status, 405);
  assert.deepEqual(f.reads, []);
});

test('worker.js routes /api/showcase-shot/ here with the email-card secret', () => {
  const w = readFileSync(resolve(SRC, 'worker.js'), 'utf8');
  assert.match(w, /import \{ handleShowcaseShot \} from '\.\/worker-showcase\.js';/);
  const i = w.indexOf("'/api/showcase-shot/'");
  assert.ok(i > 0, 'the route exists');
  const near = w.slice(i, i + 300);
  assert.match(near, /handleShowcaseShot\(url, request, env, \{ secret: \(\) => emailThumbSecret\(env\) \}\)/);
});
