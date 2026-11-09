// A name someone typed, made safe to put in an email we send.
//
// Person-to-person emails carry names their owners write freely: a cluster's
// name, a workspace's name, a display name. On 2026-09-20 a cluster named with
// a phishing lure and a link went out, in the subject line of our invite
// email, from our own sending domain. layout.ts already escapes HTML, so
// nothing can inject markup; this handles what escaping does not:
//
//   - control characters, CR/LF above all: in a subject they are a
//     header-injection primitive
//   - invisible characters (Unicode's default-ignorables: zero-width spaces
//     and joiners, the soft hyphen, bidi controls). One inside a domain splits
//     it for our matcher while a URL parser deletes it and still reaches the
//     host, so they are removed before anything else looks at the text
//   - anything shaped like a link: a scheme, `www.`, or a `name.tld` token
//     whose last label is a real top-level domain. The text is
//     NFKC-normalised first, and a look-alike full stop is folded to "." where
//     a top-level domain follows it, so a full-width or ideographic dot is
//     still a dot
//   - length, capped with an ellipsis
//
// Plain JavaScript (.mjs) so the Deno edge function and the node test suite
// import the same code. No dependencies: idnTlds.mjs and emojiSets.mjs beside it
// are generated data (boards/scripts/gen-idn-tlds.mjs).
//
// The special characters below are written as code points, never as escape
// sequences in the source: the tooling this file is deployed through rewrites
// such escapes into the characters themselves, and a raw line separator inside
// a regular-expression literal is a syntax error that fails the whole bundle.

import { IDN_TLD_PATTERNS_CJK, IDN_TLD_PATTERNS_OTHER } from './idnTlds.mjs';
import { PICTO_RANGES, EMOJI_MODIFIER_RANGES } from './emojiSets.mjs';

const cp = (...codes) => String.fromCodePoint(...codes);

// Regex class body for [lo, hi] pairs, spelled with \u{...} (a backslash and
// a u in the pattern text, not an escape in this source).
const range = (pairs) => pairs.map(([a, b]) => a === b ? `\\u{${a.toString(16)}}` : `\\u{${a.toString(16)}}-\\u{${b.toString(16)}}`).join('');

// Only the first PRE_CUT code points (after NFKC) are looked at. The result
// is at most `max` characters anyway, and a cut can only shorten a domain at
// the end, so it changes no result; it bounds the work on a pasted essay.
export const PRE_CUT = 1000;
function head(s, n = PRE_CUT) {
  if (s.length <= n) return s;
  let i = 0;
  for (let k = 0; k < n && i < s.length; k++) i += s.codePointAt(i) > 0xffff ? 2 : 1;
  return s.slice(0, i);
}

// Look-alike full stops as they are after NFKC (which already turns the
// halfwidth stop into U+3002 and the one-dot leader into "."): the
// ideographic full stop and the hyphenation point. Browsers take these for a
// dot in a host name. Not U+00B7 (Catalan "l·l"), not U+30FB (the katakana
// word separator), and not the raised dot, the dot operator or the bullet
// operator, which no browser takes for a dot ("Paris⋅London", "Ana∙Luz").
// Folded to "." only where a top-level domain follows (see DOT_RULE), so
// Japanese and Chinese sentences keep what comes after "。".
export const LOOKALIKE_DOTS = [0x3002, 0x2027];
const ELLIPSIS = cp(0x2026);
// What a removed link leaves trailing: spaces, colons, commas, hyphens, and
// en/em dashes ("Log in -", "see:").
const TRAILING_LEAD_IN = new RegExp("[\\s:;,\\-" + cp(0x2013, 0x2014) + "]+$", "u");

// Scripts that spell with ZWNJ/ZWJ between letters (Arabic, Indic, Myanmar,
// Khmer, Mongolian and their extensions). A joiner survives only between two
// of these, after a virama, or inside an emoji sequence.
export const JOINING_SCRIPTS = [
  [0x0600, 0x06ff], [0x0700, 0x074f], [0x0750, 0x077f], [0x07c0, 0x07ff], [0x0870, 0x08ff],
  [0x0900, 0x0dff], [0x1000, 0x109f], [0x1780, 0x17ff], [0x1800, 0x18af], [0x1cd0, 0x1cff],
  [0xa8e0, 0xa8ff], [0xa9e0, 0xa9ff], [0xaa60, 0xaa7f], [0xfb50, 0xfdff], [0xfe70, 0xfefc],
];
const JOINING = new RegExp('[' + range(JOINING_SCRIPTS) + ']', 'u');
// Unicode 17's emoji table, pinned in emojiSets.mjs: the same one 0881's
// _safe_label_picto and _safe_label_modifiers hold. The runtime's own
// Extended_Pictographic property follows whatever Unicode its ICU carries.
const PICTO = new RegExp('[' + range(PICTO_RANGES) + ']', 'u');
const MODIFIER = new RegExp('[' + range(EMOJI_MODIFIER_RANGES) + ']', 'u');
export const VIRAMAS = new Set([0x094d, 0x09cd, 0x0a4d, 0x0acd, 0x0b4d, 0x0bcd, 0x0c4d, 0x0ccd, 0x0d4d, 0x0dca, 0x1039, 0x103a, 0x17d2]);
const ZWNJ = 0x200c, ZWJ = 0x200d, VS16 = 0xfe0f, KEYCAP = 0x20e3;

// Whether the ZWNJ, ZWJ or VS16 `c` stays, given the characters around it in
// the text as it was before any of them was dropped: two or more in a row are
// each judged by their neighbours there, not by what is left after another
// one goes. 0881's _safe_label_scrub decides all three in one regexp_replace
// whose lookarounds see that same text, so the two copies agree.
function keepInvisible(c, prev, prev2, next) {
  const script = !!prev && JOINING.test(prev) && ((!!next && JOINING.test(next)) || VIRAMAS.has(prev.codePointAt(0)));
  if (c === ZWNJ) return script;
  if (c === ZWJ) {
    if (script) return true;
    const emojiBefore = prev && (PICTO.test(prev) || MODIFIER.test(prev) || (prev.codePointAt(0) === VS16 && prev2 && PICTO.test(prev2)));
    return !!emojiBefore && !!next && PICTO.test(next);
  }
  if (c === VS16) return !!prev && (PICTO.test(prev) || (/^[0-9#*]$/.test(prev) && next?.codePointAt(0) === KEYCAP));
  return false;
}

// A scheme ("https://", "HTTP://", "ms-settings://"): ASCII, as schemes are.
const SCHEME = /[A-Za-z][A-Za-z0-9+.-]*:\/\/\S*/gu;
const WWW = /www\.\S*/giu;

// A top-level domain, as the last label of a host: ASCII letters, or one of
// IANA's internationalized TLDs (idnTlds.mjs, all of them).
//   - ASCII: two or more letters in any case. The sharp s counts as two ASCII
//     letters, "ss" (ASCII_TLD_EXTRA: UTS46 maps U+1E9E to "ss", and
//     transitional processing U+00DF too), so "ab.ẞ" is the host ab.ss and
//     "ab。glaẞ" is ab.glass; one of them alone is enough.
//     boards/scripts/gen-idn-tlds.mjs checks that no other code point NFKC
//     leaves unchanged maps to ASCII letters.
//   - IDN: each character of the TLD is a class of every code point a
//     browser reads as it: its other case and what the IDNA (UTS46) mapping
//     folds into it, so "рф", "РФ" and "Рф" all match, and so does "ᲃайт"
//     (U+1C83, Cyrillic wide es, is "с" to a browser); no 'i' flag, which
//     would let U+0345 in the mark class match an iota. In a TLD with a
//     letter of a joining script, a ZWNJ or ZWJ may sit between any two
//     characters: the scrub keeps one between two such letters, and IDNA
//     processing that deletes it still reaches "x.भारत". An IDN TLD must
//     end the word (WORD_END: the end of the text, or a character that is no
//     letter, mark or number), whatever its script.
export const ASCII_TLD_EXTRA = [0xdf, 0x1e9e];
const SHARP = range(ASCII_TLD_EXTRA.map((c) => [c, c]));
const ASCII_TLD_START = '(?:[A-Za-z][A-Za-z' + SHARP + ']|[' + SHARP + '])';
const ASCII_TLD_WORD = ASCII_TLD_START + '[A-Za-z' + SHARP + ']*';
const WORD_END = '(?![\\p{L}\\p{M}\\p{N}])';
const TLD_CJK = IDN_TLD_PATTERNS_CJK.join('|');
const TLD_REST = IDN_TLD_PATTERNS_OTHER.join('|');

// One or more labels, a dot, optional marks, then a top-level domain, with an
// optional path. Labels hold letters, numbers, marks, "_", "-" and kept
// joiners, so a joiner or a mark cannot cut an Arabic or Indic domain in two.
//   removed: "example.com/login", "evil.co.uk", "x.рф/путь", "ПРИМЕР.РФ",
//            "x.भारत", "paypal.中国", "shop.vermögensberater", "J.R.R.Tolkien",
//            "ab.ẞ", "ab.preß/login", "谷歌.中国", "paypal.中国 登录" (leaves
//            "登录")
//   kept:    "v2.0", "Mr. Smith", "А.С.Пушкин", "Ж.-П. Сартр", "डॉ.शर्मा",
//            "மு.க.ஸ்டாலின்", "บจก.ซันไชน์" (the last label is no TLD);
//            "1.公司简介", "2024.香港之旅", "1.한국여행", "2.삼성전자 광고",
//            "บมจ.ไทยออยล์", "ม.ไทยคม", "ບ.ລາວໂທລະຄົມ", "Ver.クラウド版",
//            "No.1.セール情報" (a TLD with more letters after it is a word)
// Two patterns, the ASCII one applied first, each only when it could match
// (see safeLabel), which leaves the result as one pattern would give it,
// except that "a.com.рф" leaves ".рф":
//   - DOMAIN_ASCII: an ASCII top-level label, then any letters, as always
//     ("paypal.comでログイン" is removed whole).
//   - DOMAIN_IDN: an internationalized one, which must end the word.
// No lookbehind: the work is bounded by PRE_CUT instead.
//
// Known and accepted (inviteAbuse.test.mjs pins each; 0881 lists the same):
//   - "Prize paypal.中国登录", "Prize ab.한국에서" and "Prize ab.ไทยเข้าสู่ระบบ"
//     stay whole. A linkifier that reads hosts outside ASCII takes the whole
//     run of letters after the dot for the last label ("中国登录"), which is
//     no real TLD; a space after the TLD ("paypal.中国 登录") and the domain
//     goes. An invisible character between the TLD and the next word is
//     dropped before the word-end check, so "ab.中国" + U+200B + "登录" is
//     this same case and stays whole (the email shows it without the
//     invisible).
//   - After a real dot, a word that is a whole real TLD goes, even in a name:
//     "г.Москва", "डॉ.भारत कुमार" (gives "कुमार"), "ม.ไทย", "2.삼성 광고"
//     (gives "광고"). A space after the dot keeps it ("г. Москва").
//   - "東京。Tokyo", "今日は晴れ。OK!" and "会议。OK" lose the ASCII word: after
//     "。" it may be a real TLD (see DOT_RULE).
//   - "paypal。comでログイン" stays while "paypal.comでログイン" goes: the
//     look-alike dot keeps its word-end check (see DOT_RULE).
//   - As before this work, a label made only of symbols or emoji is not
//     caught: "☃.net" and "i❤.ws" stay.
const LABEL = '[\\p{L}\\p{N}\\p{M}_' + cp(0x200c, 0x200d) + '-]';
const DOMAIN_HEAD = '[\\p{L}\\p{N}]' + LABEL + '*(?:\\.' + LABEL + '+)*\\.\\p{M}*';
const PATH = '(?:[/?#]\\S*)?';
const DOMAIN_ASCII = new RegExp(DOMAIN_HEAD + ASCII_TLD_START + '[\\p{L}\\p{M}]*' + PATH, 'gu');
const DOMAIN_IDN = new RegExp(DOMAIN_HEAD + '(?:' + TLD_REST + '|' + TLD_CJK + ')' + WORD_END + PATH, 'gu');
// When DOMAIN_IDN can match: some "." is followed (after optional marks, which
// are never ASCII) by a character that is not ASCII.
const DOT_THEN_NON_ASCII = new RegExp('\\.[^' + range([[0, 0x7f]]) + ']', 'u');
// A plain mailbox address and nothing else: no scheme, path, port or space.
const PLAIN_ADDRESS = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const INVISIBLE = /\p{Default_Ignorable_Code_Point}/u;

// A look-alike dot is a dot only where a link could use it: a lure needs a
// top-level domain after it, prose does not. The dot is folded to "." when
//   - the character before it is a letter, a number of any kind (so "〇〇。com"
//     folds), a mark, "_", "-", or a kept ZWNJ or ZWJ ("पेपाल्" + ZWNJ +
//     "。com", the joiner after a virama); and
//   - after it come optional marks and then a word that ends there (the end
//     of the text, or a character that is no letter, mark or number), the
//     word being two or more ASCII letters in any case ("com", "COM"; a sharp
//     s counts as two, so "glaẞ" and "ẞ" count), or one of IANA's
//     internationalized TLDs in any case ("рф", "РФ", "भारत", "ελ", "中国",
//     "コム"). So prose keeps its full stop: "Tokyo。中国支社" and
//     "撮影終了。Netflixで配信" stay, and so "paypal。comでログイン" stays too,
//     while "paypal.comでログイン" (a real dot) goes.
//   - A CJK TLD (written in Han, Hiragana, Katakana or Hangul) does not count
//     after a CJK character (Han, Hiragana, Katakana, Hangul, "ー" or "々"):
//     there "。" ends a sentence and the next one starts with a word that
//     happens to be a TLD.
// Folded:  "paypal。com", "x。com", "〇〇。com", "пример。РФ", "x。भारत",
//          "paypal。中国", "abc。コム", "ok。ελ"
// Kept:    "广告片。公司", "第1話。クラウド", "谷歌。中国", "Tokyo。東京支社",
//          "Tokyo。中国支社", "撮影は終了。次は大阪", "第一场。第二场",
//          "撮影終了。Netflixで配信", "paypal。comでログイン"
// Known and accepted: "東京。Tokyo", "今日は晴れ。OK!" and "会议。OK" fold, as
// an ASCII word after "。" may be a real TLD; "paypal。comでログイン" stays.
// 0881's public._safe_label applies the same rule.
const DOTS = '[' + range(LOOKALIKE_DOTS.map((c) => [c, c])) + ']';
const HAS_DOT = new RegExp(DOTS, 'u');
const CJK_BEFORE = '[\\p{sc=Han}\\p{sc=Hira}\\p{sc=Kana}\\p{sc=Hang}' + range([[0x30fc, 0x30fc], [0x3005, 0x3005]]) + ']';
const DOT_RULE = new RegExp('(?<=[\\p{L}\\p{N}\\p{M}_' + cp(0x200c, 0x200d) + '\\-])' + DOTS + '(?:(?=\\p{M}*(?:' + ASCII_TLD_WORD + '|' + TLD_REST + ')' + WORD_END + ')|(?<!' + CJK_BEFORE + DOTS + ')(?=\\p{M}*(?:' + TLD_CJK + ')' + WORD_END + '))', 'gu');

// C0 and C1 controls, plus the two Unicode line terminators.
function isControl(c) {
  return c < 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029;
}

// Invisible characters are dropped (so a split domain closes up again and is
// then caught), except a ZWNJ, ZWJ or VS16 in a position keepInvisible allows.
// Controls become `withText`, and look-alike dots become "." when asked.
function scrub(s, withText, foldDots) {
  const chars = [];
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (INVISIBLE.test(ch) && c !== ZWNJ && c !== ZWJ && c !== VS16) continue;
    chars.push(ch);
  }
  let out = "";
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const c = ch.codePointAt(0);
    if (c === ZWNJ || c === ZWJ || c === VS16) {
      if (keepInvisible(c, chars[i - 1], chars[i - 2], chars[i + 1])) out += ch;
      continue;
    }
    out += isControl(c) ? withText : ch;
  }
  if (foldDots && HAS_DOT.test(out)) out = out.replace(DOT_RULE, ".");
  return out;
}

const SEG = typeof Intl !== "undefined" && typeof Intl.Segmenter === "function" ? new Intl.Segmenter("und", { granularity: "grapheme" }) : null;
/** Grapheme clusters of `s` (code points where Intl.Segmenter is missing). */
export const graphemes = (s) => (SEG ? Array.from(SEG.segment(s), (x) => x.segment) : [...s]);

/**
 * Free text from a name field, safe for a subject line or a heading.
 * @param {unknown} value
 * @param {number} [max=60]  characters, ellipsis included
 * @param {string} [fallback=""]  returned when nothing usable is left
 * @returns {string}
 */
export function safeLabel(value, max = 60, fallback = "") {
  let s = scrub(head(String(value ?? "").normalize("NFKC")), " ", true);
  // Each step runs only when the text holds what it needs, which changes no
  // result (0881 does the same, so both copies compile only what they use).
  if (s.includes("://")) s = s.replace(SCHEME, " ");
  if (/www\./iu.test(s)) s = s.replace(WWW, " ");
  if (s.includes(".")) s = s.replace(DOMAIN_ASCII, " ");
  if (DOT_THEN_NON_ASCII.test(s)) s = s.replace(DOMAIN_IDN, " ");
  s = s.replace(/\s+/g, " ").trim().replace(TRAILING_LEAD_IN, "").trim();
  if (!s) return fallback;
  if ([...s].length > max) {
    // Cut between graphemes so a family emoji or a conjunct is never halved.
    let out = "", n = 0;
    for (const g of graphemes(s)) { const k = [...g].length; if (n + k > Math.max(1, max - 1)) break; out += g; n += k; }
    s = (out || [...s][0]).trimEnd() + ELLIPSIS;
  }
  return s;
}

/**
 * Who did something. The triggers send a display name, or the account's email
 * when there is none, so an address-shaped value is usually a real address and
 * is kept whole (safeLabel would cut "ana@studio.example" to "ana@"). But a
 * display name is typed by its owner and can be shaped like an address too,
 * so only a PLAIN address passes untouched: mailbox characters only, no
 * scheme, path or port, not starting "www.", at most 100 characters.
 * Anything else, "https://x.example/claim@a.bc" included, gets safeLabel.
 * (A typed name that is exactly a plain address still shows as one. It holds
 * no link, and it goes only to people its owner already works with.)
 * @param {unknown} value
 * @param {number} [max=60]
 * @param {string} [fallback="Someone"]
 * @returns {string}
 */
export function safePerson(value, max = 60, fallback = "Someone") {
  const s = scrub(head(String(value ?? "").normalize("NFKC")), "", false).trim();
  if (s.length <= 100 && PLAIN_ADDRESS.test(s) && !/^www\./i.test(s)) return s;
  return safeLabel(s, max, fallback);
}
