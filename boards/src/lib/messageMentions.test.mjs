// COMMS-05: an @mention pill covers the name, not the rest of the sentence.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scanMentions, hasUnresolvedMention } from './messageMentions.js';

const pills = (segs) => segs.filter(s => 'mention' in s).map(s => s.text);
const text = (segs) => segs.map(s => s.text).join('');

test('a mentioned full name pills, and the sentence after it stays text', () => {
  const sam = { name: 'Sam Smith', kind: 'user', id: 'u1' };
  const segs = scanMentions('@Sam Smith can you check the lighting', [sam]);
  assert.deepEqual(pills(segs), ['@Sam Smith']);
  assert.equal(segs[0].mention, sam);
  assert.equal(segs[1].text, ' can you check the lighting');
  assert.equal(text(segs), '@Sam Smith can you check the lighting');
});

test('longest name wins, matching is case-insensitive, and names need a word boundary', () => {
  const t = [{ name: 'Sam' }, { name: 'Sam Smith' }];
  assert.deepEqual(pills(scanMentions('hey @sam smith, ok', t)), ['@sam smith']);
  assert.deepEqual(pills(scanMentions('@Samantha said hi', [{ name: 'Sam' }])), []);
});

test('an unresolved mention pills one word at most', () => {
  const segs = scanMentions('@Jordan can you look', [], { allowUnresolved: true });
  assert.deepEqual(pills(segs), ['@Jordan']);
  assert.equal(segs[0].mention, null);
  assert.deepEqual(pills(scanMentions('@Jordan can you look', [])), [], 'no mentions, no pills');
});

test('an email address is not a mention', () => {
  assert.deepEqual(pills(scanMentions('write to me@studio.com', [], { allowUnresolved: true })), []);
});

test('an attached entity title pills even with spaces in it', () => {
  const segs = scanMentions('see @Scene 12 Lighting for refs', [{ name: 'Scene 12 Lighting', kind: 'board' }]);
  assert.deepEqual(pills(segs), ['@Scene 12 Lighting']);
});

test('the bubble hands the renderer the mentioned people\'s names', () => {
  const bubble = readFileSync(new URL('../components/MessageBubble.jsx', import.meta.url), 'utf8');
  assert.match(bubble, /userNamesById/);
  const renderer = readFileSync(new URL('./renderMessageBody.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(renderer, /\[a-zA-Z0-9_'’\\- \]\{1,40\}/, 'the greedy space-eating regex is gone');
  assert.match(renderer, /scanMentions\(/);
});

test('a stray @word pills only while a mentioned person is still unresolved', () => {
  assert.equal(hasUnresolvedMention(['u1'], {}), true, 'Sam is still loading');
  assert.equal(hasUnresolvedMention(['u1'], { u1: ['Sam Smith', 'sam@x.com'] }), false);
  assert.equal(hasUnresolvedMention(['u1', 'u2'], { u1: 'Sam Smith' }), true);
  assert.equal(hasUnresolvedMention([], {}), false, 'no mentions, no pills');
  const renderer = readFileSync(new URL('./renderMessageBody.jsx', import.meta.url), 'utf8');
  assert.match(renderer, /allowUnresolved = hasUnresolvedMention\(ctx\.mentions, ctx\.userNamesById\)/);
});
