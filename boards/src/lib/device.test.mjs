// Unit tests for the device classifier. Pure function, no DOM — run with:
//   node --test boards/src/lib/device.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUserAgent } from './device.js';

const UA = {
  iphone:   'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  ipad:     'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  androidP: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  androidT: 'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  winChrome:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  winEdge:  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
  winFox:   'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  macSafari:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15',
};

test('iPhone → mobile / iOS / Safari', () => {
  assert.deepEqual(parseUserAgent(UA.iphone), { device_type: 'mobile', os: 'iOS', browser: 'Safari' });
});
test('iPad → tablet / iOS / Safari (despite the Mobile token)', () => {
  assert.deepEqual(parseUserAgent(UA.ipad), { device_type: 'tablet', os: 'iOS', browser: 'Safari' });
});
test('Android phone → mobile / Android / Chrome', () => {
  assert.deepEqual(parseUserAgent(UA.androidP), { device_type: 'mobile', os: 'Android', browser: 'Chrome' });
});
test('Android tablet (no Mobile token) → tablet / Android / Chrome', () => {
  assert.deepEqual(parseUserAgent(UA.androidT), { device_type: 'tablet', os: 'Android', browser: 'Chrome' });
});
test('Windows Chrome → desktop / Windows / Chrome', () => {
  assert.deepEqual(parseUserAgent(UA.winChrome), { device_type: 'desktop', os: 'Windows', browser: 'Chrome' });
});
test('Windows Edge → Edge wins over the Chrome token', () => {
  assert.deepEqual(parseUserAgent(UA.winEdge), { device_type: 'desktop', os: 'Windows', browser: 'Edge' });
});
test('Windows Firefox → desktop / Windows / Firefox', () => {
  assert.deepEqual(parseUserAgent(UA.winFox), { device_type: 'desktop', os: 'Windows', browser: 'Firefox' });
});
test('macOS Safari (no touch) → desktop / macOS / Safari', () => {
  assert.deepEqual(parseUserAgent(UA.macSafari, null, null, 0), { device_type: 'desktop', os: 'macOS', browser: 'Safari' });
});
test('iPadOS-as-Mac (Macintosh UA + touch points) → tablet / iOS', () => {
  const r = parseUserAgent(UA.macSafari, null, null, 5);
  assert.equal(r.device_type, 'tablet');
  assert.equal(r.os, 'iOS');
});
test('Capacitor native iOS → mobile / iOS regardless of UA', () => {
  const r = parseUserAgent('some-webview-ua', null, 'ios', 0);
  assert.equal(r.device_type, 'mobile');
  assert.equal(r.os, 'iOS');
});
test('UA-Client-Hints mobile:true forces mobile', () => {
  const r = parseUserAgent(UA.winChrome, { mobile: true }, null, 0);
  assert.equal(r.device_type, 'mobile');
});
test('empty UA → safe defaults', () => {
  assert.deepEqual(parseUserAgent(''), { device_type: 'desktop', os: 'other', browser: 'other' });
});
