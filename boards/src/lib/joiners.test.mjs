import test from 'node:test';
import assert from 'node:assert/strict';
import { JOINING_SCRIPTS, VIRAMAS, keepsInvisible, dropStrayJoiners } from './joiners.js';
import * as email from '../../../supabase/functions/_shared/email/safeLabel.mjs';

// Every special character is built from code points, so no joiner sits in this
// file as a literal.
const cp = (...c) => String.fromCodePoint(...c);
const ZWNJ = cp(0x200c), ZWJ = cp(0x200d), VS16 = cp(0xfe0f);

test('the joining scripts and viramas are the ones safeLabel.mjs keeps', () => {
  assert.deepEqual(JOINING_SCRIPTS, email.JOINING_SCRIPTS);
  assert.deepEqual(VIRAMAS, email.VIRAMAS);
});

test('a joiner between letters of a joining script stays', () => {
  const persian = cp(0x645, 0x6cc) + ZWNJ + cp(0x62e, 0x648, 0x627, 0x647, 0x645);
  assert.equal(dropStrayJoiners(persian), persian);
  const conjunct = cp(0x915, 0x94d) + ZWJ + cp(0x937);
  assert.equal(dropStrayJoiners(conjunct), conjunct);
  const bengali = cp(0x9b0, 0x9cd) + ZWJ + cp(0x9af);
  assert.equal(dropStrayJoiners(bengali), bengali);
  const chillu = cp(0xd28, 0xd4d) + ZWJ;
  assert.equal(dropStrayJoiners(chillu), chillu, 'a ZWJ after a virama stays even at the end');
});

test('a joiner inside an emoji sequence stays', () => {
  for (const s of [
    cp(0x1f468) + ZWJ + cp(0x1f469) + ZWJ + cp(0x1f467),
    cp(0x1f3f3) + VS16 + ZWJ + cp(0x1f308),
    cp(0x1f469, 0x1f3fd) + ZWJ + cp(0x1f3a8),
    cp(0x2764) + VS16,
    '1' + VS16 + cp(0x20e3),
  ]) assert.equal(dropStrayJoiners(s), s);
});

test('a stray joiner is dropped, or replaced by what the caller asks for', () => {
  assert.equal(dropStrayJoiners('Lost' + ZWJ + 'Time'), 'LostTime');
  assert.equal(dropStrayJoiners('Lost' + ZWJ + 'Time', ' '), 'Lost Time');
  assert.equal(dropStrayJoiners(ZWNJ + 'Studio' + ZWNJ), 'Studio');
  assert.equal(dropStrayJoiners('ab' + ZWJ + ZWJ + 'cd'), 'abcd');
  assert.equal(dropStrayJoiners('Lost' + VS16 + 'Time'), 'LostTime');
  assert.equal(dropStrayJoiners(cp(0x645) + ZWNJ + '.com'), cp(0x645) + '.com', 'next to a dot');
  assert.equal(dropStrayJoiners('1' + VS16 + 'x'), '1x', 'a keycap base needs U+20E3 after it');
  assert.equal(dropStrayJoiners(null), '');
});

test('keepsInvisible agrees with safeLabel.mjs on what survives', () => {
  const samples = [
    cp(0x645, 0x6cc) + ZWNJ + cp(0x62e), cp(0x915, 0x94d) + ZWJ + cp(0x937), cp(0x1f468) + ZWJ + cp(0x1f469),
    'a' + ZWJ + 'b', 'a' + ZWNJ + 'b', cp(0x2764) + VS16 + 'x', 'x' + VS16, ZWJ, cp(0x645) + ZWNJ, cp(0x915, 0x94d) + ZWNJ,
  ];
  for (const s of samples) assert.equal(dropStrayJoiners(s), email.safeLabel(s, 60), JSON.stringify(s));
  assert.equal(keepsInvisible(0x200d, 'a', undefined, 'b'), false);
});
