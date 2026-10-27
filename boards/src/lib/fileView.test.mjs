import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  viewKindOfKey, viewKeys, isViewKey, drawsNowhere, viewKeyOfCard, VIEW_EDGE, VIEW_SM_EDGE, RAW_EXTS, PSD_EXTS,
} from './fileView.js';
import { mediaKindOfKey, isCopyKey } from './playCopy.js';

const WS = '0b6e2f0a-6c55-4b8e-9d0a-2a3f1c9e7b11';

test('the formats some browser can\'t draw get views; the ones every browser draws do not', () => {
  for (const ext of ['heic', 'HEIF', 'hif', 'tif', 'tiff', 'jxl', 'exr', 'jp2', 'j2k', 'jpf', 'jpx',
    'arw', 'CR3', 'cr2', 'nef', 'raf', 'orf', 'rw2', 'dng', 'pef', 'srw', 'x3f', 'psd', 'psb']) {
    assert.equal(viewKindOfKey(`${WS}/a.${ext}`), 'image', ext);
  }
  for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp', 'svg', 'mov', 'pdf', 'docx', 'raw', 'ai']) {
    assert.equal(viewKindOfKey(`${WS}/a.${ext}`), null, ext);
  }
  assert.equal(viewKindOfKey(`${WS}/noext`), null);
  assert.equal(viewKindOfKey(''), null);
  assert.equal(viewKindOfKey(null), null);
});

test('a view sits beside its original, keeps its extension, and is never an original itself', () => {
  const k = `${WS}/4f1c2d3e-0000-4000-8000-000000000001.heic`;
  assert.deepEqual(viewKeys(k), {
    view: `${WS}/previews/4f1c2d3e-0000-4000-8000-000000000001.heic.view.webp`,
    sm: `${WS}/previews/4f1c2d3e-0000-4000-8000-000000000001.heic.view_sm.webp`,
  });
  assert.notEqual(viewKeys(`${WS}/a.heic`).view, viewKeys(`${WS}/a.tif`).view, 'same name, other format: other view');
  assert.ok(isViewKey(viewKeys(k).view) && isViewKey(viewKeys(k).sm));
  assert.equal(viewKindOfKey(viewKeys(k).view), null);
  assert.equal(viewKindOfKey(`${WS}/previews/x.tif`), null, 'nothing under previews/ is an original');
  assert.ok(!isViewKey(`${WS}/previews/4f1c2d3e-0000-4000-8000-000000000001.webp`), 'a browser-made preview is not a view');
  assert.ok(!isCopyKey(viewKeys(k).view) && mediaKindOfKey(viewKeys(k).view) === null, 'nor a playable copy');
});

test('every raw and Photoshop extension is a short lowercase one, and none is a format a browser draws', () => {
  for (const ext of [...RAW_EXTS, ...PSD_EXTS]) {
    assert.match(ext, /^[a-z0-9]{2,4}$/, ext);
    assert.equal(viewKindOfKey(`${WS}/a.${ext}`), 'image', ext);
  }
  assert.equal(new Set([...RAW_EXTS, ...PSD_EXTS]).size, RAW_EXTS.length + PSD_EXTS.length, 'no extension twice');
});

test('raws, Photoshop documents and OpenEXR are drawn by no browser; HEIC, TIFF and the rest by Safari', () => {
  for (const ext of ['arw', 'CR3', 'dng', 'psd', 'psb', 'exr']) assert.equal(drawsNowhere(`${WS}/a.${ext}`), true, ext);
  for (const ext of ['heic', 'tif', 'jxl', 'jp2', 'jpg', 'png', 'mov']) assert.equal(drawsNowhere(`${WS}/a.${ext}`), false, ext);
  assert.equal(drawsNowhere(viewKeys(`${WS}/a.arw`).view), false, 'a view is drawn everywhere');
  assert.equal(drawsNowhere(null), false);
});

test('the small view is smaller than the view', () => {
  assert.ok(VIEW_SM_EDGE < VIEW_EDGE);
});

test('the file a card shows that gets views: an image card\'s, or a file card\'s that can turn into a picture', () => {
  const ws = '0b6e2f0a-6c55-4b8e-9d0a-2a3f1c9e7b11';
  assert.equal(viewKeyOfCard({ kind: 'image', src: `r2:${ws}/a.heic` }), `${ws}/a.heic`);
  assert.equal(viewKeyOfCard({ kind: 'file', fileSrc: `r2:${ws}/DSC1.ARW` }), `${ws}/DSC1.ARW`);
  assert.equal(viewKeyOfCard({ kind: 'file', fileSrc: `r2:${ws}/comp.psd` }), `${ws}/comp.psd`);
  for (const card of [
    { kind: 'image', src: `r2:${ws}/a.jpg` }, { kind: 'file', fileSrc: `r2:${ws}/pack.zip` },
    { kind: 'image', src: `r2:${ws}/a.heic`, pending: true }, { kind: 'file', fileSrc: 'blob:x' },
    { kind: 'file', fileSrc: `r2:${ws}/DSC1.ARW`, locked: true },
    { kind: 'file', fileSrc: `r2:${ws}/DSC1.ARW`, versions: [{ fileSrc: `r2:${ws}/old.zip`, id: 'v1' }] },
    { kind: 'video', src: `r2:${ws}/a.heic` }, { kind: 'file', src: `r2:${ws}/DSC1.ARW` }, null,
  ]) assert.equal(viewKeyOfCard(card), '', JSON.stringify(card));
  // An image card with versions still shows its current file.
  assert.equal(viewKeyOfCard({ kind: 'image', src: `r2:${ws}/b.tif`, versions: [{ src: `r2:${ws}/a.tif`, id: 'v1' }] }), `${ws}/b.tif`);
});
