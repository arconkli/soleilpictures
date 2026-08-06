// Scout's conversational replies (scout/src/answers.js) and progress narration
// (scout/src/progress.js).
//
// The rule these tests enforce: the model CLASSIFIES, it never COMPOSES. Every
// answer is hand-written, because a free-form LLM reply will happily invent
// capabilities and the person asking has no way to know it's wrong. "What can I
// send you?" answered wrong is a support ticket and a lost user.

import { expect, test } from '@playwright/test';
import {
  TOPICS, matchTopic, renderAnswer, fallbackAnswer, looksLikeQuestion, isValidTopic,
} from '../../scout/src/answers.js';
// From replies.js, not progress.js — progress.js imports the provider SDK, and
// the copy shouldn't need it.
import { STAGES } from '../../scout/src/replies.js';

const CTX = { boardName: 'Scout Inbox', url: 'https://x.test/s/abc', origin: 'https://x.test' };

test('the questions people actually ask are matched', () => {
  const cases = [
    ['how do you work?', 'how_it_works'],
    ['How does this work', 'how_it_works'],
    ['what can i upload', 'what_can_i_send'],
    ['what can i send you?', 'what_can_i_send'],
    ['can i send video', 'what_can_i_send'],
    ['where do my photos go', 'where_do_things_go'],
    ['i already have an account', 'own_board'],
    ['how much does this cost', 'pricing'],
    ['is this free?', 'pricing'],
    ['who can see my photos', 'privacy'],
    ['can i share this with my director', 'sharing'],
    ['does this work on android', 'android'],
    ['stop', 'stop'],
  ];
  for (const [text, expected] of cases) {
    expect(matchTopic(text), `"${text}"`).toBe(expected);
  }
});

test('the longest keyword wins, so specific questions beat generic ones', () => {
  // A bare "what" must not hijack "what can i upload".
  expect(matchTopic('so what can i upload exactly')).toBe('what_can_i_send');
  expect(matchTopic('what is this')).toBe('how_it_works');
});

test('every topic renders a real, non-empty answer', () => {
  for (const id of Object.keys(TOPICS)) {
    const out = renderAnswer(id, CTX);
    expect(out, id).toBeTruthy();
    expect(out.length, id).toBeGreaterThan(40);
    // Placeholders escaping into a user's thread is the failure mode here.
    expect(out, id).not.toMatch(/undefined|null|\[object|NaN/);
  }
});

test('answers never promise things the product cannot do', () => {
  const all = Object.keys(TOPICS).map((id) => renderAnswer(id, CTX)).join('\n').toLowerCase();
  // Scout is iMessage-only today, free-tier is 100 cards, and nothing here
  // edits video. Copy that drifts from that is worse than no copy.
  expect(all).not.toContain('unlimited photos');
  expect(all).not.toContain('edit video');
  expect(all).not.toContain('works on any phone');
});

test('the Android answer is honest rather than aspirational', () => {
  const out = renderAnswer('android', CTX).toLowerCase();
  expect(out).toContain('iphone');
  // Must route them somewhere useful instead of just saying no.
  expect(out).toContain(CTX.origin.toLowerCase());
});

test('question detection gates the classifier without eating real content', () => {
  for (const q of ['how do you work?', 'what can i send', 'is this free?', 'can i share this']) {
    expect(looksLikeQuestion(q), q).toBe(true);
  }
  for (const s of ['scene 4 diner', 'power drops look sketchy', 'the loading dock on 3rd', '']) {
    expect(looksLikeQuestion(s), s).toBe(false);
  }
});

test('an unrecognized question gets the menu, never a guess', () => {
  expect(matchTopic('zzzz qqqq')).toBe(null);
  const out = fallbackAnswer(CTX);
  expect(out).toContain('/help');
  expect(out).toContain('put these in');
});

test('only known topic ids are accepted from the classifier', () => {
  expect(isValidTopic('pricing')).toBe(true);
  expect(isValidTopic('none')).toBe(false);          // the model's "no match" token
  expect(isValidTopic('DROP TABLE')).toBe(false);
  expect(isValidTopic('')).toBe(false);
  expect(isValidTopic(null)).toBe(false);
});

test('progress copy is concrete about what was actually seen', () => {
  // "Got 12 photos" is the reassurance — it proves the bot saw all twelve.
  expect(STAGES.received({ images: 12, links: 0, notes: 0 })).toContain('12 photos');
  expect(STAGES.received({ images: 1, links: 0, notes: 0 })).toContain('1 photo');
  expect(STAGES.received({ images: 1, links: 0, notes: 0 })).not.toContain('1 photos');
  expect(STAGES.received({ images: 5, links: 1, notes: 1 })).toMatch(/5 photos.*1 link.*a note/);
  expect(STAGES.uploading(3, 12)).toContain('3 of 12');
  expect(STAGES.arranging('Diner Recce')).toContain('Diner Recce');
});
