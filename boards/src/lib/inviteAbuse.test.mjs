// The 2026-09-20 invite abuse, and getting our mail back out of spam
// (migrations 0358 and 0359, supabase/functions/_shared/email/safeLabel.mjs).
//
// Two accounts named a cluster with a phishing lure and a link, then invited a
// pasted list of strangers to it. share_board had no limit, and the invite
// email put the cluster's name in its subject line, from the sending domain
// that also carries sign-in codes and lifecycle mail. What closed it, and what
// these tests pin:
//   - every name someone typed is cleaned before it reaches an email
//   - both invite RPCs spend a daily budget and check for a ban first
//   - nobody can forge a notification row (and through it, an email)
//   - lifecycle mail stops going to people who never open it
//   - the picture win-back is back, retimed, and measured against a holdout
//
// Behavioural where the code can run under node (safeLabel.mjs is plain JS for
// exactly this reason), source-level for SQL and the Deno templates.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { latestDefinition, latestPolicy, migrationFiles, MIGRATIONS_DIR } from './migrationText.mjs';
import { safeLabel, safePerson } from '../../../supabase/functions/_shared/email/safeLabel.mjs';
import { dropStrayJoiners } from './joiners.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const templates = read('../../../supabase/functions/_shared/email/templates.ts');
const URLISH = /https?:|www\.|\b[\p{L}\p{N}-]+\.(?:com|ru|google|ly|app|net|org|рф)\b/iu;

// ── The sanitizer ───────────────────────────────────────────────────────────

test('safeLabel takes the link out, whatever it is wearing', () => {
  const cases = [
    'Approved for a payout. Log in- https://calendar.app.google/am9NAGPQx3hQwC2s9',
    'visit calendar.app.google/xyz now',
    'ｗｗｗ．ｓｃａｍ．ｃｏｍ big prize', // full-width www.scam.com
    'prize at scam。com today',                                                        // ideographic full stop
    'prize at scam․com today',                                                        // one-dot leader
    'win at bit.ly/abc',
    'яндекс.рф деньги',
    'HTTP://SHOUTING.EXAMPLE/x',
  ];
  for (const c of cases) {
    const out = safeLabel(c, 60, 'a cluster');
    assert.doesNotMatch(out, URLISH, `${JSON.stringify(c)} kept a link: ${JSON.stringify(out)}`);
    assert.doesNotMatch(out, /\.(?:com|ru|ly|google)\b/i, `${JSON.stringify(c)} kept a domain: ${JSON.stringify(out)}`);
  }
  // The lead-in a removed link leaves behind goes too.
  assert.equal(safeLabel('Approved for a payout. Log in- https://x.example/y'), 'Approved for a payout. Log in');
});

test('safeLabel keeps ordinary names, strips newlines, caps the length', () => {
  assert.equal(safeLabel('Storyboard v2.0'), 'Storyboard v2.0');
  assert.equal(safeLabel("Mr. Smith's lookbook"), "Mr. Smith's lookbook");
  assert.equal(safeLabel('Spring shoot — day 2'), 'Spring shoot — day 2');
  // CR/LF in a subject line is a header-injection primitive.
  assert.doesNotMatch(safeLabel('Line one\r\nBcc: someone'), /[\r\n]/);
  const long = safeLabel('x'.repeat(200), 60);
  assert.equal([...long].length, 60);
  assert.ok(long.endsWith('…'), 'a capped name says it was capped');
  // Nothing usable left → the caller's fallback.
  assert.equal(safeLabel('https://only-a-link.example/path', 60, 'a cluster'), 'a cluster');
  assert.equal(safeLabel(null, 60, 'a workspace'), 'a workspace');
});

test('an invisible character cannot hide a link from safeLabel', () => {
  // A URL parser deletes these and still reaches the host, so the matcher must
  // not be split by them (0360's review: the lure survived with any of these).
  const lure = 'calendar.app.google/am9NAGPQx3hQwC2s9';
  for (const cp of [0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0x00ad, 0x034f, 0x202e, 0x2066, 0xe0020, 0xfe0f]) {
    const hidden = 'Prize ' + lure.replaceAll('.', String.fromCodePoint(cp) + '.');
    const out = safeLabel(hidden, 60, 'a cluster');
    assert.equal(out, 'Prize', `U+${cp.toString(16)} kept the link: ${JSON.stringify(out)}`);
    // And hidden after the dot.
    const after = 'Prize ' + lure.replaceAll('.', '.' + String.fromCodePoint(cp));
    const outAfter = safeLabel(after, 60, 'a cluster');
    assert.equal(outAfter, 'Prize', `U+${cp.toString(16)} after the dot kept the link: ${JSON.stringify(outAfter)}`);
  }
});

// Names in any script survive. Every special character is built with
// String.fromCodePoint so no joiner or bidi control sits in this file as a
// literal.
const cpx = (...c) => String.fromCodePoint(...c);
const ZWNJ = cpx(0x200c), ZWJ = cpx(0x200d), VS16 = cpx(0xfe0f);

test('safeLabel keeps the joiners and dots a name in any script needs', () => {
  const rows = [
    ['Persian ZWNJ', cpx(0x645, 0x6cc) + ZWNJ + cpx(0x62e, 0x648, 0x627, 0x647, 0x645)],
    ['Persian title', cpx(0x67e, 0x631, 0x648, 0x698, 0x647) + ZWNJ + cpx(0x647, 0x627)],
    ['Hindi ZWJ', cpx(0x915, 0x94d) + ZWJ + cpx(0x937)],
    ['Hindi ZWNJ', cpx(0x915, 0x94d) + ZWNJ + cpx(0x937)],
    ['Bengali ra-phala', cpx(0x9b0, 0x9cd) + ZWJ + cpx(0x9af)],
    ['Malayalam chillu', cpx(0xd28, 0xd4d) + ZWJ],
    ['family', cpx(0x1f468) + ZWJ + cpx(0x1f469) + ZWJ + cpx(0x1f467) + ' Family'],
    ['rainbow flag', cpx(0x1f3f3) + VS16 + ZWJ + cpx(0x1f308) + ' Pride shoot'],
    ['skin tone', cpx(0x1f469, 0x1f3fd) + ZWJ + cpx(0x1f3a8) + ' Artists'],
    ['heart', cpx(0x2764) + VS16 + ' Love'],
    ['keycap', '1' + VS16 + cpx(0x20e3) + ' First'],
    // Japanese and Chinese prose put a full stop before more text.
    ['Japanese sentence', cpx(0x64ae, 0x5f71, 0x306f, 0x7d42, 0x4e86, 0x3002, 0x6b21, 0x306f, 0x5927, 0x962a)],
    ['Japanese + Latin word', cpx(0x64ae, 0x5f71, 0x7d42, 0x4e86, 0x3002) + 'Netflix' + cpx(0x3067, 0x914d, 0x4fe1)],
    ['Chinese', cpx(0x7b2c, 0x4e00, 0x573a, 0x3002, 0x7b2c, 0x4e8c, 0x573a)],
    ['Japanese two sentences', cpx(0x4eca, 0x65e5, 0x306f, 0x6674, 0x308c, 0x3002, 0x660e, 0x65e5, 0x306f, 0x96e8, 0x3002)],
    ['Latin word, full stop, Japanese', 'Tokyo' + cpx(0x3002, 0x6771, 0x4eac, 0x652f, 0x793e)],
    // Not look-alike dots: the Catalan middle dot and the katakana separator.
    ['Catalan l.l', 'Col' + cpx(0xb7) + 'legi'],
    ['katakana separator', cpx(0x30c8, 0x30e0, 0x30fb, 0x30cf, 0x30f3, 0x30af, 0x30b9)],
  ];
  for (const [name, s] of rows) assert.equal(safeLabel(s, 60), s, name);
});

// Accepted false positives, for the record: a Latin word after a full stop
// that follows a word reads as a top-level label, so "東京。Tokyo",
// "今日は晴れ。OK!" and "会议。OK" lose it (0881 proves the same of _safe_label).
test('safeLabel takes a Latin word after a CJK full stop for a top-level label (accepted)', () => {
  assert.equal(safeLabel(cpx(0x6771, 0x4eac, 0x3002) + 'Tokyo', 60, 'fb'), 'fb');
  assert.equal(safeLabel(cpx(0x4eca, 0x65e5, 0x306f, 0x6674, 0x308c, 0x3002) + 'OK!', 60, 'fb'), '!');
  assert.equal(safeLabel('会议。OK', 60, 'fb'), 'fb');
});

test('safeLabel still blocks links wearing joiners, other-script dots and IDNs', () => {
  const dot = cpx(0x3002);
  const eq = (input, want, why) => assert.equal(safeLabel(input), want, why);
  eq('pay' + ZWJ + 'pal.com login', 'login', 'ZWJ inside a Latin domain');
  eq('Prize paypal' + dot + 'com', 'Prize', 'ideographic dot');
  eq('Prize PAYPAL' + dot + 'COM', 'Prize', 'upper case');
  eq('Prize paypal' + cpx(0xff61) + 'com/x', 'Prize', 'halfwidth dot with a path');
  eq('Prize mail' + dot + 'google' + dot + 'com/x', 'Prize', 'two ideographic dots');
  eq(cpx(0x8cde, 0x54c1) + ' ' + cpx(0x8a50, 0x6b3a) + dot + 'com', cpx(0x8cde, 0x54c1), 'CJK label, lowercase TLD');
  eq(cpx(0x41f, 0x440, 0x438, 0x437) + ' ' + cpx(0x44f, 0x43d, 0x434, 0x435, 0x43a, 0x441) + dot + cpx(0x440, 0x444), cpx(0x41f, 0x440, 0x438, 0x437), 'Cyrillic IDN');
  eq('Prize ' + cpx(0x67e, 0x6cc) + ZWNJ + cpx(0x67e, 0x627, 0x644) + '.com', 'Prize', 'Arabic-script label with ZWNJ');
  eq('Prize ' + cpx(0x928, 0x92e, 0x938, 0x94d, 0x924, 0x947) + '.' + cpx(0x92d, 0x93e, 0x930, 0x924), 'Prize', 'Indic IDN with marks');
  eq(ZWJ + 'Lost Time' + ZWNJ, 'Lost Time', 'joiners at the ends');
  eq('Lost ' + ZWNJ + 'Time', 'Lost Time', 'joiner next to a space');
  eq('Prize ' + cpx(0x645) + ZWNJ + '.com', 'Prize', 'joiner next to a dot');
  eq('Prize ' + cpx(0x915, 0x94d) + ZWJ + '.com', 'Prize', 'virama + ZWJ before a dot');
  eq('ab' + ZWJ + ZWJ + 'cd', 'abcd', 'doubled joiner');
  eq('Lost' + ZWJ + 'Time', 'LostTime', 'ZWJ between Latin letters');
  eq('Lost' + VS16 + 'Time', 'LostTime', 'VS16 between Latin letters');
});

test('every look-alike dot before a top-level label is a dot, in any script', () => {
  const dot = cpx(0x3002);
  const eq = (input, want, why) => assert.equal(safeLabel(input), want, why);
  // The ideographic full stop and the hyphenation point, and what NFKC turns
  // into one of them or into "." (halfwidth stop, one-dot leader, small stop).
  for (const d of [0x3002, 0x2027, 0xff61, 0x2024, 0xfe52]) {
    eq('Prize paypal' + cpx(d) + 'com', 'Prize', 'U+' + d.toString(16));
  }
  eq('Prize PAYPAL' + cpx(0x2027) + 'Com', 'Prize', 'mixed case after a hyphenation point');
  // No browser takes the raised dot, the dot operator or the bullet operator
  // for a dot, so they are left alone.
  for (const d of [0x2e33, 0x22c5, 0x2219]) {
    assert.equal(safeLabel('Paris' + cpx(d) + 'London'), 'Paris' + cpx(d) + 'London', 'U+' + d.toString(16));
  }
  // A combining mark right after the dot cannot hide the TLD.
  eq('Prize paypal.' + cpx(0x64b) + 'com', 'Prize', 'mark after an ASCII dot');
  eq('Prize paypal' + dot + cpx(0x64b) + 'com', 'Prize', 'mark after a look-alike dot');
  // Listed CJK and Latin IDN TLDs, after a Latin or a CJK label.
  eq('Prize paypal' + dot + cpx(0x4e2d, 0x56fd), 'Prize', 'paypal。中国');
  eq('Prize ' + cpx(0x8c37, 0x6b4c) + dot + 'COM', 'Prize', '谷歌。COM');
  eq('Prize example' + dot + 'verm' + cpx(0xf6) + 'gensberater', 'Prize', 'Latin IDN TLD');
  eq('Prize x' + dot + cpx(0x30b3, 0x30e0), 'Prize', 'Japanese IDN TLD');
  eq('Prize x' + dot + cpx(0xb2f7, 0xcef4), 'Prize', 'Korean IDN TLD');
  eq('Prize x' + dot + cpx(0x5546, 0x57ce) + ' now', 'Prize now', 'Chinese IDN TLD then a space');
  // Top-level labels in scripts outside Latin and CJK.
  eq('Prize x' + dot + cpx(0x440, 0x444), 'Prize', 'Cyrillic');
  eq('Prize x' + dot + cpx(0x3b5, 0x3bb), 'Prize', 'Greek');
  eq('Prize x' + dot + cpx(0x645, 0x635, 0x631), 'Prize', 'Arabic');
  eq('Prize x' + dot + cpx(0xe44, 0xe17, 0xe22), 'Prize', 'Thai');
  eq('Prize x' + dot + cpx(0x92d, 0x93e, 0x930, 0x924), 'Prize', 'Devanagari with a vowel sign');
  // A CJK word that is not a listed TLD, or more after one, is prose.
  const keep = (s, why) => assert.equal(safeLabel(s), s, why);
  keep(cpx(0x6771, 0x4eac) + dot + cpx(0x4e2d, 0x56fd, 0x4eba), 'TLD followed by more letters');
  keep('Tokyo' + dot + cpx(0x5927, 0x962a), 'unlisted Han word');
  keep('paypal' + dot + 'com1', 'digits after the TLD word');
});

// The look-alike dot rule and the top-level domain, case by case (0881's
// public._safe_label gives the same answers; /tmp probe rows check every one).
test('a look-alike dot folds before a real TLD, and CJK prose keeps its full stop', () => {
  const kept = [
    '广告片。公司', '第1話。クラウド', '谷歌。中国', 'Tokyo。東京支社', '撮影は終了。次は大阪',
    '第一场。第二场', '撮影終了。Netflixで配信', 'Paris⋅London', 'Ana∙Luz',
  ];
  for (const s of kept) {
    assert.equal(safeLabel(s, 60, 'fb'), s, s);
    assert.equal(safeLabel('Prize ' + s + ' now', 60, 'fb'), 'Prize ' + s + ' now', 'in a sentence: ' + s);
  }
  // Each folds, and the domain it makes is removed.
  const removed = ['〇〇。com', 'x。com', 'пример。рф', 'пример。РФ', 'x。भारत', 'paypal。中国', 'abc。コム', 'ok。ελ'];
  for (const s of removed) {
    assert.equal(safeLabel('Prize ' + s, 60, 'fb'), 'Prize', s);
    assert.equal(safeLabel('Prize ' + s + ' now', 60, 'fb'), 'Prize now', 'in a sentence: ' + s);
  }
});

test('a domain needs a real top-level domain as its last label', () => {
  const kept = ['மு.க.ஸ்டாலின்', 'डॉ.शर्मा', 'บจก.ซันไชน์', 'А.С.Пушкин', 'Ж.-П. Сартр', 'Mr. Smith', 'v2.0'];
  for (const s of kept) assert.equal(safeLabel(s, 60, 'fb'), s, s);
  const removed = [
    'x.भारत', 'пример.рф', 'ПРИМЕР.РФ', 'paypal.中国', 'example.com/login', 'evil.co.uk',
    'shop.vermögensberater', 'x.рф/путь',
    // ASCII as before: initials ending in a long word, and letters after an
    // ASCII top-level label ("paypal.comでログイン").
    'J.R.R.Tolkien', 'paypal.comでログイン',
  ];
  for (const s of removed) assert.equal(safeLabel('Prize ' + s + ' now', 60, 'fb'), 'Prize now', s);
  // An internationalized TLD must end the word.
  assert.equal(safeLabel('x.рфabc', 60, 'fb'), 'x.рфabc');
});

// What a browser reads into a TLD: look-alike letters the IDNA mapping folds
// (U+1C80-U+1C85 are Cyrillic в, д, о, с, т to it), and a joiner older IDNA
// processing deletes. 0881's public._safe_label gives the same answers
// (boards/scripts/safe-label-parity.mjs checks every row against Postgres).
test('a TLD is found as a browser reads it', () => {
  const D = cpx(0x3002);
  const gone = (s, want = 'Prize') => {
    assert.equal(safeLabel(s, 60, 'fb'), want, s);
    assert.equal(safeLabel(s + ' now', 60, 'fb'), want + ' now', s + ' now');
  };
  // Look-alike letters, after a real dot and after a look-alike one.
  for (const d of ['.', D]) {
    gone('Prize ab' + d + 'ᲃайт');
    gone('Prize ab' + d + 'москᲀа/login');
    gone('Prize ab' + d + 'катᲂлик');
    gone('Prize ab' + d + 'ᲁети');
  }
  // A joiner inside a TLD in a joining script.
  gone('Prize ab.भा' + ZWJ + 'रत');
  gone('Prize ab.भा' + ZWNJ + 'रत');
  gone('Prize ab.مص' + ZWNJ + 'ر');
  gone('Prize ab.عر' + ZWJ + 'ب');
  gone('Prize ab.சிங்' + ZWNJ + 'கப்பூர்');
  gone('Prize ab' + D + 'भा' + ZWJ + 'रत');
  // A joiner after a virama, before a look-alike dot.
  gone('Prize पेपाल्' + ZWNJ + D + 'com');
  gone('Prize पेपाल्' + ZWJ + D + 'com');
  gone('Prize 谷歌.中国');
  // Every IDN TLD must end the word.
  assert.equal(safeLabel('x.рфabc', 60, 'fb'), 'x.рфabc');
  // After a look-alike dot every TLD must end the word, so prose keeps its
  // full stop.
  for (const s of ['Tokyo。中国支社', '广告片。公司', 'Tokyo。東京支社', '撮影終了。Netflixで配信', 'paypal。comでログイン']) {
    assert.equal(safeLabel(s, 60, 'fb'), s, s);
    assert.equal(safeLabel('Prize ' + s + ' now', 60, 'fb'), 'Prize ' + s + ' now', 'in a sentence: ' + s);
  }
});

// Every internationalized TLD must end the word, in any script: Chinese,
// Japanese, Korean, Thai and Lao names number things and abbreviate company
// forms with a dot, and the word after it often starts with a TLD.
test('a TLD with more letters after it is a word, in any script', () => {
  const kept = [
    '1.公司简介', '2.网站设计', '3.游戏美术', '4.中国风海报', '2024.香港之旅', '01.在线课程', 'Q1.集团介绍', '9.手机广告',
    '11.政府项目', '3.企业宣传片', '1.みんなの写真', 'No.1.セール情報', 'Vol.3.ストア特集', '1.グーグル広告',
    '2.ポイントカード', '3.ファッション撮影', '1.한국여행', '2.삼성전자 광고', '2024.한국영화', 'EP.한국어',
    'บมจ.ไทยออยล์', 'บจก.ไทยเบฟ', 'ธ.ไทยพาณิชย์', 'วศ.คอมพิวเตอร์', 'บจก.คอมเซเว่น', 'ร.ร.ไทยรัฐวิทยา', 'ม.ไทยคม',
    'ບ.ລາວໂທລະຄົມ', 'ທ.ລາວສູງ', 'Ver.クラウド版',
  ];
  for (const s of kept) {
    assert.equal(safeLabel(s, 60, 'fb'), s, s);
    assert.equal(safeLabel('Prize ' + s + ' now', 60, 'fb'), 'Prize ' + s + ' now', 'in a sentence: ' + s);
  }
  // Accepted: these stay whole. A linkifier that reads hosts outside ASCII
  // takes the whole run of letters after the dot for the last label
  // ("中国登录"), which is no real TLD.
  for (const s of ['Prize paypal.中国登录', 'Prize ab.한국에서', 'Prize ab.ไทยเข้าสู่ระบบ']) assert.equal(safeLabel(s, 60, 'fb'), s, s);
  // Still removed: a TLD that ends the word.
  assert.equal(safeLabel('Prize 谷歌.中国', 60, 'fb'), 'Prize');
  assert.equal(safeLabel('Prize paypal.中国 登录', 60, 'fb'), 'Prize 登录');
  assert.equal(safeLabel('Prize x.嘉里大酒店', 60, 'fb'), 'Prize');
  assert.equal(safeLabel('Prize x.ລາວ/a', 60, 'fb'), 'Prize');
});

// UTS46 maps U+1E9E to "ss" (and transitional processing U+00DF too), so a
// sharp s is two ASCII letters in a host: "ab.ẞ" is ab.ss, "ab。glaẞ" is
// ab.glass. gen-idn-tlds.mjs checks no other such code point exists.
test('a sharp s is "ss" in a top-level domain', () => {
  for (const s of ['Prize ab.ẞ', 'Prize ab。ẞ', 'Prize ab。glaẞ', 'Prize ab.preß/login', 'Prize ab.ß', 'Prize ab‧ẞ']) {
    assert.equal(safeLabel(s, 60, 'fb'), 'Prize', s);
    assert.equal(safeLabel(s + ' now', 60, 'fb'), 'Prize now', s + ' now');
  }
  for (const s of ['Straße 5', 'Weiß Bier', 'Gruß。Tschüss']) assert.equal(safeLabel(s, 60, 'fb'), s, s);
  // One letter that is no sharp s is not enough.
  assert.equal(safeLabel('Prize ab。a', 60, 'fb'), 'Prize ab。a');
});

// Two or more invisibles in a row: each is judged by its neighbours in the
// text before any of them is dropped (0881 does the same in one pass; the
// parity tool runs these rows against Postgres, where separate passes kept a
// ZWJ whose ZWNJ neighbour had gone).
test('a run of joiners is judged by the neighbours each one had', () => {
  const eq = (input, want, why) => assert.equal(safeLabel(input, 60, 'fb'), want, why);
  eq('n भा' + ZWJ + ZWNJ + 'भा n', 'n भाभा n', 'ZWJ then ZWNJ between Devanagari letters');
  eq('n भा' + ZWNJ + ZWJ + 'र n', 'n भार n', 'ZWNJ then ZWJ');
  eq('n भा' + ZWNJ + VS16 + 'भा n', 'n भाभा n', 'ZWNJ then VS16');
  eq('n م' + VS16 + VS16 + ZWNJ + 'रत', 'n مरत', 'three in a row');
  eq('n क्' + ZWNJ + ZWJ + 'र n', 'n क्' + ZWNJ + 'र n', 'a ZWNJ after a virama stays; the ZWJ after it does not');
  eq('Prize ab.भा' + ZWJ + ZWNJ + 'रत', 'Prize', 'two joiners inside a TLD');
  eq('Prize पेपाल्' + ZWNJ + ZWJ + cpx(0x3002) + 'com', 'Prize', 'two joiners after a virama, before a look-alike dot');
  // Every pair and triple between letters of a joining script, an emoji,
  // Latin, a dot and a digit: what joiners.js (the same rules, one character
  // at a time over the original text) keeps.
  const L = ['भा', 'र', 'क्', 'م', cpx(0x1f600), 'a', '.', '1'];
  const I = [ZWJ, ZWNJ, VS16];
  let n = 0;
  for (const a of L) for (const x of I) for (const y of I) {
    for (const b of L) { const s = 'n ' + a + x + y + b + ' n'; eq(s, dropStrayJoiners(s), JSON.stringify(s)); n++; }
    for (const z of I) { const s = 'n ' + a + x + y + z + 'रत'; eq(s, dropStrayJoiners(s), JSON.stringify(s)); n++; }
  }
  assert.equal(n, 792);
  // Real sequences survive.
  const real = [
    cpx(0x2764) + VS16 + ZWJ + cpx(0x1f525), cpx(0x1f3f3) + VS16 + ZWJ + cpx(0x1f308), cpx(0x1f441) + VS16 + ZWJ + cpx(0x1f5e8) + VS16,
    cpx(0x1f9d1, 0x1f3fd) + ZWJ + cpx(0x1f4bb), cpx(0x1f468) + ZWJ + cpx(0x1f469) + ZWJ + cpx(0x1f467) + ZWJ + cpx(0x1f466),
    cpx(0x1f3f4) + ZWJ + cpx(0x2620) + VS16, '1' + VS16 + cpx(0x20e3),
    cpx(0xdc1, 0xdca) + ZWJ + cpx(0xdbb, 0xdd3) + ' ' + cpx(0xdbd, 0xd82, 0xd9a, 0xdcf),
    cpx(0x645, 0x6cc) + ZWNJ + cpx(0x62e, 0x648, 0x627, 0x647, 0x645),
    cpx(0x915, 0x94d) + ZWJ + cpx(0x937), cpx(0x915, 0x94d) + ZWNJ + cpx(0x937),
    cpx(0xd28, 0xd4d) + ZWJ, cpx(0xd23, 0xd4d) + ZWJ, cpx(0xd32, 0xd4d) + ZWJ + ' ' + cpx(0xd30, 0xd4d) + ZWJ, cpx(0xd33, 0xd4d) + ZWJ + cpx(0xd15),
  ];
  for (const s of real) assert.equal(safeLabel(s, 60, 'fb'), s, [...s].map((c) => c.codePointAt(0).toString(16)).join(' '));
});

// The emoji around a ZWJ or VS16 are Extended_Pictographic (PICTO) and
// Emoji_Modifier (MODIFIER), the sets 0881 now generates from the same
// properties (safeLabelSql.test.mjs runs these rows through 0881's own
// pattern; the parity tool runs them against Postgres).
test('a ZWJ or VS16 stays only beside the emoji keepInvisible names', () => {
  const eq = (input, want, why) => assert.equal(safeLabel(input, 60, 'fb'), want, why || [...input].map((c) => c.codePointAt(0).toString(16)).join(' '));
  // Symbols outside PICTO, a regional indicator, a skin tone where a PICTO
  // is needed: the invisible goes.
  eq(cpx(0x2605) + VS16, cpx(0x2605), 'a star is no PICTO');
  eq(cpx(0x2713) + VS16, cpx(0x2713), 'a check mark is no PICTO');
  eq(cpx(0x265a) + VS16, cpx(0x265a), 'a chess king is no PICTO');
  eq(cpx(0x1f1fa) + ZWJ + cpx(0x1f1f8), cpx(0x1f1fa, 0x1f1f8), 'regional indicators pair without a ZWJ');
  eq(cpx(0x1f600) + VS16 + ZWJ + cpx(0x1f3fd), cpx(0x1f600) + VS16 + cpx(0x1f3fd), 'a skin tone after a ZWJ is no PICTO');
  eq(cpx(0x2605) + VS16 + ZWNJ + cpx(0x92d, 0x93e), cpx(0x2605, 0x92d, 0x93e));
  eq(cpx(0x1f469, 0x1f3fd) + VS16 + ZWJ + cpx(0x1f3a8), cpx(0x1f469, 0x1f3fd, 0x1f3a8), 'a VS16 after a skin tone goes, and the ZWJ after it');
  eq('x' + cpx(0x1f3fd) + VS16, 'x' + cpx(0x1f3fd), 'a VS16 after a skin tone');
  // The reviewer's rows: two invisibles after an emoji, a symbol, a regional
  // indicator or a skin tone, then a letter, an emoji, a skin tone or U+20E3.
  const A = [cpx(0x1f600), cpx(0x2764), cpx(0x2605), cpx(0x2603), cpx(0x1f1fa), cpx(0x1f3fd), cpx(0x1f9d1, 0x1f3fd)];
  const X = [VS16, cpx(0xfe0e), cpx(0x200b)];
  const B = [cpx(0x92d, 0x93e), cpx(0x1f600), cpx(0x1f525), 'a', cpx(0x20e3), cpx(0x1f3fd)];
  // What joiners.js keeps once the other invisibles (VS15, ZWSP) are gone,
  // as safeLabel drops them first.
  const others = (t) => [...t].filter((c) => !/\p{Default_Ignorable_Code_Point}/u.test(c) || [ZWJ, ZWNJ, VS16].includes(c)).join('');
  let n = 0;
  for (const a of A) for (const x of X) for (const y of [ZWJ, ZWNJ, VS16]) for (const b of B) {
    const s = 'n ' + a + x + y + b + ' n';
    eq(s, dropStrayJoiners(others(s)));
    n++;
  }
  assert.equal(n, 378);
  // Real sequences survive; NFKC makes the trade mark sign "TM" first, and
  // the VS16 after an M goes.
  for (const s of [
    cpx(0x2764) + VS16 + ZWJ + cpx(0x1f525), cpx(0x1f3f3) + VS16 + ZWJ + cpx(0x1f308), cpx(0x1f441) + VS16 + ZWJ + cpx(0x1f5e8) + VS16,
    cpx(0x1f9d1, 0x1f3fd) + ZWJ + cpx(0x1f4bb), cpx(0x1f469, 0x1f3fd) + ZWJ + cpx(0x1f3a8),
    cpx(0x1f468) + ZWJ + cpx(0x1f469) + ZWJ + cpx(0x1f467) + ZWJ + cpx(0x1f466), cpx(0x1f3f4) + ZWJ + cpx(0x2620) + VS16,
    '1' + VS16 + cpx(0x20e3), '#' + VS16 + cpx(0x20e3), cpx(0xa9) + VS16,
  ]) { eq(s, s); eq('Prize ' + s + ' now', 'Prize ' + s + ' now'); }
  eq(cpx(0x2122) + VS16, 'TM');
  // Accepted: an invisible between a TLD and the next word is dropped before
  // the word-end check, so this is "Prize ab.中国登录", which stays whole.
  eq('Prize ab.' + cpx(0x4e2d, 0x56fd, 0x200b, 0x767b, 0x5f55), 'Prize ab.' + cpx(0x4e2d, 0x56fd, 0x767b, 0x5f55));
});

// Known and accepted (the comments in safeLabel.mjs and 0881 list them).
test('safeLabel takes a real TLD after a real dot, even in a name', () => {
  assert.equal(safeLabel('paypal.comでログイン', 60, 'fb'), 'fb');
  assert.equal(safeLabel('paypal。comでログイン', 60, 'fb'), 'paypal。comでログイン');
  assert.equal(safeLabel('г.Москва', 60, 'fb'), 'fb');
  assert.equal(safeLabel('डॉ.भारत कुमार', 60, 'fb'), 'कुमार');
  assert.equal(safeLabel('ม.ไทย', 60, 'fb'), 'fb');
  assert.equal(safeLabel('2.삼성 광고', 60, 'fb'), '광고');
  // A space after the dot keeps them.
  for (const s of ['г. Москва', 'डॉ. भारत कुमार', 'ม. ไทย', '2. 삼성 광고']) assert.equal(safeLabel(s, 60, 'fb'), s, s);
  // As before this work, a label made only of symbols or emoji is not caught.
  for (const s of ['☃.net', 'i❤.ws']) assert.equal(safeLabel(s, 60, 'fb'), s, s);
  // The ASCII pattern runs first: what is left of "a.com.рф" is no link.
  assert.equal(safeLabel('a.com.рф', 60, 'fb'), '.рф');
});

test('safeLabel scrubs a long name quickly', () => {
  // Only the first 1000 code points after NFKC are looked at, and no pattern
  // is worse than quadratic in that.
  const inputs = [
    ['a' + cpx(0x301), 5000], [cpx(0x4e2d), 10000], [cpx(0x915, 0x93f), 5000], ['a.', 5000], ['.-', 5000],
    ['_', 10000], ['a' + cpx(0x3002), 5000], ['1' + cpx(0x3002), 5000], ['x.' + cpx(0x440, 0x444), 2500],
    [cpx(0x301), 5000], ['ab' + cpx(0x3002), 3000], ['ab.1', 2500],
  ];
  for (const [unit, n] of inputs) {
    const s = unit.repeat(n);
    safeLabel(s);
    const t = performance.now();
    safeLabel(s);
    safePerson(s);
    const ms = performance.now() - t;
    assert.ok(ms < 100, JSON.stringify(unit) + ' x' + n + ' took ' + ms.toFixed(1) + ' ms');
  }
  // The cut changes no result: a long run still ends in an ellipsis.
  assert.equal(safeLabel(cpx(0x4e2d).repeat(10000), 60), cpx(0x4e2d).repeat(59) + cpx(0x2026));
});

test('safeLabel cuts a long name between graphemes', () => {
  const fam = cpx(0x1f468) + ZWJ + cpx(0x1f469) + ZWJ + cpx(0x1f467);
  const out = safeLabel('x'.repeat(57) + fam + 'yyyy', 60);
  assert.ok(!out.includes(cpx(0x1f468)) || out.includes(fam), JSON.stringify(out));
  assert.ok([...out].length <= 60);
});

test('safeLabel leaves ASCII names and the phishing rows exactly as before', () => {
  // Rows of [input, max, safeLabel(input, max, 'fb'), safePerson(input, max)] that
  // the version before the grapheme change gave, written to the fixture once.
  const rows = JSON.parse(read('./safeLabelAsciiFixture.json'));
  assert.ok(rows.length >= 80, 'the fixture is missing rows');
  for (const [s, max, label, person] of rows) {
    assert.equal(safeLabel(s, max, 'fb'), label, JSON.stringify(s) + ' max ' + max);
    assert.equal(safePerson(s, max), person, 'person ' + JSON.stringify(s) + ' max ' + max);
  }
});

test('safePerson keeps an account email and cleans a display name', () => {
  assert.equal(safePerson('someone@example.com'), 'someone@example.com');
  assert.equal(safePerson('Free money http://x.example'), 'Free money');
  assert.equal(safePerson(''), 'Someone');
  assert.doesNotMatch(safePerson('Name\nInjected: header'), /\n/);
  // A display name shaped like an address is still a typed name: only a plain
  // address passes whole, so a link wearing an @ does not.
  for (const typed of ['https://evil.example/claim@a.bc', 'www.evil.example@attacker.com',
    'Approved:https://calendar.app.google/x@x.io', 'x'.repeat(120) + '@a.bc']) {
    const out = safePerson(typed);
    assert.doesNotMatch(out, /https?:|www\.|evil\.example|calendar\.app/i, `${JSON.stringify(typed)} -> ${JSON.stringify(out)}`);
    assert.ok([...out].length <= 60, `${JSON.stringify(typed)} was not capped`);
  }
});

// ── The templates use it ────────────────────────────────────────────────────

function caseBlock(name) {
  const start = templates.indexOf(`case "${name}":`);
  assert.ok(start > 0, `renderTemplate has no case "${name}"`);
  const next = templates.indexOf('case "', start + 10);
  return templates.slice(start, next > 0 ? next : undefined);
}

test('every person-to-person template cleans the names it is handed', () => {
  assert.match(templates, /import \{ safeLabel, safePerson \} from "\.\/safeLabel\.mjs";/);
  const expect = {
    workspace_invite:    ['safeLabel(data.workspaceName', 'safePerson(data.inviterName)'],
    board_shared:        ['safeLabel(data.boardName', 'safePerson(data.sharerName)'],
    invite_accepted:     ['safeLabel(data.boardName', 'safeLabel(data.workspaceName', 'safePerson(data.joinerName)'],
    pending_invite:      ['safeLabel(data.boardName', 'safeLabel(data.workspaceName', 'safePerson(data.inviterName)'],
    mention_email:       ['safeLabel(data.surfaceContext', 'safePerson(data.mentionerName)'],
    comment_reply_email: ['safeLabel(data.boardName', 'safeLabel(data.workspaceName', 'safePerson(data.replierName)'],
    // An editor's day label, cluster name and note, mailed to the whole crew.
    schedule_update:     ['safeLabel(data.title', 'safeLabel(data.body', 'safeLabel(data.productionName'],
    // Server-written, but it quotes abusers' addresses and cluster names (0390).
    ops_alert:           ['opsLine(data.title', 'opsLines(data.body)'],
  };
  for (const [name, needles] of Object.entries(expect)) {
    const block = caseBlock(name);
    for (const n of needles) assert.ok(block.includes(n), `${name} must use ${n}`);
    // A raw String(data.<name>) for any of these fields is the bug coming back.
    assert.doesNotMatch(block, /String\(data\.(boardName|workspaceName|inviterName|sharerName|joinerName|mentionerName|replierName|surfaceContext|title|body|productionName)\b/,
      `${name} passes a typed name through raw`);
  }
});

// ── 0358: the invite budget, the ban check, forged notifications ────────────

test('both invite RPCs check the ban, then spend the budget before an email can fire', () => {
  for (const fn of ['share_board', 'invite_workspace_member']) {
    const def = latestDefinition(fn);
    assert.ok(def, `${fn} must exist`);
    assert.match(def.body, /if not public\._actor_active\(\) then/, `${fn}: a banned account must stop at once`);
    const take = def.body.indexOf('_invite_budget_take()');
    const pendingInsert = def.body.indexOf('insert into pending_invites');
    assert.ok(take > 0 && pendingInsert > 0 && take < pendingInsert,
      `${fn}: the budget must be spent before the pending invite (whose trigger emails) is written`);
  }
  // share_board's existing-account branch emails on every call; it spends too.
  const share = latestDefinition('share_board').body;
  const shareNotif = share.indexOf('insert into share_notifications');
  assert.ok(share.lastIndexOf('_invite_budget_take()', shareNotif) > share.indexOf('return \'pending\''),
    'share_board must spend budget before the share_notifications row that sends board_shared');
});

test('the budget is enforced server-side, internal, and race-safe', () => {
  const def = latestDefinition('_invite_budget_take');
  assert.ok(def, '_invite_budget_take must exist');
  assert.match(def.body, /c_invite_daily_limit\s+constant\s+integer\s*:=\s*\d+/);
  assert.match(def.body, /c_invite_first_day_limit\s+constant\s+integer\s*:=\s*\d+/);
  assert.match(def.body, /pg_advisory_xact_lock/, 'two concurrent invites must not both read the old count');
  assert.match(def.body, /invite limit reached/, 'ShareModal stops its loop on this phrase');
  const file = readFileSync(MIGRATIONS_DIR + def.file, 'utf8');
  assert.match(file, /revoke execute on function public\._invite_budget_take\(\) from public, anon, authenticated/,
    'an internal helper must not be callable by a client (the 0311 habit)');
});

test('no client can insert a notification row (and so trigger an email)', () => {
  // The LAST migration to mention each open policy must be the one dropping it.
  for (const policy of ['share_notifications insert authed', 'mention_notifications insert authed']) {
    const files = migrationFiles().filter((f) => readFileSync(MIGRATIONS_DIR + f, 'utf8').includes(`"${policy}"`));
    const last = readFileSync(MIGRATIONS_DIR + files.at(-1), 'utf8');
    assert.match(last, new RegExp(`drop policy if exists "${policy}"`), `"${policy}" is live again in ${files.at(-1)}`);
  }
});

test('the invitation names the inviter by account email, not a typed name', () => {
  const def = latestDefinition('_tg_pending_invite_email');
  assert.ok(def);
  assert.match(def.body, /select u\.email into v_inviter_name/);
  assert.doesNotMatch(def.body, /display_name/, 'a display name is whatever its owner typed');
});

test('the share panel stops at the first refusal and keeps what was not sent', () => {
  const modal = read('../components/ShareModal.jsx');
  // By position, not indexOf: with a duplicate in the paste, indexOf found the
  // copy that had already been sent and put sent addresses back in the box.
  assert.match(modal, /if \(\/invite limit reached\/i\.test\(msg\)\) \{ limitMsg = msg; limitIdx = i; break; \}/);
  assert.match(modal, /const unsent = emails\.slice\(limitIdx\);/);
  assert.match(modal, /setInviteEmail\(unsent\.join\(', '\)\)/);
  // ...and a paste is de-duplicated before anything is sent: the panel parses
  // with lib/inviteSubmit.js's parseEmails (the editor limit's count reads the
  // same parse), whose dedupe inviteSubmit.test.mjs pins by behaviour.
  assert.match(modal, /import \{ parseEmails \} from '\.\.\/lib\/inviteSubmit\.js';/);
  assert.doesNotMatch(modal, /const parseEmails = /, 'one parser: the panel must not grow its own again');
  assert.match(read('./inviteSubmit.js'), /const k = s\.toLowerCase\(\);\s*if \(seen\.has\(k\)\) return false;/);
});

// ── 0360: what the review of 0358/0359 found ────────────────────────────────

test('only a machine identity can become a service account or hold a service token', () => {
  const helper = latestDefinition('_is_service_identity');
  assert.ok(helper, '_is_service_identity must exist');
  assert.match(helper.body, /u\.email like 'svc\+%@service\.soleilpictures\.com'/);
  assert.match(helper.body, /raw_user_meta_data ->> 'service_account' = 'true'/);
  // The Worker mints exactly that shape (apiAuth.js createServiceAuthUser).
  const apiAuth = read('./apiAuth.js');
  assert.match(apiAuth, /`svc\+\$\{crypto\.randomUUID\(\)\}@service\.soleilpictures\.com`/);
  assert.match(apiAuth, /user_metadata: \{ service_account: true/);
  const file = readFileSync(MIGRATIONS_DIR + helper.file, 'utf8');
  assert.match(file, /revoke execute on function public\._is_service_identity\(uuid\) from public, anon, authenticated/);

  for (const fn of ['service_account_register', 'api_token_mint_for']) {
    const def = latestDefinition(fn);
    assert.match(def.body, /if not public\._is_service_identity\(p_user_id\) then/, `${fn} must refuse a person`);
    assert.match(def.body, /if not public\._actor_active\(\) then/, `${fn} must refuse a suspended owner`);
  }
  assert.match(latestDefinition('service_account_register').body, /belongs to another workspace/);
});

test('no client can add someone to a workspace, and a machine gets no invite email', () => {
  const policy = 'wm insert by workspace creator';
  const files = migrationFiles().filter((f) => readFileSync(MIGRATIONS_DIR + f, 'utf8').includes(`"${policy}"`));
  const last = readFileSync(MIGRATIONS_DIR + files.at(-1), 'utf8');
  assert.match(last, new RegExp(`drop policy if exists "${policy}"`), `"${policy}" is live again in ${files.at(-1)}`);
  assert.match(last, /revoke insert on table public\.workspace_members from public, anon, authenticated/);
  assert.match(latestDefinition('_tg_workspace_member_email').body, /if new\.role = 'service' then\s+return new;/);
});

test('a mention reaches people in the conversation, once each, and nobody else', () => {
  const def = latestDefinition('messages_fire_mention_notifications').body;
  assert.match(def, /select distinct t\.uid/);
  assert.match(def, /from public\.conversation_participants cp[\s\S]*cp\.left_at is null/);
  assert.match(def, /public\.can_message\(t\.uid\)/);
  // 0364 makes the cap `limit least(50, <hourly room>)`; either form is a cap.
  assert.match(def, /limit (?:\d+|least\(\d+)/);
  // Padding the participant list is the way round that, so it needs can_message too.
  const policy = latestPolicy('participants insert');
  assert.match(policy.body, /user_id = auth\.uid\(\) or can_message\(user_id\)/);
});

test('changing a collaborator\'s role sends nothing and spends nothing', () => {
  const share = latestDefinition('share_board').body;
  const branch = share.slice(share.indexOf('cannot share with yourself'));
  const early = branch.indexOf('if FOUND then');
  const ret = branch.indexOf("return 'granted';", early);
  assert.ok(early > 0 && ret > early, 'an existing share must return from its own branch');
  assert.ok(ret < branch.indexOf('_invite_budget_take'), 'and before the budget is spent');
  assert.ok(ret < branch.indexOf('insert into share_notifications'), 'and before the email-sending row');
});

test('undoing "Remove access" sends nothing and spends nothing (0405)', () => {
  // The Undo used to call share_board, which on a removed row is a NEW share:
  // budget spent, "X shared Y with you" emailed to the person you meant to
  // leave alone, and once the budget ran out the removal could not be undone.
  const restore = latestDefinition('restore_board_share');
  assert.ok(restore, 'restore_board_share must exist');
  const code = restore.body.replace(/--[^\n]*/g, '');
  assert.doesNotMatch(code, /_invite_budget_take/, 'an undo spends no invite');
  assert.doesNotMatch(code, /share_notifications/, 'an undo emails nobody');
  // It is an undo, not a way to share without the budget: only the remover,
  // only briefly, and only while they still manage the access.
  assert.match(restore.body, /r\.removed_by is distinct from auth\.uid\(\)/);
  assert.match(restore.body, /r\.removed_at < now\(\) - interval '15 minutes'/);
  assert.match(restore.body, /can_manage_workspace\(b\.workspace_id\)/);
  assert.match(restore.body, /can_write_board\(p_board_id\)/);
  const modal = read('../components/ShareModal.jsx');
  const onRemove = modal.slice(modal.indexOf('const onRemoveShare'), modal.indexOf('const onMakeOwner'));
  assert.match(onRemove, /await restoreBoardShare\(\{ boardId: board\.id, userId: share\.user_id \}\)/);
  assert.doesNotMatch(onRemove, /await shareBoard\(/, 'the undo must not re-share');
});

test('the sharing docs state the limits the server enforces', () => {
  // Typed as placeholders (never as numbers) in the source, and resolved by
  // gen-docs to the migration's own constants in the generated mirror.
  const doc = read('../../content/docs/collaborate/sharing.md');
  assert.match(doc, /\{\{fact:inviteDailyLimit\}\}/);
  assert.match(doc, /\{\{fact:inviteFirstDayLimit\}\}/);
  const def = latestDefinition('_invite_budget_take').body;
  const daily = def.match(/c_invite_daily_limit\s+constant\s+integer\s*:=\s*(\d+)/)[1];
  const firstDay = def.match(/c_invite_first_day_limit\s+constant\s+integer\s*:=\s*(\d+)/)[1];
  const mirror = read('../../public/docs/collaborate/sharing.md').replace(/\s+/g, ' ');
  assert.ok(mirror.includes(`can send ${daily} invitations a day, or ${firstDay} on its first day`),
    'the published sharing page must carry the limits _invite_budget_take enforces (run npm run docs:build)');
});

// ── 0359: the sunset gate and the holdout ───────────────────────────────────

test('lifecycle mail skips people who never open, and holds back a share for measurement', () => {
  const claim = latestDefinition('lifecycle_claim_send');
  assert.ok(claim);
  for (const gate of ['_email_pref_enabled', 'lifecycle_type_enabled', '_email_deliverable', '_email_engaged']) {
    assert.ok(claim.body.includes(`public.${gate}(`), `lifecycle_claim_send lost the ${gate} gate`);
  }
  assert.match(claim.body, /'held_out'/, 'a held-out person gets a held_out row');
  assert.match(claim.body, /if v_held then\s+return null;/, 'and no email');
  // abs() of hashtext's minimum overflows int4; the draw must not use it.
  assert.doesNotMatch(claim.body, /abs\(hashtext/);

  const engaged = latestDefinition('_email_engaged');
  assert.ok(engaged);
  assert.match(engaged.body, /limit 3/);
  assert.match(engaged.body, /count\(\*\) < 3 or bool_or\(x\.opened_at is not null\)/,
    'fewer than three sends passes; three unopened in a row does not');

  assert.ok(migrationFiles().some((f) => /check \(status in \('claimed','sent','failed','held_out'\)\)/
    .test(readFileSync(MIGRATIONS_DIR + f, 'utf8'))), 'lifecycle_email_log must accept held_out');
});

test('the picture win-back fires at the re-read point, once per idle spell', () => {
  const def = latestDefinition('lifecycle_due_board_waiting');
  assert.ok(def);
  assert.match(def.body, /p_dormant_days int default 10/, 'from 10 idle days');
  assert.match(def.body, /> now\(\) - interval '30 days'/, 'and not past 30, or it mails a gone account every 45 days for ever');
  assert.match(def.body, /p_cooldown_days int default 45/);
});
