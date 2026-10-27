import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestFileViews, viewMeta, viewCardPatch, viewFileCardPatch, viewSize } from './fileViewClient.js';
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

test('a file card holding a photo turns into its picture card, at its own width, once there is a picture', () => {
  const ARW = `${WS}/4f1c2d3e-0000-4000-8000-000000000009.ARW`;
  const card = {
    id: 'file-1', kind: 'file', fileSrc: `r2:${ARW}`, fileName: 'DSC00412.ARW', mime: 'image/x-sony-arw',
    sizeBytes: 24_000_000, ext: 'arw', x: 40, y: 60, w: 240, h: 150, title: 'Dusk, take 2',
  };
  // A landscape photo: the width kept, the height its shape. The card's other
  // fields are left as they are (a patch never names them).
  assert.deepEqual(viewFileCardPatch(card, { w: 6048, h: 4024 }),
    { kind: 'image', src: `r2:${ARW}`, w: 240, h: 160, fileSrc: null });
  // A portrait one grows down from the same width.
  assert.deepEqual(viewFileCardPatch(card, { w: 3024, h: 4032 }),
    { kind: 'image', src: `r2:${ARW}`, w: 240, h: 320, fileSrc: null });
  // A panorama stays inside the canvas's 80 to 1200.
  assert.deepEqual(viewFileCardPatch({ ...card, w: 240 }, { w: 12000, h: 2000 }).h, 80);
  assert.deepEqual(viewFileCardPatch({ ...card, w: 1100 }, { w: 1000, h: 3000 }), {
    kind: 'image', src: `r2:${ARW}`, w: 400, h: 1200, fileSrc: null,
  });
  // A card with no width of its own gets a file card's.
  assert.equal(viewFileCardPatch({ ...card, w: undefined }, { w: 300, h: 200 }).w, 240);
  // A .psd, an OpenEXR, a TIFF a system gave no type: the same.
  for (const name of ['comp.psd', 'big.psb', 'plate.exr', 'scan.tif']) {
    assert.equal(viewFileCardPatch({ ...card, fileSrc: `r2:${WS}/${name}` }, { w: 400, h: 300 }).kind, 'image', name);
  }
  // Nothing turns without the photo's size, and nothing that isn't a photo's
  // file card, or one that stays a file card, turns at all.
  assert.deepEqual(viewFileCardPatch(card, { w: null, h: 300 }), {});
  assert.deepEqual(viewFileCardPatch(card, null), {});
  for (const other of [
    { ...card, fileSrc: `r2:${WS}/pack.zip` }, { ...card, fileSrc: `r2:${WS}/a.jpg` },
    { ...card, pending: true }, { ...card, locked: true },
    { ...card, versions: [{ fileSrc: `r2:${ARW}`, id: 'v1' }] }, { ...card, fileSrc: 'blob:x' },
    { ...card, kind: 'image', src: `r2:${ARW}` },
    // A document's card shows its first page and stays a file card.
    { ...card, fileSrc: `r2:${WS}/brief.docx` }, { ...card, fileSrc: `r2:${WS}/Deck.key` },
  ]) assert.deepEqual(viewFileCardPatch(other, { w: 400, h: 300 }), {});
});

test('a view\'s row gives the photo\'s own size, else the view\'s', () => {
  assert.deepEqual(viewSize(done()), { w: 4032, h: 3024 });
  assert.deepEqual(viewSize(done({ width: null, height: 0 })), { w: 2048, h: 1536 });
  assert.deepEqual(viewSize(null), { w: null, h: null });
});
