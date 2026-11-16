import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mentionSegments, mentionsIn, filterMentionPeople, foldName, mentionQueryAt, mentionQuerySpaces, matchMentions, addedMentionIds } from './commentMentionText.js';

test('an edit names only the people it added', () => {
  assert.deepEqual(addedMentionIds(['u-a', 'u-b'], ['u-b', 'u-c', 'u-c']), ['u-c']);
  assert.deepEqual(addedMentionIds([{ id: 'u-a' }], [{ id: 'u-a' }, { id: 'u-d' }, null]), ['u-d']);
  assert.deepEqual(addedMentionIds(['u-a'], ['u-a']), []);
  assert.deepEqual(addedMentionIds(null, ['u-a']), ['u-a']);
  assert.deepEqual(addedMentionIds(['u-a'], null), []);
});

const JON = { id: 'u-jon', name: 'Jon' };
const JON_PARK = { id: 'u-jp', name: 'Jon Park' };
const MARA = { id: 'u-mara', name: 'Mara Okafor' };
const T = (text) => ({ type: 'text', text });
const M = (m) => ({ type: 'mention', id: m.id, name: m.name });

test('plain words are one piece of text', () => {
  assert.deepEqual(mentionSegments('No mentions here.', [MARA]), [T('No mentions here.')]);
  assert.deepEqual(mentionSegments('@Mara Okafor', []), [T('@Mara Okafor')]);
  assert.deepEqual(mentionSegments('', [MARA]), []);
  assert.deepEqual(mentionSegments(null, [MARA]), []);
});

test('a mention at the start, the middle and the end', () => {
  assert.deepEqual(mentionSegments('@Mara Okafor keep the practicals', [MARA]), [M(MARA), T(' keep the practicals')]);
  assert.deepEqual(mentionSegments('Ask @Mara Okafor, she knows.', [MARA]), [T('Ask '), M(MARA), T(', she knows.')]);
  assert.deepEqual(mentionSegments('cc @Mara Okafor', [MARA]), [T('cc '), M(MARA)]);
  assert.deepEqual(mentionSegments('line one\n@Jon\nline three', [JON]), [T('line one\n'), M(JON), T('\nline three')]);
});

test('only the people given count', () => {
  assert.deepEqual(mentionSegments('@Mara Okafor and @Dev Shah', [MARA]), [M(MARA), T(' and @Dev Shah')]);
});

test('the longest name wins', () => {
  assert.deepEqual(mentionSegments('@Jon Park and @Jon agree', [JON, JON_PARK]), [M(JON_PARK), T(' and '), M(JON), T(' agree')]);
  assert.deepEqual(mentionSegments('@Jon Park and @Jon agree', [JON_PARK, JON]), [M(JON_PARK), T(' and '), M(JON), T(' agree')]);
});

test('never inside a word', () => {
  assert.deepEqual(mentionSegments('mail@Jon for it', [JON]), [T('mail@Jon for it')]);
  assert.deepEqual(mentionSegments('@Jonathan is someone else', [JON]), [T('@Jonathan is someone else')]);
  assert.deepEqual(mentionSegments('@Jon_2 no', [JON]), [T('@Jon_2 no')]);
  assert.deepEqual(mentionSegments('é@Jon', [JON]), [T('é@Jon')]);
  // punctuation and brackets around a name are fine
  assert.deepEqual(mentionSegments('(@Jon) "@Jon"! @Jon.', [JON]), [T('('), M(JON), T(') "'), M(JON), T('"! '), M(JON), T('.')]);
  assert.deepEqual(mentionSegments('@@Jon', [JON]), [T('@'), M(JON)]);
});

test('names in other scripts and with accents', () => {
  const zoe = { id: 'z', name: 'Zoë Müller' };
  const yu = { id: 'y', name: '佐藤' };
  assert.deepEqual(mentionSegments('Hi @Zoë Müller!', [zoe]), [T('Hi '), M(zoe), T('!')]);
  assert.deepEqual(mentionSegments('@佐藤 ok', [yu]), [M(yu), T(' ok')]);
  assert.deepEqual(mentionSegments('@佐藤さん', [yu]), [T('@佐藤さん')]);
});

test('a name used twice, and malformed entries', () => {
  assert.deepEqual(mentionSegments('@Jon @Jon', [JON, { ...JON }, null, { id: '', name: 'X' }, { id: 'n', name: '' }]), [M(JON), T(' '), M(JON)]);
});

test('segments always rebuild the words exactly', () => {
  const body = 'A @Jon Park\n  b @Jon c@Jon @Mara Okafor.';
  const joined = mentionSegments(body, [JON, JON_PARK, MARA]).map((s) => (s.type === 'text' ? s.text : '@' + s.name)).join('');
  assert.equal(joined, body);
});

test('finding people as they are typed: accents off, case off, six at most', () => {
  assert.equal(foldName('Zoë MÜLLER'), 'zoe muller');
  const people = [
    { id: 1, name: 'Mara Okafor' }, { id: 2, name: 'Manon Leclerc' }, { id: 3, name: 'Tom Marsh' },
    { id: 4, name: 'Emma' }, { id: 5, name: 'Zoë Müller' }, { id: 6, name: 'Dev Shah' },
    { id: 7, name: 'Jun Park' }, { id: 8, name: 'Lena Ruiz' }, { id: 9, name: '' }, null,
  ];
  // starts-with, then a later word, then anywhere
  assert.deepEqual(filterMentionPeople(people, 'ma').map((p) => p.name), ['Mara Okafor', 'Manon Leclerc', 'Tom Marsh', 'Emma']);
  assert.deepEqual(filterMentionPeople(people, 'ZOE').map((p) => p.name), ['Zoë Müller']);
  assert.deepEqual(filterMentionPeople(people, 'mul').map((p) => p.name), ['Zoë Müller']);
  assert.deepEqual(filterMentionPeople(people, 'manon l').map((p) => p.name), ['Manon Leclerc']);
  assert.deepEqual(filterMentionPeople(people, 'xyz'), []);
  assert.equal(filterMentionPeople(people, '').length, 6);
  assert.equal(filterMentionPeople(people, '', 3).length, 3);
  assert.deepEqual(filterMentionPeople(null, 'a'), []);
});

test('the @word the caret is in', () => {
  assert.deepEqual(mentionQueryAt('Love it. @Ma', 12), { tokenStart: 9, query: 'Ma' });
  assert.deepEqual(mentionQueryAt('@', 1), { tokenStart: 0, query: '' });
  assert.deepEqual(mentionQueryAt('hi @Manon L', 11), { tokenStart: 3, query: 'Manon L' });
  assert.deepEqual(mentionQueryAt('line\n@jo', 8), { tokenStart: 5, query: 'jo' });
  assert.deepEqual(mentionQueryAt('(@jo', 4), { tokenStart: 1, query: 'jo' });
  // the caret, not the end of the text, decides
  assert.deepEqual(mentionQueryAt('@Mara and more', 3), { tokenStart: 0, query: 'Ma' });
  assert.equal(mentionQueryAt('mail@jo', 7), null);
  assert.equal(mentionQueryAt('@Mara Okafor ', 13), null, 'a picked name, then a space, is finished');
  assert.equal(mentionQueryAt('@a b c', 6), null);
  assert.equal(mentionQueryAt('no at sign', 5), null);
  assert.equal(mentionQueryAt('', 0), null);
});

test('a picked person whose name was deleted again is dropped on send', () => {
  assert.deepEqual(matchMentions('hi @Jon Park', [JON_PARK, MARA]), ['u-jp']);
});

test('what is sent and kept: the picked people whose chip is drawn, each once', () => {
  assert.deepEqual(mentionsIn('hi @Jon Park and @Mara Okafor, @Jon Park again', [MARA, JON_PARK]), [JON_PARK, MARA]);
  // "@Jonathan" draws no chip for Jon, so it sends no mention either
  assert.deepEqual(mentionsIn('@Jonathan and mail@Jon', [JON]), []);
  // the longer name wins, as it does for the chip
  assert.deepEqual(mentionsIn('@Jon Park', [JON, JON_PARK]), [JON_PARK]);
  // picked, then the words were deleted again
  assert.deepEqual(mentionsIn('no one here', [JON, MARA]), []);
  assert.deepEqual(mentionsIn('@Jon', [{ ...JON, avatar: 'x' }]), [{ id: 'u-jon', name: 'Jon' }]);
  assert.deepEqual(mentionsIn('', [JON]), []);
  assert.deepEqual(mentionsIn('@Jon', null), []);
});

test('a query holds as many spaces as the longest name offered', () => {
  const people = [{ id: 1, name: 'Ana María de la Cruz' }, { id: 2, name: 'Jon' }, { id: 3, name: '' }, null];
  assert.equal(mentionQuerySpaces(people), 4);
  assert.equal(mentionQuerySpaces([JON]), 0);
  assert.equal(mentionQuerySpaces(null), 0);
  assert.deepEqual(mentionQueryAt('@Ana María de l', 15, { spaces: 4 }), { tokenStart: 0, query: 'Ana María de l' });
  assert.equal(mentionQueryAt('@Ana María de l', 15), null, 'one space unless told');
  assert.equal(mentionQueryAt('@a b c d e f', 12, { spaces: 4 }), null);
  assert.deepEqual(mentionQueryAt('@Jo', 3, { spaces: 0 }), { tokenStart: 0, query: 'Jo' });
  assert.equal(mentionQueryAt('@Jon P', 6, { spaces: 0 }), null);
});

test('a picked name and a space is finished: the list stays shut', () => {
  assert.equal(mentionQueryAt('@Jon a', 6, { spaces: 2, picked: [JON] }), null);
  assert.equal(mentionQueryAt('hi @Mara Okafor keep', 20, { spaces: 2, picked: [MARA] }), null);
  // not picked: still a query
  assert.deepEqual(mentionQueryAt('@Jon a', 6, { spaces: 2 }), { tokenStart: 0, query: 'Jon a' });
  // the name alone, with no space yet, can still be narrowed ("Jon" -> "Jon Park")
  assert.deepEqual(mentionQueryAt('@Jon', 4, { spaces: 2, picked: [JON] }), { tokenStart: 0, query: 'Jon' });
  // a new "@" after a finished one opens as usual
  assert.deepEqual(mentionQueryAt('@Jon and @Ma', 12, { spaces: 2, picked: [JON] }), { tokenStart: 9, query: 'Ma' });
});
