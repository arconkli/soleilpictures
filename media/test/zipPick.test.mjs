import { test } from 'node:test';
import assert from 'node:assert/strict';
import { designEntry, entryWindow, ENTRY_MAX_BYTES } from '../src/zipPick.js';

const e = (path, size = 1000, extra = {}) => ({ path, dir: path.endsWith('/'), size, compressedSize: size, offset: 0, flags: 0, ...extra });
test('each design format\'s picture is found by its own path first, then by name', () => {
  assert.equal(designEntry([e('Data/doc.json'), e('previews/preview.png')], 'sketch').path, 'previews/preview.png');
  assert.equal(designEntry([e('preview.png', 10), e('mergedimage.png', 9000)], 'kra').path, 'mergedimage.png');
  assert.equal(designEntry([e('Thumbnails/thumbnail.png')], 'ora').path, 'Thumbnails/thumbnail.png');
  assert.equal(designEntry([e('quicklook/thumbnail.png')], 'procreate').path, 'quicklook/thumbnail.png');
  assert.equal(designEntry([e('QuickLook/Thumbnail.png')], 'procreat').path, 'QuickLook/Thumbnail.png', 'as the uploader stores it');
  assert.equal(designEntry([e('thumbnail.png'), e('canvas.fig')], 'fig').path, 'thumbnail.png');
  assert.equal(designEntry([e('a/thumb_small.jpg', 10), e('b/big-preview.png', 500)], 'xd').path, 'b/big-preview.png');
  assert.equal(designEntry([e('canvas.fig')], 'fig'), null);
  assert.equal(designEntry([e('previews/preview.png', ENTRY_MAX_BYTES + 1)], 'sketch'), null);
  assert.equal(designEntry([e('previews/preview.png', 10, { flags: 1 })], 'sketch'), null);
});
test('an entry\'s window covers its local header at its longest and its data, inside the file', () => {
  assert.deepEqual(entryWindow({ offset: 100, compressedSize: 50 }, 1_000_000), [100, 100 + 30 + 131070 + 50]);
  assert.deepEqual(entryWindow({ offset: 100, compressedSize: 50 }, 500), [100, 500]);
});
