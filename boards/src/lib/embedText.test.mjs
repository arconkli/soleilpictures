import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { embedTextForCard, embedTextForLiveCard, clientEmbedsKind, embedHash } from './embedText.js';
import { buildCardIndexRow } from './cardIndexRow.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(here, rel), 'utf8');

// A note as the canvas holds it, and the card_index row the warmup reads for
// it: both writers must arrive at the same text, or each re-embeds over the
// other's row every session.
const note = {
  kind: 'note',
  title: 'Diner  scene',
  html: '<p>Mara waits at the <strong>diner</strong> counter.</p><p>Rain &amp; neon.</p>',
};
const get = (k) => note[k];

test('the canvas and the warmup embed a card from the same text', () => {
  const row = buildCardIndexRow({ workspaceId: 'w', boardId: 'b', cardId: 'c', get, groupNameById: {} });
  const fromIndex = embedTextForCard({ title: row.title, body: row.body });
  const fromCanvas = embedTextForLiveCard(note);
  assert.equal(fromCanvas, fromIndex);
  assert.equal(embedHash(fromCanvas), embedHash(fromIndex));
  assert.doesNotMatch(fromCanvas, /<|&amp;|\s{2}/, 'markup, entities and runs of spaces are gone');
});

test('board and group names never go into a card\'s stored text', () => {
  const t = embedTextForLiveCard({ ...note, boardName: 'Pricing', groupName: 'Act two' });
  assert.doesNotMatch(t, /Pricing|Act two/);
});

test('an image\'s description joins its text; images and videos are left to the server', () => {
  assert.equal(embedTextForCard({ title: 'Ref', body: '' }, 'Night exterior, neon, rain'), 'Ref Night exterior, neon, rain');
  assert.equal(clientEmbedsKind('image'), false);
  assert.equal(clientEmbedsKind('video'), false);
  assert.equal(clientEmbedsKind('note'), true);
});

test('every client writer of card_embeddings builds its text here', () => {
  assert.match(read('aiWarmup.js'), /embedTextForCard\(\{ title: c\.title, body: c\.body \}\)/);
  assert.match(read('aiWarmup.js'), /if \(!clientEmbedsKind\(c\.kind\)\) continue;/);
  assert.match(read('../components/CanvasSurface.jsx'), /embedText: embedTextForLiveCard\(c\)/);
  assert.match(read('../hooks/useAiTagger.js'), /getOrFetchCardEmbedding\(target\.id, embedSource\)/);
});

test('nothing is applied from an embedding; close matches are suggestions', () => {
  const tagger = read('../hooks/useAiTagger.js');
  assert.doesNotMatch(tagger, /score: 1\.0/, 'a 1.0 score is what the canvas auto-applies');
  const backfill = read('aiBackfill.js');
  assert.doesNotMatch(backfill, /tagCard\(|tagGroup\(|tagBoard\(|tagDocPage\(/);
  assert.match(backfill, /const toSuggest = \[\.\.\.silent, \.\.\.suggested\];/);
  // Centroids learn only from a person's tags and the word-match triggers'.
  assert.match(tagger, /const CENTROID_SOURCES = \['user', 'auto'\];/);
  assert.match(tagger, /\.in\('source', CENTROID_SOURCES\)/);
});
