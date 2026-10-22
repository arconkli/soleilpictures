// Spotify links copied from a non-English client carry an /intl-xx/ locale
// segment and still embed as a player (CARDS-16).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectEmbed, safeEmbed } from './oembed.js';

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

// A card stores its embed as data; LinkCard renders it only through safeEmbed.
const PROVIDER_LINKS = [
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42',
  'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC',
  'https://vimeo.com/76979871',
  'https://www.tiktok.com/@someone/video/7234567890123456789',
  'https://www.instagram.com/p/Cabc123XYZ/',
  'https://x.com/someone/status/1234567890123456789',
];

test('every embed the detectors build is accepted as it is', () => {
  for (const link of PROVIDER_LINKS) {
    const embed = detectEmbed(link);
    assert.ok(embed, link);
    const shown = safeEmbed(embed);
    assert.ok(shown, link);
    assert.equal(shown.embedUrl, new URL(embed.embedUrl).href, link);
    assert.equal(shown.allow, embed.allow, link);
    assert.equal(shown.provider, embed.provider, link);
  }
});

test('a stored embed renders only from a known provider over https', () => {
  const base = detectEmbed(PROVIDER_LINKS[0]);
  const withUrl = (embedUrl) => ({ ...base, embedUrl });
  assert.equal(safeEmbed(withUrl('http://www.youtube.com/embed/dQw4w9WgXcQ')), null);
  assert.equal(safeEmbed(withUrl('ftp://www.youtube.com/embed/dQw4w9WgXcQ')), null);
  assert.equal(safeEmbed(withUrl('https://example.com/embed/dQw4w9WgXcQ')), null);
  assert.equal(safeEmbed(withUrl('https://www.youtube.com.example.com/embed/x')), null);
  assert.equal(safeEmbed(withUrl('https://user:pw@www.youtube.com/embed/x')), null);
  assert.equal(safeEmbed(withUrl('/embed/relative')), null);
  assert.equal(safeEmbed(withUrl('')), null);
  assert.equal(safeEmbed({ ...base, embedUrl: 42 }), null);
  assert.equal(safeEmbed(null), null);
  assert.equal(safeEmbed('https://www.youtube.com/embed/x'), null);
});

test('a stored embed keeps only the iframe features the providers use', () => {
  const base = detectEmbed(PROVIDER_LINKS[1]);
  assert.equal(safeEmbed({ ...base, allow: 'autoplay; camera; microphone; geolocation' }).allow, 'autoplay');
  assert.equal(safeEmbed({ ...base, allow: 'camera' }).allow, undefined);
  assert.equal(safeEmbed({ ...base, allow: undefined }).allow, undefined);
});
