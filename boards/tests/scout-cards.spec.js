// Unit tests for Scout's card composition (lib/scoutCards.js). Pure +
// dependency-free, so it runs straight in the Playwright Node process.
//
// The thing worth pinning down is NON-OVERLAP. Scout drops a burst of photos
// onto a canvas the user may already have hundreds of cards on, from a server
// with no viewport — if placement is wrong, someone's existing work gets buried
// and there's no undo story for a bot write. Everything else here is guarding
// against a texted string reaching the canvas unescaped.

import { expect, test } from '@playwright/test';
import {
  composeBatch, buildLinkCard, buildImageCard, imageCardSize,
  textToNoteHtml, extractUrls, textWithoutUrls, escapeHtml,
} from '../src/lib/scoutCards.js';

const rectsOverlap = (a, b) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function assertNoOverlap(cards) {
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      expect(
        rectsOverlap(cards[i], cards[j]),
        `card ${cards[i].id} overlaps ${cards[j].id}`,
      ).toBe(false);
    }
  }
}

const img = (w, h) => ({ key: `ws/${Math.random().toString(36).slice(2)}.jpg`, width: w, height: h });

test('a batch of photos never overlaps itself', () => {
  const cards = composeBatch({
    existingCards: [],
    images: Array.from({ length: 12 }, () => img(4032, 3024)),
  });
  expect(cards).toHaveLength(12);
  assertNoOverlap(cards);
});

test('a batch never lands on top of existing cards', () => {
  // A crowded board, including a card far down the canvas.
  const existing = [
    { x: 0, y: 0, w: 400, h: 300 },
    { x: 500, y: 200, w: 300, h: 400 },
    { x: 120, y: 1800, w: 600, h: 500 },
  ];
  const cards = composeBatch({
    existingCards: existing,
    images: Array.from({ length: 8 }, () => img(3000, 4000)),
    noteText: 'check the power drops at the diner',
    topic: 'Scene 4 — Diner',
  });
  for (const c of cards) {
    for (const e of existing) {
      expect(rectsOverlap(c, e), `${c.id} collided with existing content`).toBe(false);
    }
  }
  assertNoOverlap(cards.filter((c) => !c.sectionHeader));
});

test('mixed media in one burst stays disjoint', () => {
  const cards = composeBatch({
    existingCards: [{ x: 0, y: 0, w: 200, h: 200 }],
    images: [img(4032, 3024), img(1080, 1920)],
    urls: [
      { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
      { url: 'https://example.com/a-location-listing' },
    ],
    noteText: 'gate code is 4417',
  });
  assertNoOverlap(cards.filter((c) => !c.sectionHeader));
  expect(cards.every((c) => Number.isFinite(c.x) && Number.isFinite(c.y))).toBe(true);
  expect(cards.every((c) => c.x >= 0 && c.y >= 0)).toBe(true);
});

test('an empty burst produces no cards', () => {
  expect(composeBatch({ existingCards: [], images: [], urls: [] })).toEqual([]);
  // A topic alone is not content — no orphan header.
  expect(composeBatch({ existingCards: [], topic: 'Scene 4' })).toEqual([]);
});

test('section header spans the batch and sits above it', () => {
  const cards = composeBatch({
    existingCards: [],
    images: Array.from({ length: 5 }, () => img(3000, 2000)),
    topic: 'Scene 4 — Diner',
  });
  const header = cards.find((c) => c.sectionHeader);
  const body = cards.filter((c) => !c.sectionHeader);
  expect(header).toBeTruthy();
  expect(header.y).toBeLessThan(Math.min(...body.map((c) => c.y)));
  const maxRight = Math.max(...body.map((c) => c.x + c.w));
  expect(header.w).toBeGreaterThanOrEqual(maxRight - header.x - 1);
});

test('recognised providers become embeds, other links become previews', () => {
  const yt = buildLinkCard('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  expect(yt.embed).toBeTruthy();
  expect(yt.embed.provider).toBe('youtube');

  const plain = buildLinkCard('https://example.com/some/page');
  expect(plain.embed).toBeUndefined();
  // Falls back to the hostname so the card isn't a naked URL.
  expect(plain.title).toBe('example.com');
  expect(plain.source).toBe('https://example.com/some/page');
});

test('og metadata widens the link card', () => {
  const withImg = buildLinkCard('https://example.com/x', { title: 'A Diner', image: 'https://i/x.jpg' });
  const withoutImg = buildLinkCard('https://example.com/x', { title: 'A Diner' });
  expect(withImg.title).toBe('A Diner');
  expect(withImg.h).toBeGreaterThan(withoutImg.h);
});

test('image cards preserve aspect ratio within the contact-sheet box', () => {
  // Cards MUST fit inside arrangeInFreeSpace's 320x300 cell clamp
  // (canvasGeom.js:62) or they overflow and collide with their neighbours.
  const landscape = imageCardSize(4032, 3024);
  expect(landscape.w).toBeGreaterThan(landscape.h);
  expect(landscape.w).toBeLessThanOrEqual(320);
  expect(landscape.h).toBeLessThanOrEqual(300);
  expect(Math.abs(landscape.w / landscape.h - 4032 / 3024)).toBeLessThan(0.02);

  const portrait = imageCardSize(3024, 4032);
  expect(portrait.h).toBeGreaterThan(portrait.w);
  expect(portrait.h).toBeLessThanOrEqual(300);

  // A panorama must stay grabbable AND stay inside the box.
  const sliver = imageCardSize(4000, 40);
  expect(Math.min(sliver.w, sliver.h)).toBeGreaterThanOrEqual(80);
  expect(sliver.w).toBeLessThanOrEqual(320);
  expect(sliver.h).toBeLessThanOrEqual(300);

  // Never upscale — a small image stays small rather than turning blurry.
  const small = imageCardSize(120, 90);
  expect(small.w).toBe(120);
  expect(small.h).toBe(90);

  // Unknown dimensions (some inbound media reports none) must not produce NaN.
  const unknown = imageCardSize(0, 0);
  expect(Number.isFinite(unknown.w) && Number.isFinite(unknown.h)).toBe(true);
});

test('provider embeds are fitted into the same box', () => {
  // A Twitter embed defaults to 480x520 — larger than a grid cell.
  const tweet = buildLinkCard('https://twitter.com/someone/status/1234567890');
  expect(tweet.embed).toBeTruthy();
  expect(tweet.w).toBeLessThanOrEqual(320);
  expect(tweet.h).toBeLessThanOrEqual(300);
});

test('image cards reference R2 with the r2: scheme', () => {
  const c = buildImageCard({ key: 'ws-1/abc.jpg', width: 100, height: 100, alt: 'diner' });
  expect(c.kind).toBe('image');
  expect(c.src).toBe('r2:ws-1/abc.jpg');
  expect(c.alt).toBe('diner');
});

test('texted content is escaped before it reaches a canvas', () => {
  // Inbound text is untrusted and lands on a board others may view.
  const html = textToNoteHtml('<script>alert(1)</script> & "quoted"');
  expect(html).not.toContain('<script>');
  expect(html).toContain('&lt;script&gt;');
  expect(html).toContain('&amp;');
  expect(escapeHtml(`<img src=x onerror=y>`)).not.toContain('<img');
});

test('urls are extracted and stripped from the leftover note text', () => {
  const text = 'look at https://example.com/a and https://vimeo.com/123 for the diner';
  expect(extractUrls(text)).toEqual(['https://example.com/a', 'https://vimeo.com/123']);
  const rest = textWithoutUrls(text);
  expect(rest).not.toContain('http');
  expect(rest).toContain('diner');
});

test('trailing punctuation is not captured as part of a url', () => {
  expect(extractUrls('see https://example.com/page.')).toEqual(['https://example.com/page']);
  expect(extractUrls('dupe https://a.com and https://a.com')).toEqual(['https://a.com']);
});
