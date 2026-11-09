#!/usr/bin/env node
// Generates the character data the name scrubber needs, in its two copies:
// safeLabel.mjs (supabase/functions/_shared/email/) and public._safe_label
// (supabase/migrations/0881_safe_label_any_script.sql). Nothing here is typed
// by hand; every list comes from IANA's file or from node's Unicode and IDNA
// tables.
//
//   node scripts/gen-idn-tlds.mjs <tlds-alpha-by-domain.txt>
//       writes supabase/functions/_shared/email/idnTlds.mjs: every
//       internationalized top-level domain, decoded from its xn-- form, and
//       the same list as regex alternatives (see tldPattern), longest first,
//       in two groups: the ones written in Han, Hiragana, Katakana or Hangul
//       (CJK, which a look-alike dot after a CJK character does not reach)
//       and the rest (OTHER). It first checks ASCII_TLD_EXTRA (below).
//   node scripts/gen-idn-tlds.mjs --tlds-cjk <tlds-alpha-by-domain.txt>
//       prints the CJK alternation for Postgres, for 0881
//   node scripts/gen-idn-tlds.mjs --tlds-other <tlds-alpha-by-domain.txt>
//       prints the OTHER alternation for Postgres in pieces, one per line
//       (_safe_label_tlds_other_a, _b, ... in 0881), each short enough for
//       one apply_migration call
//   node scripts/gen-idn-tlds.mjs --marks
//       prints the class body of every combining mark (Mn, Mc, Me), for 0881
//   node scripts/gen-idn-tlds.mjs --numbers
//       prints the class body of every number that is not a decimal digit
//       (Nl, No), for 0881 ([[:digit:]] covers Nd)
//   node scripts/gen-idn-tlds.mjs --cjk
//       prints the class body of every character whose Script is Han,
//       Hiragana, Katakana or Hangul, plus U+30FC and U+3005, for 0881
//   node scripts/gen-idn-tlds.mjs --emoji-sets
//       writes supabase/functions/_shared/email/emojiSets.mjs from node's own
//       Extended_Pictographic and Emoji_Modifier tables. Run it on a node
//       whose process.versions.unicode is the Unicode version 0881 names.
//   node scripts/gen-idn-tlds.mjs --picto
//       prints the class body of every Extended_Pictographic code point, for
//       0881 (_safe_label_picto): the PICTO safeLabel.mjs's keepInvisible uses.
//       Reads the committed emojiSets.mjs, so it prints the same under any node
//   node scripts/gen-idn-tlds.mjs --emoji-modifiers
//       prints the class body of every Emoji_Modifier (the skin tones), for
//       0881 (_safe_label_modifiers): keepInvisible's MODIFIER. Reads
//       emojiSets.mjs too
//   node scripts/gen-idn-tlds.mjs --ascii-letters
//       prints every code point outside ASCII that NFKC leaves unchanged and
//       the IDNA (UTS46) mapping, transitional or not, turns into ASCII
//       letters, and fails unless they are exactly safeLabel.mjs's
//       ASCII_TLD_EXTRA (U+00DF and U+1E9E, the sharp s: "ss" in a host).
//       Both copies count those two as ASCII top-level-domain letters.
//
// The SQL output is ASCII: \uXXXX and \UXXXXXXXX regex escapes, ASCII letters
// as themselves. The backslash is built from its code so this source holds no
// escape sequence of that form.
//
// IANA's file: https://data.iana.org/TLD/tlds-alpha-by-domain.txt

import { readFileSync, writeFileSync } from 'node:fs';
import { domainToUnicode } from 'node:url';
import { fileURLToPath } from 'node:url';
import { ASCII_TLD_EXTRA, JOINING_SCRIPTS } from '../../supabase/functions/_shared/email/safeLabel.mjs';
import { PICTO_RANGES, EMOJI_MODIFIER_RANGES } from '../../supabase/functions/_shared/email/emojiSets.mjs';

const BS = String.fromCharCode(92);
const MARK = /\p{M}/u;
const OTHER_NUMBER = /[\p{Nl}\p{No}]/u;
const CJK_SCRIPT = /[\p{sc=Han}\p{sc=Hira}\p{sc=Kana}\p{sc=Hang}]/u;
const CJK_LETTER = /[\p{scx=Han}\p{scx=Hira}\p{scx=Kana}\p{scx=Hang}]/u;
// This node's own emoji tables: only the --emoji-sets writer reads them.
const RUNTIME_PICTO = /\p{Extended_Pictographic}/u;
const RUNTIME_MODIFIER = /\p{Emoji_Modifier}/u;
const ZWNJ = 0x200c, ZWJ = 0x200d;

/** Whether `ch` counts as CJK right before a look-alike dot. */
export const isCjkBeforeDot = (ch) => CJK_SCRIPT.test(ch) || ch.codePointAt(0) === 0x30fc || ch.codePointAt(0) === 0x3005;
/** Whether the TLD `t` is written in Han, Hiragana, Katakana or Hangul. */
export const isCjkTld = (t) => CJK_LETTER.test(t);
const inRanges = (pairs, c) => pairs.some(([a, b]) => c >= a && c <= b);

/** Whether `ch` is Extended_Pictographic (keepInvisible's PICTO). */
export const isPicto = (ch) => inRanges(PICTO_RANGES, ch.codePointAt(0));
/** Whether `ch` is an Emoji_Modifier, a skin tone (keepInvisible's MODIFIER). */
export const isEmojiModifier = (ch) => inRanges(EMOJI_MODIFIER_RANGES, ch.codePointAt(0));
/** Whether `ch` is in one of safeLabel.mjs's JOINING_SCRIPTS. */
export const isJoining = (ch) => JOINING_SCRIPTS.some(([a, b]) => ch.codePointAt(0) >= a && ch.codePointAt(0) <= b);

/** The PG regex escape for one code point. */
export function pgEscape(c) {
  return c > 0xffff ? BS + 'U' + c.toString(16).padStart(8, '0') : BS + 'u' + c.toString(16).padStart(4, '0');
}

/** Inclusive [lo, hi] pairs of every code point (surrogates skipped) that passes `pred`. */
export function ranges(pred) {
  const out = [];
  let lo = -1;
  for (let c = 0; c <= 0x110000; c++) {
    const inSet = c < 0x110000 && !(c >= 0xd800 && c <= 0xdfff) && pred(String.fromCodePoint(c));
    if (inSet && lo < 0) lo = c;
    if (!inSet && lo >= 0) { out.push([lo, c - 1]); lo = -1; }
  }
  return out;
}

/** A bracket-expression body (no brackets) for the code points that pass `pred`. */
export function pgClass(pred) {
  const out = [];
  let lo = -1;
  for (let c = 0; c <= 0x110000; c++) {
    const inSet = c < 0x110000 && !(c >= 0xd800 && c <= 0xdfff) && pred(String.fromCodePoint(c));
    if (inSet && lo < 0) lo = c;
    if (!inSet && lo >= 0) {
      const hi = c - 1;
      out.push(lo === hi ? pgEscape(lo) : pgEscape(lo) + '-' + pgEscape(hi));
      lo = -1;
    }
  }
  return out.join('');
}

// What a browser reads as each character of a host name: the IDNA (UTS46)
// mapping, as node's url.domainToUnicode applies it (non-transitional, so
// "ß" stays "ß" there; transitional processing makes it "ss"). Only code
// points NFKC leaves unchanged count, since the text is NFKC-normalised
// before matching. Map of every such code point outside ASCII to its mapping.
let IDNA_MAP = null;
function idnaMap() {
  if (IDNA_MAP) return IDNA_MAP;
  IDNA_MAP = new Map();
  for (let c = 0x80; c < 0x110000; c++) {
    if (c >= 0xd800 && c <= 0xdfff) continue;
    const ch = String.fromCodePoint(c);
    if (ch.normalize('NFKC') !== ch) continue;
    const u = domainToUnicode(ch);
    if (u) IDNA_MAP.set(ch, u);
  }
  return IDNA_MAP;
}
let IDNA_PREIMAGES = null;
function idnaPreimages() {
  if (IDNA_PREIMAGES) return IDNA_PREIMAGES;
  IDNA_PREIMAGES = new Map();
  for (const [ch, u] of idnaMap()) {
    if (u === ch || [...u].length !== 1) continue;
    if (!IDNA_PREIMAGES.has(u)) IDNA_PREIMAGES.set(u, []);
    IDNA_PREIMAGES.get(u).push(ch);
  }
  return IDNA_PREIMAGES;
}

/**
 * Every code point outside ASCII that NFKC leaves unchanged and that the
 * IDNA mapping, non-transitional or transitional (the deviation "ß" -> "ss"),
 * turns into ASCII letters only: what a host may hold in place of ASCII
 * letters. safeLabel.mjs's ASCII_TLD_EXTRA must be exactly this.
 */
export function asciiLetterLookalikes() {
  const out = [];
  for (const [ch, u] of idnaMap()) {
    if (/^[a-z]+$/.test(u) || /^[a-z]+$/.test(u.replaceAll('ß', 'ss'))) out.push(ch.codePointAt(0));
  }
  return out.sort((a, b) => a - b);
}

/** Throws unless asciiLetterLookalikes() is ASCII_TLD_EXTRA. */
export function checkAsciiLetters() {
  const got = asciiLetterLookalikes();
  if (got.join() !== ASCII_TLD_EXTRA.join()) {
    throw new Error('code points the IDNA mapping turns into ASCII letters: ' + got.map((c) => 'U+' + c.toString(16)).join(' ')
      + '; safeLabel.mjs ASCII_TLD_EXTRA and 0881 name ' + ASCII_TLD_EXTRA.map((c) => 'U+' + c.toString(16)).join(' '));
  }
  return got;
}

/** The character and its other cases, where each is one code point. */
export function caseVariants(ch) {
  const out = [ch];
  for (const v of [ch.toLowerCase(), ch.toUpperCase()]) if ([...v].length === 1 && !out.includes(v)) out.push(v);
  return out;
}

/**
 * Every code point a host name may hold where the TLD has `ch`: the character,
 * its other cases, and every NFKC-stable code point the IDNA mapping turns
 * into it (U+1C80, Cyrillic rounded ve, for "в"). The character first, the
 * rest in code point order.
 */
export function lookalikes(ch) {
  const rest = new Set([...caseVariants(ch).slice(1), ...(idnaPreimages().get(ch) || [])]);
  rest.delete(ch);
  return [ch, ...[...rest].sort((a, b) => a.codePointAt(0) - b.codePointAt(0))];
}

// Spellings: how a character and the optional joiner are written in each copy.
// JS keeps characters as themselves (idnTlds.mjs is UTF-8) and the joiner as
// the property Join_Control (exactly ZWNJ and ZWJ); SQL is all escapes.
export const JS = { ch: (ch) => ch, joiner: BS + 'p{Join_Control}?' };
export const PG = {
  ch: (ch) => (/^[A-Za-z]$/.test(ch) ? ch : pgEscape(ch.codePointAt(0))),
  joiner: '[' + pgEscape(ZWNJ) + pgEscape(ZWJ) + ']?',
};

/**
 * One TLD as a regex: a class wherever a character has a look-alike
 * ("рф" -> "[рР][фФ]", "в" -> "[вВᲀ]"), and, in a TLD that holds a letter of
 * a joining script, an optional ZWNJ or ZWJ between each two characters: the
 * scrub keeps a joiner between two such letters, and older IDNA processing
 * deletes it and still reaches the TLD.
 */
export function tldPattern(t, spell = JS) {
  const chars = [...t];
  const parts = chars.map((ch) => {
    const v = lookalikes(ch);
    return v.length > 1 ? '[' + v.map(spell.ch).join('') + ']' : spell.ch(ch);
  });
  return parts.join(chars.some(isJoining) ? spell.joiner : '');
}

/** The IANA version line and every IDN TLD, sorted. */
export function idnTlds(path) {
  const lines = readFileSync(path, 'utf8').split('\n');
  const version = (lines[0].match(/Version\s+(\d+)/) || [])[1];
  if (!version) throw new Error('no "# Version" line in ' + path);
  const out = new Set();
  for (const line of lines) {
    const l = line.trim().toLowerCase();
    if (!l.startsWith('xn--')) continue;
    const u = domainToUnicode(l);
    if (!u) throw new Error('cannot decode ' + l);
    out.add(u);
  }
  return { version, list: [...out].sort() };
}

// Longest first, so the first alternative that matches is also the longest,
// as Postgres would take it.
const longestFirst = (list) => [...list].sort((a, b) => [...b].length - [...a].length || (a < b ? -1 : a > b ? 1 : 0));

/** The TLDs as alternations: { cjk, other }, each a list of patterns, longest first. */
export function tldPatterns(list, spell = JS) {
  const sorted = longestFirst(list);
  return {
    cjk: sorted.filter(isCjkTld).map((t) => tldPattern(t, spell)),
    other: sorted.filter((t) => !isCjkTld(t)).map((t) => tldPattern(t, spell)),
  };
}

/** `alts` joined with "|" in pieces of at most `limit` characters, in order. */
export function pieces(alts, limit = 3600) {
  const out = [];
  let cur = '';
  for (const a of alts) {
    if (cur && cur.length + 1 + a.length > limit) { out.push(cur); cur = ''; }
    cur = cur ? cur + '|' + a : a;
  }
  if (cur) out.push(cur);
  return out;
}

/** Writes emojiSets.mjs from this node's own Extended_Pictographic and Emoji_Modifier. */
function writeEmojiSets() {
  const target = fileURLToPath(new URL('../../supabase/functions/_shared/email/emojiSets.mjs', import.meta.url));
  const hex = (n) => '0x' + n.toString(16);
  const arr = (name, rs) => {
    const pairs = rs.map(([a, b]) => '[' + hex(a) + ', ' + hex(b) + ']');
    const lines = [];
    for (let i = 0; i < pairs.length; i += 6) lines.push('  ' + pairs.slice(i, i + 6).join(', ') + ',');
    return ['export const ' + name + ' = [', ...lines, '];', ''];
  };
  const pic = ranges((ch) => RUNTIME_PICTO.test(ch));
  const mod = ranges((ch) => RUNTIME_MODIFIER.test(ch));
  const body = [
    '// Generated by boards/scripts/gen-idn-tlds.mjs from node\'s own Unicode',
    '// tables. Do not edit by hand:',
    '//   cd boards && node scripts/gen-idn-tlds.mjs --emoji-sets',
    '// on a node whose process.versions.unicode is the Unicode version 0881 names.',
    '//',
    '// A runtime\'s own \\p{Extended_Pictographic} follows its ICU\'s Unicode version,',
    '// so safeLabel.mjs, the tests and 0881_safe_label_any_script.sql all read',
    '// this one table.',
    '',
    'export const EMOJI_UNICODE_VERSION = \'' + process.versions.unicode + '\';',
    '',
    ...arr('PICTO_RANGES', pic),
    ...arr('EMOJI_MODIFIER_RANGES', mod),
  ].join('\n');
  writeFileSync(target, body);
  console.log('wrote ' + pic.length + ' + ' + mod.length + ' ranges to ' + target);
}

function main(argv) {
  const [mode, path] = argv[0]?.startsWith('--') ? [argv[0], argv[1]] : [null, argv[0]];
  if (mode === '--marks') return void console.log(pgClass((ch) => MARK.test(ch)));
  if (mode === '--numbers') return void console.log(pgClass((ch) => OTHER_NUMBER.test(ch)));
  if (mode === '--cjk') return void console.log(pgClass(isCjkBeforeDot));
  if (mode === '--picto') return void console.log(pgClass(isPicto));
  if (mode === '--emoji-modifiers') return void console.log(pgClass(isEmojiModifier));
  if (mode === '--emoji-sets') return void writeEmojiSets();
  if (mode === '--ascii-letters') return void console.log(checkAsciiLetters().map((c) => 'U+' + c.toString(16).padStart(4, '0')).join(' '));
  if (!path) throw new Error('usage: gen-idn-tlds.mjs [--tlds-cjk|--tlds-other] <tlds-alpha-by-domain.txt> | --marks | --numbers | --cjk | --emoji-sets | --picto | --emoji-modifiers | --ascii-letters');
  const { version, list } = idnTlds(path);
  if (mode === '--tlds-cjk') return void console.log(tldPatterns(list, PG).cjk.join('|'));
  if (mode === '--tlds-other') return void console.log(pieces(tldPatterns(list, PG).other).join('\n'));
  if (mode) throw new Error('unknown mode ' + mode);
  checkAsciiLetters();
  const { cjk, other } = tldPatterns(list);
  const target = fileURLToPath(new URL('../../supabase/functions/_shared/email/idnTlds.mjs', import.meta.url));
  const arr = (name, xs) => ['export const ' + name + ' = [', ...xs.map((t) => '  ' + JSON.stringify(t) + ','), '];', ''];
  const body = [
    '// Generated by boards/scripts/gen-idn-tlds.mjs from IANA\'s',
    '// tlds-alpha-by-domain.txt, version ' + version + '. Do not edit by hand:',
    '//   cd boards && node scripts/gen-idn-tlds.mjs <tlds-alpha-by-domain.txt>',
    '//',
    '// Every internationalized top-level domain, decoded from its xn-- form,',
    '// and the same list as regex alternatives, longest first. Each character',
    '// with a look-alike is a class of every code point a browser maps to it',
    '// (its other case, and what the IDNA mapping folds into it: "[вВᲀ]"); in',
    '// a TLD with a letter of a joining script, an optional ZWNJ or ZWJ',
    '// (Join_Control) may sit between each two characters. Two groups:',
    '// CJK (Han, Hiragana, Katakana or Hangul: after a CJK character a',
    '// look-alike dot before one of them stays prose) and OTHER. Every one of',
    '// them must end the word. safeLabel.mjs uses them;',
    '// 0881_safe_label_any_script.sql carries the same alternations.',
    '',
    'export const IDN_TLDS_VERSION = ' + JSON.stringify(version) + ';',
    '',
    ...arr('IDN_TLDS', list),
    ...arr('IDN_TLD_PATTERNS_CJK', cjk),
    ...arr('IDN_TLD_PATTERNS_OTHER', other),
  ].join('\n');
  writeFileSync(target, body);
  console.log('wrote ' + list.length + ' entries (' + cjk.length + ' CJK) to ' + target);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
