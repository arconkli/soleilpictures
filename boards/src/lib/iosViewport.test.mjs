import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isIosLike, withMaxScaleOne } from './iosViewport.js';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPADOS = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

test('iPhone and iPadOS are iOS; Android and a Mac without touch are not', () => {
  assert.equal(isIosLike({ userAgent: IPHONE, maxTouchPoints: 5 }), true);
  assert.equal(isIosLike({ userAgent: IPADOS, maxTouchPoints: 5 }), true);
  assert.equal(isIosLike({ userAgent: IPADOS, maxTouchPoints: 0 }), false);
  assert.equal(isIosLike({ userAgent: ANDROID, maxTouchPoints: 5 }), false);
  assert.equal(isIosLike(null), false);
});

test('maximum-scale=1 is added once and the rest is kept', () => {
  const base = 'width=device-width, initial-scale=1.0, viewport-fit=cover';
  assert.equal(withMaxScaleOne(base), `${base}, maximum-scale=1`);
  assert.equal(withMaxScaleOne(withMaxScaleOne(base)), `${base}, maximum-scale=1`);
  assert.equal(withMaxScaleOne('width=device-width,maximum-scale=5'), 'width=device-width, maximum-scale=1');
  assert.equal(withMaxScaleOne(''), 'maximum-scale=1');
});
