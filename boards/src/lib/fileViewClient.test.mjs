import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestFileViews, viewMeta, viewCardPatch } from './fileViewClient.js';
import { _resetPlayCopyCooldown } from './playCopyClient.js';

const WS = '0b6e2f0a-6c55-4b8e-9d0a-2a3f1c9e7b11';
const HEIC = `${WS}/4f1c2d3e-0000-4000-8000-000000000003.heic`;
const done = (o = {}) => ({
  storage_path: HEIC, state: 'done', view_path: `${WS}/previews/x.heic.view.webp`, view_w: 2048, view_h: 1536,
  view_sm_path: `${WS}/previews/x.heic.view_sm.webp`, view_sm_w: 640, view_sm_h: 480, width: 4032, height: 3024, ...o,
});

test('only the photos that get views are asked about, on the converter\'s route', async () => {
  _resetPlayCopyCooldown();
  const sent = [];
  const fetchImpl = async (url, init) => {
    sent.push({ url, keys: JSON.parse(init.body).keys });
    return new Response(JSON.stringify({ states: { [HEIC]: 'queued' } }), { headers: { 'content-type': 'application/json' } });
  };
  const states = await requestFileViews([HEIC, HEIC, `${WS}/a.jpg`, `${WS}/b.mov`], { getToken: async () => 't', fetchImpl });
  assert.deepEqual(states, { [HEIC]: 'queued' });
  assert.deepEqual(sent, [{ url: '/api/media/copy/request', keys: [HEIC] }]);
  assert.deepEqual(await requestFileViews([`${WS}/a.jpg`], { getToken: async () => 't', fetchImpl }), {});
  assert.equal(sent.length, 1, 'nothing to ask, nothing sent');
  assert.deepEqual(await requestFileViews([HEIC], { getToken: async () => null, fetchImpl }), {}, 'signed out');
});

test('a finished view becomes its original\'s preview, small preview and size', () => {
  assert.deepEqual(viewMeta(done()), {
    previewKey: `${WS}/previews/x.heic.view.webp`, previewW: 2048, previewH: 1536,
    previewSmKey: `${WS}/previews/x.heic.view_sm.webp`, previewSmW: 640, previewSmH: 480,
    checked: true, w: 4032, h: 3024,
  });
  const small = viewMeta(done({ view_sm_path: null, view_sm_w: null, view_sm_h: null, width: null, height: null }));
  assert.equal(small.previewSmKey, null);
  assert.equal('w' in small, false, 'an unknown size is not written over one the meta has');
  assert.equal(viewMeta(done({ state: 'working' })), null);
  assert.equal(viewMeta(done({ view_path: null })), null);
  assert.equal(viewMeta(null), null);
});

test('a card still at the 4:3 placeholder takes the photo\'s shape; any other card keeps its own', () => {
  const card = (o = {}) => ({ id: 'c', kind: 'image', src: `r2:${HEIC}`, w: 320, h: 240, ...o });
  assert.deepEqual(viewCardPatch(card(), done({ width: 3024, height: 4032 })), { w: 320, h: 427 }, 'portrait');
  assert.deepEqual(viewCardPatch(card(), done({ width: 1920, height: 1080 })), { w: 320, h: 180 });
  assert.deepEqual(viewCardPatch(card({ w: 640, h: 480 }), done({ width: 1000, height: 1000 })), { w: 640, h: 640 }, 'resized, still 4:3');
  assert.deepEqual(viewCardPatch(card(), done()), {}, 'a 4:3 photo: nothing to change');
  assert.deepEqual(viewCardPatch(card({ h: 300 }), done({ width: 3024, height: 4032 })), {}, 'someone chose this shape');
  assert.deepEqual(viewCardPatch(card(), done({ width: 10000, height: 1000 })), { w: 800, h: 80 }, 'a panorama keeps 80 high');
  assert.deepEqual(viewCardPatch(card(), done({ width: 1000, height: 10000 })), { w: 120, h: 1200 }, 'a strip stops at 1200');
  assert.deepEqual(viewCardPatch(card(), done({ width: null, height: null, view_w: 1536, view_h: 2048 })), { w: 320, h: 427 },
    'the view\'s shape when the size is unknown');
  assert.deepEqual(viewCardPatch(card({ src: `r2:${WS}/other.heic` }), done({ width: 3024, height: 4032 })), {}, 'another file');
  assert.deepEqual(viewCardPatch(card({ kind: 'file' }), done({ width: 3024, height: 4032 })), {});
  assert.deepEqual(viewCardPatch(card(), done({ state: 'failed' })), {});
});
