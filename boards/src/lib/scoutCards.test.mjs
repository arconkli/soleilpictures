// Building and placing the cards a texted burst becomes.
//
// Everything here is deterministic on purpose — the model upstream decided what
// the batch is ABOUT; this decides what cards exist and where they sit, so the
// spatial result is reproducible and debuggable.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  imageCardSize, buildImageCard, buildMediaCard, buildNoteCard, buildLinkCard,
  extractUrls, textWithoutUrls, textToNoteHtml, escapeHtml, composeBatch,
  placeSubtitle, cardColor,
} from './scoutCards.js';
import { cardIndexBody, cardIndexTitle, buildCardMeta } from './cardIndexRow.js';

const get = (card) => (k) => card[k];

// ── Geometry ────────────────────────────────────────────────────────────────

test('a photo is fitted into the contact-sheet box and never upscaled', () => {
  // Cards must fit inside arrangeInFreeSpace's grid cells (clamped 320×300) —
  // anything larger overflows its cell and collides with its neighbours.
  const big = imageCardSize(4032, 3024);
  assert.ok(big.w <= 320 && big.h <= 300, `${big.w}x${big.h} must fit the box`);
  // A small image stays small rather than becoming a blurry 320px tile.
  const small = imageCardSize(120, 90);
  assert.deepEqual(small, { w: 120, h: 90 });
});

test('a panorama is bumped off being an ungrabbable sliver', () => {
  const pano = imageCardSize(8000, 400);
  assert.ok(Math.min(pano.w, pano.h) >= 80, `short edge ${pano.h} must be grabbable`);
  assert.ok(pano.w <= 320 && pano.h <= 300);
});

test('unknown dimensions get a sane default rather than NaN', () => {
  assert.deepEqual(imageCardSize(null, null), { w: 280, h: 210 });
  assert.deepEqual(imageCardSize(0, 0), { w: 280, h: 210 });
});

// ── Photos ──────────────────────────────────────────────────────────────────

test('what the user SAID about a photo lands in a field search actually reads', () => {
  // cardIndexBody reads `body` then `caption`, and reads `alt` never. A photo
  // texted with "scene 4 diner" was correctly labelled on the canvas and
  // simultaneously invisible to search, the public page and the API.
  const card = buildImageCard({ key: 'ws/a.jpg', width: 400, height: 300, alt: 'scene 4 diner' });
  assert.equal(card.alt, 'scene 4 diner');
  assert.equal(card.caption, 'scene 4 diner');
  assert.equal(cardIndexBody('image', get(card)), 'scene 4 diner');
});

test('colour, capture time and coordinates ride on the card', () => {
  const card = buildImageCard({
    key: 'ws/a.jpg', width: 400, height: 300, alt: null,
    lab: { L: 0.61234567, a: -0.02, b: 0.09 },
    shotAt: '2026-08-11T09:14:02.000Z',
    geo: [34.09812, -118.32901],
  });
  assert.deepEqual(cardColor(card), { L: 0.6123, a: -0.02, b: 0.09 });
  assert.equal(card.shotAt, '2026-08-11T09:14:02.000Z');
  assert.deepEqual(card.geo, [34.09812, -118.32901]);
  // Absent metadata leaves no empty keys behind to travel between boards.
  const bare = buildImageCard({ key: 'ws/b.jpg', width: 10, height: 10, alt: null });
  assert.ok(!('geo' in bare) && !('shotAt' in bare) && !('lab' in bare));
});

// ── Everything that is not a photo ──────────────────────────────────────────

test('a voice note carries its transcript where search will find it', () => {
  const card = buildMediaCard(
    { kind: 'audio', src: 'r2:ws/a.m4a', duration: 12.5 },
    { transcript: 'the diner on third has a good back booth' },
  );
  assert.equal(card.kind, 'audio');
  assert.equal(card.src, 'r2:ws/a.m4a');
  assert.equal(card.duration, 12.5);
  assert.equal(cardIndexBody('audio', get(card)), 'the diner on third has a good back booth');
  assert.deepEqual(buildCardMeta('audio', get(card)), { src: 'r2:ws/a.m4a', duration: 12.5 });
});

test('a video keeps its aspect and its poster', () => {
  const card = buildMediaCard({
    kind: 'video', src: 'r2:ws/a.mp4', poster: 'r2:ws/p.jpg',
    width: 1920, height: 1080, duration: 8,
  });
  assert.equal(card.poster, 'r2:ws/p.jpg');
  assert.ok(card.w >= 240 && card.w <= 560, `width ${card.w} inside the canvas window`);
  assert.ok(Math.abs(card.w / card.h - 16 / 9) < 0.05, 'aspect preserved');
  // A portrait clip must get a portrait card, or the moodboard packs it into a
  // wrongly-shaped hole.
  const vertical = buildMediaCard({ kind: 'video', src: 'r2:x', width: 1080, height: 1920 });
  assert.ok(vertical.h > vertical.w, 'a vertical clip gets a vertical card');
});

test('a PDF uses pdfSrc and a file uses fileSrc — the fields the app reads', () => {
  const pdf = buildMediaCard({ kind: 'pdf', src: 'r2:ws/a.pdf' }, { title: 'Location release.pdf' });
  assert.equal(pdf.pdfSrc, 'r2:ws/a.pdf');
  assert.equal(pdf.src, null, 'src is where a page-1 raster would go');
  assert.equal(cardIndexTitle(get(pdf)), 'Location release.pdf');

  const file = buildMediaCard({
    kind: 'file', src: 'r2:ws/a.zip', name: 'plates.zip', mimeType: 'application/zip', size: 4096,
  });
  assert.equal(file.fileSrc, 'r2:ws/a.zip');
  assert.equal(file.fileName, 'plates.zip');
  assert.equal(file.sizeBytes, 4096);
  assert.equal(file.ext, 'zip');
  // Indexed under the only string anybody knows it by.
  assert.equal(cardIndexTitle(get(file)), 'plates.zip');
});

// ── Text and links ──────────────────────────────────────────────────────────

test('inbound text is escaped — it lands on a canvas other people may view', () => {
  const html = textToNoteHtml('<script>alert(1)</script>');
  assert.ok(!html.includes('<script'), html);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.equal(escapeHtml(`a&b<c>"d"'e'`), 'a&amp;b&lt;c&gt;&quot;d&quot;&#39;e&#39;');
});

test('urls are pulled out once and stripped from the note', () => {
  const t = 'look at https://example.com/a and https://example.com/a again';
  assert.deepEqual(extractUrls(t), ['https://example.com/a']);
  assert.equal(textWithoutUrls(t), 'look at and again');
  // Trailing sentence punctuation is not part of the url.
  assert.deepEqual(extractUrls('see https://example.com/a.'), ['https://example.com/a']);
});

test('an unrecognised link becomes a preview card titled by its host', () => {
  const card = buildLinkCard('https://www.example.com/some/page');
  assert.equal(card.kind, 'link');
  assert.equal(card.title, 'example.com');
  assert.equal(card.link, 'https://www.example.com/some/page');
});

// ── Placement ───────────────────────────────────────────────────────────────

const rectsOverlap = (a, b) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('a batch never covers a card that is already on the board', () => {
  const existing = [{ id: 'old', x: 0, y: 0, w: 400, h: 400 }];
  const laid = composeBatch({
    existingCards: existing,
    images: Array.from({ length: 8 }, (_, i) => ({ key: `ws/${i}.jpg`, width: 400, height: 300 })),
    noteText: 'check the power drops',
    topic: 'Scene 4 — Diner',
  });
  assert.ok(laid.length >= 9, 'header + 8 photos + note');
  for (const c of laid) {
    assert.ok(!rectsOverlap(existing[0], c), `${c.id} covers the existing card`);
  }
  for (let i = 0; i < laid.length; i++) {
    for (let j = i + 1; j < laid.length; j++) {
      assert.ok(!rectsOverlap(laid[i], laid[j]), `${laid[i].id} overlaps ${laid[j].id}`);
    }
  }
});

test('the section header reserves its own room on an EMPTY board', () => {
  // Squeezing it in afterwards collides, because the body already starts at the
  // top margin when there is nothing to sit below.
  const laid = composeBatch({
    existingCards: [],
    images: [{ key: 'ws/a.jpg', width: 400, height: 300 }],
    topic: 'Ext. Warehouse Night',
  });
  const header = laid.find((c) => c.sectionHeader);
  const photo = laid.find((c) => c.kind === 'image');
  assert.ok(header && photo);
  assert.ok(!rectsOverlap(header, photo), 'the header must not sit on the photo');
  assert.ok(header.y < photo.y, 'the header goes above the batch');
});

test('a batch of mixed kinds is composed in one pass', () => {
  const laid = composeBatch({
    existingCards: [],
    images: [{ key: 'ws/a.jpg', width: 400, height: 300 }],
    media: [
      { up: { kind: 'video', src: 'r2:v', width: 1920, height: 1080 } },
      { up: { kind: 'audio', src: 'r2:a' }, transcript: 'power drops look sketchy' },
      { up: { kind: 'pdf', src: 'r2:p' }, title: 'release.pdf' },
    ],
    urls: [{ url: 'https://example.com', preview: null }],
    noteText: 'back booth',
  });
  assert.deepEqual(
    laid.map((c) => c.kind).sort(),
    ['audio', 'image', 'link', 'note', 'pdf', 'video'],
  );
  for (const c of laid) {
    assert.ok(Number.isFinite(c.x) && Number.isFinite(c.y), `${c.kind} has no position`);
  }
});

test('nothing in means nothing out', () => {
  assert.deepEqual(composeBatch({ existingCards: [], images: [] }), []);
});

// ── Location ────────────────────────────────────────────────────────────────

test('a batch is placed by the MEDIAN coordinate, not the mean', () => {
  // A scouting run is a cluster around one place plus, often, one frame taken
  // from the car. A mean is dragged into the road by that outlier.
  const sub = placeSubtitle([
    { geo: [34.1, -118.3] }, { geo: [34.1002, -118.3001] }, { geo: [34.1001, -118.3002] },
    { geo: [40.7, -74.0] },   // the one taken from the car, 4,000 km away
  ]);
  // Median of an even count averages the middle two: lat (34.1001+34.1002)/2,
  // lon (-118.3001+-118.3)/2. The New York outlier moves neither.
  assert.match(sub, /^34\.10015, -118\.30005 · https:\/\/maps\.apple\.com\//);
  assert.ok(!sub.includes('-74'), 'the outlier must not drag the location');
  assert.equal(placeSubtitle([{ key: 'no geo' }]), null);
  assert.equal(placeSubtitle([]), null);
});
