import test from 'node:test';
import assert from 'node:assert/strict';
import { membersLine, conversationMatches } from './messagesCard.js';

test('membersLine: first names, you last; a big group counts the rest', () => {
  assert.equal(membersLine([]), 'Just you');
  assert.equal(membersLine(['Lena Fischer']), 'Lena and you');
  assert.equal(membersLine(['Lena Fischer', 'Jon Park', 'Sam Okafor']), 'Lena, Jon, Sam and you');
  assert.equal(membersLine(['Lena', 'Jon', 'Sam', 'Priya', 'Maya']), 'Lena, Jon and 4 others');
  assert.equal(membersLine(['', null, 'Jon']), 'Jon and you');
});

test('conversationMatches: every word, anywhere, any case', () => {
  const c = { title: 'Casting · Feature film', names: ['Lena Fischer', 'Jon Park'], preview: 'Callbacks moved to Thursday' };
  assert.equal(conversationMatches(c, ''), true);
  assert.equal(conversationMatches(c, 'casting'), true);
  assert.equal(conversationMatches(c, 'LENA thursday'), true);
  assert.equal(conversationMatches(c, 'lena friday'), false);
  assert.equal(conversationMatches({}, 'x'), false);
  assert.equal(conversationMatches(undefined, ''), true);
});
