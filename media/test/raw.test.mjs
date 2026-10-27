import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  biggestPreview, orientationOf, rawSize, infoArgs, extractArgs, orientArgs, developArgs, developedPath, PREVIEW_TAGS,
} from '../src/raw.js';

// What exiftool -json -n said of real files (raw.pixls.us samples, 2026-10-26).
const SONY = { PreviewImage: '(Binary data 1150105 bytes, use -b option to extract)',
  ThumbnailImage: '(Binary data 10456 bytes, use -b option to extract)', Orientation: 1, ImageSize: '6048 4024' };
const NIKON = { JpgFromRaw: '(Binary data 5333539 bytes, use -b option to extract)',
  PreviewImage: '(Binary data 148888 bytes, use -b option to extract)',
  OtherImage: '(Binary data 1098664 bytes, use -b option to extract)', Orientation: 1, ImageSize: '8288 5520' };
const IPHONE = { PreviewImage: '(Binary data 5364435 bytes, use -b option to extract)',
  OtherImage: '(Binary data 146585 bytes, use -b option to extract)', Orientation: 6, ImageSize: '4032 3024' };

test('the biggest embedded JPEG is the one lifted out, whichever tag the camera keeps it in', () => {
  assert.equal(biggestPreview(SONY), 'PreviewImage');
  assert.equal(biggestPreview(NIKON), 'JpgFromRaw');
  assert.equal(biggestPreview(IPHONE), 'PreviewImage');
  assert.equal(biggestPreview({ ThumbnailImage: '(Binary data 9 bytes, use -b option to extract)' }), 'ThumbnailImage');
  assert.equal(biggestPreview({ PreviewImage: 'not binary', Comment: '(Binary data 999999 bytes' }), null, 'only the preview tags');
  assert.equal(biggestPreview({}), null);
  assert.equal(biggestPreview(null), null);
});

test('the orientation and size come from the raw, never anything out of range', () => {
  assert.equal(orientationOf(IPHONE), 6);
  assert.equal(orientationOf({ Orientation: 9 }), null);
  assert.equal(orientationOf({ Orientation: 'Rotate 90 CW' }), null, '-n gives numbers');
  assert.equal(orientationOf({}), null);
  assert.deepEqual(rawSize(NIKON), { w: 8288, h: 5520 });
  assert.deepEqual(rawSize({ ImageSize: '6000x4000' }), { w: 6000, h: 4000 });
  assert.equal(rawSize({ ImageSize: '0 10' }), null);
  assert.equal(rawSize({ ImageSize: '1e9 10' }), null);
  assert.equal(rawSize({}), null);
});

test('exiftool and LibRaw are asked exactly this, the file always last', () => {
  assert.deepEqual(infoArgs('/t/source.arw'), ['-json', '-n', '-q', '-q',
    ...PREVIEW_TAGS.map((t) => `-${t}`), '-Orientation', '-ImageSize', '/t/source.arw']);
  assert.deepEqual(extractArgs('/t/source.arw', 'PreviewImage'), ['-b', '-q', '-q', '-PreviewImage', '/t/source.arw']);
  assert.deepEqual(orientArgs('/t/embedded.jpg', 6), ['-q', '-q', '-n', '-m', '-overwrite_original', '-Orientation=6', '/t/embedded.jpg']);
  assert.deepEqual(developArgs('/t/source.dng'), ['-h', '-w', '-o', '1', '-T', '-Z', 'tiff', '/t/source.dng']);
  assert.equal(developedPath('/t/source.dng'), '/t/source.tiff');
  assert.equal(developedPath('/t/source.3fr'), '/t/source.tiff');
});
