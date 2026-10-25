import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewKindOfKey, viewKeys, isViewKey, VIEW_EDGE, VIEW_SM_EDGE } from './fileView.js';
import { mediaKindOfKey, isCopyKey } from './playCopy.js';

const WS = '0b6e2f0a-6c55-4b8e-9d0a-2a3f1c9e7b11';

test('the formats some browser can\'t draw get views; the ones every browser draws do not', () => {
  for (const ext of ['heic', 'HEIF', 'hif', 'tif', 'tiff', 'jxl', 'exr', 'jp2', 'j2k', 'jpf', 'jpx']) {
    assert.equal(viewKindOfKey(`${WS}/a.${ext}`), 'image', ext);
  }
  for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp', 'svg', 'psd', 'mov', 'pdf']) {
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

test('the small view is smaller than the view', () => {
  assert.ok(VIEW_SM_EDGE < VIEW_EDGE);
});
