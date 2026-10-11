// Spotify links copied from a non-English client carry an /intl-xx/ locale
// segment and still embed as a player (CARDS-16).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectEmbed } from './oembed.js';

test('a localized Spotify track link embeds like an English one', () => {
  const en = detectEmbed('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC');
  const fr = detectEmbed('https://open.spotify.com/intl-fr/track/4uLU6hMCjMI75M1A2tKUQC');
  assert.ok(en && fr);
  assert.equal(fr.embedUrl, en.embedUrl);
  assert.equal(fr.type, 'track');
});

test('a region-qualified locale and other types work too', () => {
  const pt = detectEmbed('https://open.spotify.com/intl-pt-BR/album/1DFixLWuPkv3KT3TnV35m3?si=abc');
  assert.equal(pt?.embedUrl, 'https://open.spotify.com/embed/album/1DFixLWuPkv3KT3TnV35m3');
});

test('a bare locale path is not an embed', () => {
  assert.equal(detectEmbed('https://open.spotify.com/intl-de/'), null);
});
