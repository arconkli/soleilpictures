import test from 'node:test';
import assert from 'node:assert/strict';
import { membersLine, conversationMatches, previewText, dmSubline } from './messagesCard.js';

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

test('previewText: the words, without the thread’s markdown', () => {
  assert.equal(previewText('**Call sheet** is up, see `v4`'), 'Call sheet is up, see v4');
  assert.equal(previewText('> No generators before 8am.\nSo we plan *around* it.'), 'No generators before 8am. So we plan around it.');
  assert.equal(previewText('- Bring ND filters\n- Check the permit\n2. Parking'), 'Bring ND filters Check the permit Parking');
  assert.equal(previewText('Call sheet draft:\n```\n05:45 van leaves\n06:30 crew call\n```'), 'Call sheet draft: 05:45 van leaves 06:30 crew call');
  assert.equal(previewText('2*3*4 stays'), '2*3*4 stays');
  assert.equal(previewText(''), '');
  assert.equal(previewText(null), '');
});

test('dmSubline: "Here now" only while they are', () => {
  assert.equal(dmSubline(true), 'Here now');
  assert.equal(dmSubline(false), '');
});
