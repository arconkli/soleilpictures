// The crawlable article for /c/<slug>. Pure data-in/data-out, and until now
// untested.
//
// The case that motivated the file: `audio` had no branch in itemHtml, so it
// fell through to the `note` default — which returns an EMPTY STRING when the
// card has no body. A published sample pack was, to a crawler and to an AI
// agent, a page of nothing. Nothing failed; it just rendered no content.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildPageModel, renderArticleHtml, formatDate } from './publicPageModel.js';

const model = (cards, meta = {}) =>
  buildPageModel({ slug: 's', name: 'Pack', seo_title: 'Pack', ...meta }, cards, []);
const html = (cards, meta) => renderArticleHtml(model(cards, meta));

const audioCard = (over = {}) => ({
  card_id: 'a1', kind: 'audio', title: 'Orchid Kick',
  audio: { duration: 2, bpm: 140, key: 'Amin', format: 'WAV' },
  ...over,
});

test('an audio card renders its metadata line, not nothing', () => {
  const out = html([audioCard()]);
  assert.match(out, /Orchid Kick/);
  assert.match(out, /0:02/);
  assert.match(out, /140 BPM/);
  assert.match(out, /A min/, 'the page must say what the card says, not the canonical form');
  assert.match(out, /WAV/);
  assert.match(out, /class="pa-audio"/);
});

test('a card with no tempo or key still renders its title', () => {
  const out = html([audioCard({ audio: { duration: 12.5 } })]);
  assert.match(out, /Orchid Kick/);
  assert.match(out, /0:12/);
  assert.doesNotMatch(out, /BPM/);
});

test('an audio card with NO metadata at all is still not empty', () => {
  // Every card written before the tempo/key projection existed looks like this.
  const out = html([audioCard({ audio: null })]);
  assert.match(out, /Orchid Kick/);
  assert.match(out, /class="pa-audio"/);
});

test('an untitled audio card falls back to a word, not a blank', () => {
  const out = html([audioCard({ title: null, audio: null })]);
  assert.match(out, /Audio/);
});

test('a Scout voice memo puts its transcript in the crawlable body', () => {
  // The transcript is the only searchable thing a voice note has.
  const out = html([audioCard({ title: 'Memo', body: 'the diner on third', audio: { duration: 8 } })]);
  assert.match(out, /the diner on third/);
});

test('titles and metadata are escaped', () => {
  const out = html([audioCard({ title: '<script>x</script>', audio: { duration: 1, key: '<b>' } })]);
  assert.doesNotMatch(out, /<script>/);
  assert.match(out, /&lt;script&gt;/);
});

test('a malformed duration or tempo does not leak NaN into the page', () => {
  for (const audio of [{ duration: 'abc', bpm: 'x' }, { duration: NaN, bpm: NaN },
                       { duration: -5, bpm: null }, { duration: 0 }]) {
    const out = html([audioCard({ audio })]);
    assert.doesNotMatch(out, /NaN|undefined|Infinity/, JSON.stringify(audio));
  }
});

test('audio cards group into sections like every other kind', () => {
  const m = model([
    { card_id: 'h', kind: 'note', section_header: true, body: 'Drums\nkicks and snares' },
    audioCard({ card_id: 'a2' }),
  ]);
  assert.equal(m.sections.length, 1);
  assert.equal(m.sections[0].heading, 'Drums');
  assert.equal(m.sections[0].items.length, 1);
  assert.equal(m.sections[0].items[0].kind, 'audio');
});

test('the other kinds still render what they rendered', () => {
  assert.match(html([{ card_id: 'v', kind: 'video', title: 'Clip' }]), /class="pa-video"/);
  assert.match(html([{ card_id: 'n', kind: 'note', body: 'hello' }]), /class="pa-note"/);
  assert.match(html([{ card_id: 'p', kind: 'palette', title: 'Tones', swatches: [{ name: 'Ink', hex: '#000' }] }]),
    /class="pa-palette"/);
  // A note with no body renders nothing — the behaviour audio was inheriting.
  assert.doesNotMatch(html([{ card_id: 'n2', kind: 'note', body: '' }]), /pa-note/);
});

// The Worker injects itemHtml's output into #seo-fallback; PublicArticle
// renders the same model in React. They must say the SAME WORDS — that parity
// IS the anti-cloaking rule, and nothing else enforces it for the audio case.
// This compares the two implementations' metadata line by reading the JSX.
test('the React article and the crawlable HTML build the same audio line', async () => {
  const src = await readFile(new URL('../components/PublicArticle.jsx', import.meta.url), 'utf8');
  const start = src.indexOf("case 'audio'");
  assert.ok(start > 0, 'PublicArticle must have an audio case');
  const jsx = src.slice(start, start + 1400);
  // Every field the crawlable version pushes must be pushed here too, the
  // same way — including formatKey, which is what makes both say "A min"
  // rather than one saying "A min" and the other "Amin".
  for (const bit of ['a.duration', 'a.bpm', 'a.key', 'a.format', 'formatKey(a.key)']) {
    assert.ok(jsx.includes(bit), `PublicArticle's audio case is missing ${bit}`);
  }
  assert.ok(jsx.includes('BPM'), 'the BPM unit must match the crawlable version');
});

test('formatDate', () => {
  assert.equal(formatDate('2026-09-20'), 'September 20, 2026');
  assert.equal(formatDate(''), '');
  // Anything that isn't an ISO date passes through untouched rather than
  // becoming "Invalid Date" on a public page. Pinning the existing behaviour.
  assert.equal(formatDate('nonsense'), 'nonsense');
});
