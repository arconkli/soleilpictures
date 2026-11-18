import { test } from 'node:test';
import assert from 'node:assert/strict';
import { embedTextForCard, clientEmbedsKind } from './embedText.js';
import { buildCardIndexRow } from './cardIndexRow.js';

// A note as the canvas holds it, and the card_index row the embedders read for it.
const note = {
  kind: 'note',
  title: 'Diner  scene',
  html: '<p>Mara waits at the <strong>diner</strong> counter.</p><p>Rain &amp; neon.</p>',
};
const get = (k) => note[k];

test('a card is embedded from its card_index text, without markup', () => {
  const row = buildCardIndexRow({ workspaceId: 'w', boardId: 'b', cardId: 'c', get, groupNameById: {} });
  const text = embedTextForCard({ title: row.title, body: row.body });
  assert.doesNotMatch(text, /<|&amp;|\s{2}/, 'markup, entities and runs of spaces are gone');
});

test('an image\'s description joins its text; images and videos are left to the server', () => {
  assert.equal(embedTextForCard({ title: 'Ref', body: '' }, 'Night exterior, neon, rain'), 'Ref Night exterior, neon, rain');
  assert.equal(clientEmbedsKind('image'), false);
  assert.equal(clientEmbedsKind('video'), false);
  assert.equal(clientEmbedsKind('note'), true);
});
