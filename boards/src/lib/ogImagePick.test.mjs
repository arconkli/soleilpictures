import test from 'node:test';
import assert from 'node:assert/strict';
import { pickOgImage } from './ogImagePick.js';

const PAGE = 'https://example.com/post';

test('secure_url beats an http og:image', () => {
  assert.equal(pickOgImage({ 'og:image': 'http://example.com/a.jpg', 'og:image:secure_url': 'https://cdn.example.com/a.jpg' }, PAGE), 'https://cdn.example.com/a.jpg');
});

test('og:image, then the older fallbacks, in order', () => {
  assert.equal(pickOgImage({ 'og:image': 'https://x.test/1.jpg', 'twitter:image': 'https://x.test/2.jpg' }, PAGE), 'https://x.test/1.jpg');
  assert.equal(pickOgImage({ 'og:image:url': 'https://x.test/3.jpg', 'twitter:image': 'https://x.test/2.jpg' }, PAGE), 'https://x.test/3.jpg');
  assert.equal(pickOgImage({ 'twitter:image': 'https://x.test/2.jpg', 'twitter:image:src': 'https://x.test/4.jpg' }, PAGE), 'https://x.test/2.jpg');
  assert.equal(pickOgImage({ 'twitter:image:src': 'https://x.test/4.jpg' }, PAGE), 'https://x.test/4.jpg');
});

test('an http address becomes https, and a relative one is resolved first', () => {
  assert.equal(pickOgImage({ 'og:image': 'http://x.test/a.jpg' }, PAGE), 'https://x.test/a.jpg');
  assert.equal(pickOgImage({ 'og:image': '/a.jpg' }, 'http://x.test/post'), 'https://x.test/a.jpg');
});

test('nothing usable gives null', () => {
  assert.equal(pickOgImage({}, PAGE), null);
  assert.equal(pickOgImage(null, PAGE), null);
  assert.equal(pickOgImage({ 'og:image': '  ' }, PAGE), null);
  assert.equal(pickOgImage({ 'og:image': 'http://[bad' }, PAGE), null);
});
