import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reserveUploadSpace } from './uploadReserve.js';

test('a reservation is true, a full drive is false, anything else is unavailable (0610)', async () => {
  const calls = [];
  const rpc = (answer) => async (fn, params) => { calls.push({ fn, params }); if (answer instanceof Error) throw answer; return answer; };
  assert.equal(await reserveUploadSpace(rpc(true), { key: 'w/k.png', bytes: 5, boardId: 'b' }), 'reserved');
  assert.deepEqual(calls[0], { fn: 'record_upload_intent', params: { p_key: 'w/k.png', p_bytes: 5, p_kind: 'put', p_board_id: 'b' } });
  assert.equal(await reserveUploadSpace(rpc(false), { key: 'w/k.png', bytes: 5 }), 'full');
  for (const answer of [null, undefined, 'true', [true], new Error('down')]) {
    assert.equal(await reserveUploadSpace(rpc(answer), { key: 'w/k.png', bytes: 5 }), 'unavailable', String(answer));
  }
});

test('every Worker upload reserves its space before it writes the object', () => {
  const api = readFileSync(new URL('../worker-api.js', import.meta.url), 'utf8');
  for (const route of ["if (head === 'uploads' && method === 'POST') {", 'const declared = Number(res.headers.get(\'content-length\'));']) {
    const at = api.indexOf(route);
    assert.ok(at > 0, route);
    const reserveAt = api.indexOf('reserveUploadSpace(', at);
    const putAt = api.indexOf('env.IMAGES.put(', at);
    assert.ok(reserveAt > 0 && reserveAt < putAt, `${route}: reserved before the put`);
    assert.match(api.slice(reserveAt, putAt), /if \(held === 'full'\)[\s\S]*if \(held !== 'reserved'\)/, 'a refusal or a failure writes nothing');
  }
  const media = readFileSync(new URL('../worker-media.js', import.meta.url), 'utf8');
  assert.ok(media.indexOf('reserveUploadSpace(') < media.indexOf('env.IMAGES.put('), 'the web-picture save reserves first');
});
