// A dependency-free ZIP reader for the browser. The counterpart of zipStore.js.
//
// Users drop a Google Takeout / Google Drive "Download" / Dropbox download zip,
// often several multi-GB parts, and its folders become nested folders in the
// app. The bytes of a 20 GB export must never be JS heap, so the design is the
// mirror image of zipStore's:
//   • the archive stays a Blob (a File from the picker is disk-backed). Nothing
//     here ever calls arrayBuffer() on a whole zip or a whole entry;
//   • the central directory is read with blob.slice() in pieces of at most 8 MB
//     and parsed incrementally, carrying a header that straddles a piece
//     boundary into the next read. A 200k-entry Takeout is a few tens of MB of
//     directory, never held whole as one buffer;
//   • openEntry() for a STORED entry is `blob.slice(...)`: a Blob handle, zero
//     bytes through JS and no CRC pass (re-hashing multi-GB videos would cost
//     more than the import). A DEFLATEd entry goes through the platform's own
//     DecompressionStream('deflate-raw'), with the CRC computed per chunk, and
//     the chunks are folded into Blobs every ~8 MB so the heap holds one
//     window, not one file;
//   • the declared size from the central directory is a hard ceiling while
//     inflating. A zip bomb declares 1 KB and inflates to 4 GB; we cancel the
//     stream the moment the count passes the declared size.
//
// Sizes always come from the central directory, never the local header: an
// entry written by a streaming writer has zeros there and the real numbers in
// a trailing data descriptor. The local header is read only for its two
// length fields, which is where the data actually starts.
//
// ZIP64 is supported (Takeout parts are 2-50 GB), read-only. Encrypted entries
// and methods other than STORE / DEFLATE are counted and skipped, not guessed
// at. Entry names are sanitized on the way in: a name is data from a stranger.

import { crc32Update, crc32Final, crc32 as crc32Of } from './zipStore.js';

// Largest piece of the central directory read in one go.
const PIECE_BYTES = 8 * 1024 * 1024;
// The EOCD is 22 bytes plus a comment of up to 65,535 bytes.
const EOCD_SCAN = 65557;
// Heap window while inflating: fold pending chunks into a Blob this often.
const FOLD_BYTES = 8 * 1024 * 1024;

const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

export class ZipReadError extends Error {
  // code: 'not_zip' | 'truncated' | 'too_big' | 'crc' | 'no_inflate'
  constructor(code, message) {
    super(message || code);
    this.name = 'ZipReadError';
    this.code = code;
  }
}

// Whether this browser can inflate. DecompressionStream('deflate-raw') is the
// whole reason there is no inflate implementation in this file; an old WebView
// without it can still import STORED entries and is told so for the rest.
export function canInflate() {
  try {
    if (typeof DecompressionStream !== 'function') return false;
    new DecompressionStream('deflate-raw');
    return true;
  } catch {
    return false;
  }
}

// IBM code page 437, bytes 0x80-0xFF. The last resort for a name with no UTF-8
// flag that is not valid UTF-8 and fits no other encoding (see
// resolveLegacyNames); below 0x80 it is ASCII.
const CP437_HIGH =
  'ÇüéâäàåçêëèïîìÄÅ' +
  'ÉæÆôöòûùÿÖÜ¢£¥₧ƒ' +
  'áíóúñÑªº¿⌐¬½¼¡«»' +
  '░▒▓│┤╡╢╖╕╣║╗╝╜╛┐' +
  '└┴┬├─┼╞╟╚╔╩╦╠═╬╧' +
  '╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀' +
  'αßΓπΣσµτΦΘΩδ∞φε∩' +
  '≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

function decodeCp437(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    s += b < 0x80 ? String.fromCharCode(b) : CP437_HIGH[b - 0x80];
  }
  return s;
}

// Strict UTF-8: the text, or null when the bytes are not valid UTF-8.
function decodeUtf8Strict(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return null; }
}

// The legacy encodings to try for an unflagged, non-UTF-8 name, from the
// browser's languages (navigator.languages order). The decoding itself is the
// platform's TextDecoder (WHATWG legacy encodings); only the order is ours.
// Checked fflate (Latin-1, no 0x7075) and jszip (hook only).
export function zipNameEncodings(languages) {
  const out = [];
  const add = (...labels) => { for (const l of labels) if (!out.includes(l)) out.push(l); };
  for (const tag of Array.from(languages || [])) {
    const lower = String(tag || '').toLowerCase();
    const primary = lower.split(/[-_]/)[0];
    if (primary === 'ja') add('shift_jis');
    else if (primary === 'ko') add('euc-kr');
    else if (primary === 'zh') add(/[-_](tw|hk|mo|hant)\b/.test(lower) ? 'big5' : 'gbk');
    // Windows and 7-Zip write the OEM page 866 first, so it goes first.
    else if (['ru', 'uk', 'be', 'bg', 'sr', 'mk', 'kk', 'ky', 'tg', 'mn'].includes(primary)) add('ibm866', 'windows-1251');
    else if (primary === 'el') add('windows-1253');
    else if (['he', 'iw', 'yi'].includes(primary)) add('windows-1255');
    else if (['ar', 'fa', 'ur'].includes(primary)) add('windows-1256');
    else if (primary === 'th') add('windows-874');
    else if (primary === 'vi') add('windows-1258');
  }
  return out;
}

// What a real file name can hold: printable ASCII, letters, marks, numbers,
// spaces, dashes, brackets and quotes, CJK punctuation, fullwidth forms and
// the numero sign. Rejects box-drawing, section and not signs and the like,
// which is what a wrong guess decodes to.
const PLAUSIBLE = /^[\x20-\x7e\p{L}\p{M}\p{N}\p{Zs}\p{Pd}\p{Ps}\p{Pe}\p{Pi}\p{Pf}\u{3000}-\u{303F}\u{FF01}-\u{FF60}\u{2116}\u{2026}\u{20AC}\u{2122}\u{2030}\u{2022}\u{2020}\u{2021}\u{30FB}\u{B7}\u{D7}\u{203B}\u{2605}\u{2606}\u{2661}\u{2665}\u{2669}-\u{266C}\u{2190}-\u{2193}\u{25A0}\u{25A1}\u{25B2}\u{25B3}\u{25BC}\u{25BD}\u{25C6}\u{25C7}\u{25CB}\u{25CE}\u{25CF}]*$/u;
const HALFWIDTH_KATAKANA = /[\u{FF61}-\u{FF9F}]/u;
const KANA = /[\u{3040}-\u{30FF}]/u;
const NON_ASCII = /[^\x00-\x7f]/gu;
const HANGUL_ONLY = /^[\u{1100}-\u{11FF}\u{3130}-\u{318F}\u{AC00}-\u{D7AF}]$/u;

// Every raw name decoded with `label`, or null when any is invalid in it.
function decodeAll(label, rawList) {
  let dec;
  try { dec = new TextDecoder(label, { fatal: true }); } catch { return null; }
  const names = [];
  for (const raw of rawList) {
    try { names.push(dec.decode(raw)); } catch { return null; }
  }
  return names;
}

// A word that mixes two alphabetic scripts ("RВsumВ": CP437 bytes read as
// CP866) is a wrong guess. Han, kana and Hangul are left out on purpose:
// "PDF資料" is a normal name.
const ALPHABETS = [
  /\p{Script=Latin}/u, /\p{Script=Cyrillic}/u, /\p{Script=Greek}/u, /\p{Script=Hebrew}/u,
  /\p{Script=Arabic}/u, /\p{Script=Thai}/u, /\p{Script=Armenian}/u, /\p{Script=Georgian}/u,
];
const WORD = /[\p{L}\p{M}]+/gu;
const mixesAlphabets = (n) => (n.match(WORD) || []).some((w) => ALPHABETS.filter((re) => re.test(w)).length > 1);

// A zip from a Western computer (CP437) opened on a Russian, Greek or Hebrew
// one is read as windows-125x or ibm866, where CP437's accented letters are
// punctuation or capitals: "R‚sum‚", "caf‚", "na‹ve", "K”ln", "Rendez-vous …
// Paris". The misread always puts the stray character next to a LATIN letter,
// the Western name's own letters; a real name in those scripts has its own
// letters there. So:
//  - a mark of the dagger and ellipsis kind with a Latin letter on either side
//    is a wrong guess (U+02C6, windows-1255's 0x88 for CP437's e-circumflex,
//    "vocˆ.txt" for "você", is of the dagger kind), and so is a quote-like one
//    with a Latin letter on both sides, and so is an ellipsis or U+201A standing alone between spaces
//    (CP437's French "à" as a word; Portuguese "Isto ‚ bom", "é").
//  - a stray dash: U+2013 or U+2014 right after a LOWERCASE Latin letter and
//    then a lowercase Latin letter or the end of the word (a character that is
//    not a letter, mark or number, or none): "Go–t.jpg" ("Goût" read as
//    windows-1251), "pi—.txt" ("più"), "o— ". Also right after an UPPERCASE
//    Latin letter when the dash ends the word: "O—.txt" ("Où" in windows-125x).
//    Left alone: "Q1–Q2", "A–B тест.xlsx", "Jan–Mar отчет.xlsx",
//    "Москва–Paris", "Paris–Москва", "Отчет – Final".
//  - U+0192 (f with hook) directly next to a Latin letter: "Chƒteau de
//    Versailles.jpg" (CP437 "â" read in windows-1253/1255/1256). F-numbers stay:
//    "50mm ƒ1.4.jpg", "ƒ/2.8 test.jpg".
//  - a no-break space right after a Latin letter, followed by a LOWERCASE Latin
//    letter or the end of the word: "M laga.jpg" (CP437 "á" read as
//    windows-125x or windows-874), "est .txt" ("está"). Left alone: "Microsoft
//    Word отчет.docx" with a no-break space (windows-1251), an uppercase word
//    after it.
//  - at the start of the whole name or of any folder or file name in the path
//    ("Projet/à faire.txt"), one of the characters CP437's one-letter words
//    become, alone, then one space and a Latin letter: U+0415 Е (ibm866 of "à",
//    0x85), U+0420 Р (ibm866 of "É", 0x90), U+0452 ђ (windows-1251 of "É"),
//    U+06AF گ (windows-1256 of "É"), U+2026 … (windows-125x and 874 of "à"),
//    U+201A ‚ (windows-125x of "é", 0x82): "Е faire.txt", "… faire.txt".
//    Left alone, real one-letter words of Russian and Greek: ibm866
//    "В Paris.jpg", "С Apple.docx", "Я iPhone.jpg", windows-1251 "С Apple.docx",
//    windows-1253 "Ο Paris.jpg".
//  - a stray closing quote: U+201D right after a Latin letter where the word
//    ends, with no opening quote (U+201C, U+201E, U+00AB) before it in the
//    name: "Malm”.jpg" ("Malmö"). Left alone: "Проект “Alpha”.docx".
//  - a lone capital: one uppercase Cyrillic or Greek letter between single
//    spaces, a Latin letter (marks allowed) right before the first space and a
//    Latin letter right after the second: "Voyage Е Paris.jpg" (CP437 "à" read
//    as ibm866), "Roma Љ bella" ("è" read as windows-1251). Left alone:
//    "iPhone и iPad.docx" (lowercase и is a real Russian word), "Приложение А.pdf".
// Accepted misses of these rules: Russian "Photo В Paris" with a capital
// one-letter word, "Final– отчет" and "Alpha” отчет" are refused in windows-1251;
// so is a real name with an uppercase Latin letter and then a dash that ends the
// word ("Grade A– отчет", "Plan B— отчет"; windows-1253 "Model X— Τελικό");
// Bulgarian or Macedonian "Е" (is) starting a name before a Latin word is
// refused in ibm866 and in windows-1251; at the start of a name, Portuguese
// lowercase "é bom.txt" reads "В bom.txt" and Italian "è bella.jpg" reads
// "К bella.jpg" in ibm866 (В and К are Russian words, so they stay out of the
// start set). Older misses, left as they
// are: on an Arabic browser "Roma è bella.jpg" reads "Roma ٹ bella.jpg",
// "Dîner.pdf" reads "DŒner.pdf" and "île.jpg" reads "Œle.jpg"; "Æble.jpg" reads
// "’ble.jpg" in windows-125x.
// A quote between two letters of the name's own script is real (a Hebrew
// acronym "דו”ח", Bulgarian „…“) and stays. The apostrophes U+2018/2019
// (Ukrainian writes one between letters) and a dash between a name's own
// letters are fine.
const STRAY_EITHER = /\p{Script=Latin}[\u{201A}\u{2020}\u{2021}\u{2030}\u{2022}\u{2026}\u{20AC}\u{2122}\u{2C6}\u{192}]|[\u{201A}\u{2020}\u{2021}\u{2030}\u{2022}\u{2026}\u{20AC}\u{2122}\u{2C6}\u{192}]\p{Script=Latin}/u;
const STRAY_BOTH = /\p{Script=Latin}[\u{201E}\u{201C}\u{201D}\u{2039}\u{203A}]\p{Script=Latin}/u;
const STRAY_ALONE = / [\u{2026}\u{201A}] /u;
const STRAY_DASH = /(?=\p{Script=Latin})\p{Ll}[\u{2013}\u{2014}](?:(?=\p{Script=Latin})\p{Ll}|(?![\p{L}\p{M}\p{N}]))|(?=\p{Script=Latin})\p{Lu}[\u{2013}\u{2014}](?![\p{L}\p{M}\p{N}])/u;
const STRAY_NBSP = /\p{Script=Latin}\u{A0}(?:(?=\p{Script=Latin})\p{Ll}|(?![\p{L}\p{M}\p{N}]))/u;
const STRAY_START = /(?:^|\/)[\u{415}\u{420}\u{452}\u{6AF}\u{2026}\u{201A}] \p{Script=Latin}/u;
const STRAY_CLOSE_QUOTE = /\p{Script=Latin}\u{201D}(?![\p{L}\p{M}\p{N}])/u;
const OPEN_QUOTE = /[\u{201C}\u{201E}\u{AB}]/u;
const STRAY_CAPITAL = /\p{Script=Latin}\p{M}* (?=[\p{Script=Cyrillic}\p{Script=Greek}])\p{Lu} \p{Script=Latin}/u;
const strayCloseQuote = (n) => {
  const m = STRAY_CLOSE_QUOTE.exec(n);
  return !!m && !OPEN_QUOTE.test(n.slice(0, m.index));
};
const strayPunctuation = (n) => STRAY_EITHER.test(n) || STRAY_BOTH.test(n) || STRAY_ALONE.test(n)
  || STRAY_DASH.test(n) || STRAY_NBSP.test(n) || STRAY_START.test(n) || strayCloseQuote(n) || STRAY_CAPITAL.test(n);

// In a double-byte reading (Shift_JIS, GBK, Big5, EUC-KR), CP437 "Noël.doc",
// "Müller.docx" and "Österreich.pdf" are valid byte pairs: "No<kanji>.doc",
// "M〕ler". The archive is judged as a whole, on the decoded names and their
// raw bytes. A reading is a wrong guess when BOTH hold:
//  (a) no name has two real CJK characters next to each other (a real Japanese,
//      Chinese or Korean archive nearly always has a run somewhere), and
//  (b) at least one raw name has a byte of 0x80 or more, and every such name
//      has the Western shape (hasWesternShape).
// The Western shape: the name's CP437 reading has only Latin letters among its
// non-ASCII characters, every run of letters that holds a non-ASCII letter also
// holds an ASCII letter A-Z or a-z, and inside such a run no lowercase letter is
// directly followed by an uppercase one. Western: "Noël", "Müller",
// "Österreich", "Élève", "Hélène", "château", "ÉCOLE", "Åsa". Not Western:
// "1îÄ" (Shift_JIS "1月": the run "îÄ" has no ASCII letter), "û{" ("本"), "ò\"
// ("表"), "ÉVïKâtâHâïâ_" ("新規フォルダ": "ïK" is lowercase then uppercase).
// "A社.xlsx" stays Japanese: 社 is 0x8E 0xD0, which reads "Ä╨" in CP437, and ╨
// is not a letter. One name with a CJK run ("PDF資料.pdf") carries the whole
// archive.
// Rule (a) is a veto on rule (b) for a label that came from the browser's own
// languages and is shift_jis, big5 or euc-kr, and for the tier-2 Shift_JIS try,
// unless the browser's languages include a language other than English for which
// zipNameEncodings gives no code page (French, Spanish, Portuguese, German,
// Italian and the like): for that reader, rule (b) alone decides. Without the
// veto on tier 2, 7% of two-kanji Japanese names read on a non-Japanese browser
// became CP437 ("撮影.jpg" as "ÄBëe.jpg", "※重要.txt", "永遠"), which is worse
// than the French names it saved ("Élève.pdf" read as "人革e.pdf"). The tier-2
// EUC-KR try has no veto, and neither does gbk (the common GB2312 characters
// never read as CP437 letters, so the veto gains nothing there while it let
// "Hélène.jpg" read as Chinese).
// Accepted misses: on a Japanese browser and on an English-only one, CP437
// "Élève.pdf" reads as Shift_JIS ("人革e.pdf"); on a Western-language browser, a
// Shift_JIS name whose CP437 reading looks Western ("撮影" read as "ÄBëe") reads
// as CP437; an archive whose only high-byte name is a single kanji that reads
// Western (Shift_JIS "絵.png" alone, "èG" in CP437; "A本.pdf" alone) is read as
// CP437; one-letter names ("é.txt") cannot be told apart.
// REAL_CJK has no fullwidth forms: "Ｍan" is not a CJK run.
const REAL_CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u{AC00}-\u{D7AF}\u{3005}\u{3006}\u{30FC}]/u;
const hasCjkRun = (n) => {
  let prev = false;
  for (const c of n) {
    const is = REAL_CJK.test(c);
    if (is && prev) return true;
    prev = is;
  }
  return false;
};
const LATIN_CHAR = /\p{Script=Latin}/u;
const DOUBLE_BYTE = new Set(['shift_jis', 'gbk', 'big5', 'euc-kr']);
const CJK_VETO = new Set(['shift_jis', 'big5', 'euc-kr']);
export function hasWesternShape(raw) {
  const s = decodeCp437(raw);
  if (!(s.match(NON_ASCII) || []).every((c) => LATIN_CHAR.test(c))) return false;
  for (const run of s.match(/\p{L}+/gu) || []) {
    if (!/[^\x00-\x7f]/.test(run)) continue;
    if (!/[A-Za-z]/.test(run)) return false;
    if (/\p{Ll}\p{Lu}/u.test(run)) return false;
  }
  return true;
}
function looksLikeCp437Misread(names, rawList, cjkVeto) {
  if (cjkVeto && names.some(hasCjkRun)) return false;
  let any = false;
  for (let i = 0; i < names.length; i++) {
    if (!rawList[i].some((b) => b >= 0x80)) continue;
    any = true;
    if (!hasWesternShape(rawList[i])) return false;
  }
  return any;
}

const plausibleAll = (names) => names.every((n) => PLAUSIBLE.test(n) && !mixesAlphabets(n) && !strayPunctuation(n));

// Names that no flag and no valid UTF-8 explains share one encoding per
// archive (a zip is written by one tool on one machine). Tier 1: the browser's
// languages, in order. Tier 2, whatever the locale: Shift_JIS when a name has
// kana or a CJK run, EUC-KR when every non-ASCII character is Hangul. Last: CP437, as the
// spec says. A candidate must decode EVERY name strictly and plausibly.
// → { encoding, names } with names null for cp437.
export function resolveLegacyNames(rawList, languages) {
  // A Western reader: a language other than English, written in Latin script,
  // with no code page of its own. Hindi and Bengali have no code page either but
  // are not Latin, so they keep the veto, as English does.
  const westernReader = Array.from(languages || []).some((tag) => {
    const primary = String(tag || '').toLowerCase().split(/[-_]/)[0];
    if (!primary || primary === 'en' || zipNameEncodings([tag]).length !== 0) return false;
    try { return new Intl.Locale(tag).maximize().script === 'Latn'; } catch { return false; }
  });
  const tryLabel = (label, fromBrowser = false) => {
    const names = decodeAll(label, rawList);
    if (!names || !plausibleAll(names)) return null;
    const veto = CJK_VETO.has(label) && (fromBrowser || (label === 'shift_jis' && !westernReader));
    if (DOUBLE_BYTE.has(label) && looksLikeCp437Misread(names, rawList, veto)) return null;
    if (label === 'shift_jis' && names.some((n) => HALFWIDTH_KATAKANA.test(n))) return null;
    return names;
  };
  for (const label of zipNameEncodings(languages)) {
    const names = tryLabel(label, true);
    if (names) return { encoding: label, names };
  }
  const sjis = tryLabel('shift_jis');
  if (sjis && sjis.some((n) => KANA.test(n) || hasCjkRun(n))) return { encoding: 'shift_jis', names: sjis };
  const kr = tryLabel('euc-kr');
  if (kr && kr.every((n) => (n.match(NON_ASCII) || []).every((c) => HANGUL_ONLY.test(c)))) {
    return { encoding: 'euc-kr', names: kr };
  }
  return { encoding: 'cp437', names: null };
}

// A 64-bit little-endian value as a JS number. Past 2^53 it cannot be held
// exactly, and an offset we cannot represent is an offset we cannot trust.
function u64(view, o) {
  const lo = view.getUint32(o, true);
  const hi = view.getUint32(o + 4, true);
  const v = hi * 4294967296 + lo;
  if (hi > 0x1FFFFF || v > Number.MAX_SAFE_INTEGER) {
    throw new ZipReadError('too_big', 'ZIP64 value is larger than this browser can address.');
  }
  return v;
}

async function readRange(blob, start, end) {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

const viewOf = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

// Zip entry names are untrusted. Backslashes become slashes, then empty, "."
// and ".." segments are dropped (so "../../etc/passwd" can only ever be
// "etc/passwd"), control characters are stripped. Escapes rather than literal
// control bytes in the class, as in zipStore.js.
function sanitizePath(raw) {
  const segs = [];
  for (const seg of String(raw).replace(/\\/g, '/').split('/')) {
    if (seg === '' || seg === '.' || seg === '..') continue;
    const clean = seg.replace(/[\x00-\x1f]/g, '').trim();
    if (clean === '' || clean === '.' || clean === '..') continue;
    segs.push(clean);
  }
  return segs.join('/');
}

function dosToMs(date, time) {
  const ms = new Date(
    1980 + (date >> 9), ((date >> 5) & 15) - 1, date & 31,
    time >> 11, (time >> 5) & 63, (time & 31) * 2,
  ).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

// Parse the extra field. Returns the ZIP64 values (only those present) and the
// extended-timestamp mtime if there is one.
function parseExtra(bytes, view, start, end, want) {
  const out = { size: null, compressedSize: null, offset: null, mtime: null, unicodePath: null };
  let p = start;
  while (p + 4 <= end) {
    const id = view.getUint16(p, true);
    const len = view.getUint16(p + 2, true);
    const body = p + 4;
    if (body + len > end) break;
    if (id === 0x0001) {
      // Holds ONLY the fields whose 32-bit value was 0xFFFFFFFF, in this order.
      let q = body;
      if (want.size && q + 8 <= body + len) { out.size = u64(view, q); q += 8; }
      if (want.compressedSize && q + 8 <= body + len) { out.compressedSize = u64(view, q); q += 8; }
      if (want.offset && q + 8 <= body + len) { out.offset = u64(view, q); q += 8; }
    } else if (id === 0x5455 && len >= 5 && (bytes[body] & 1)) {
      out.mtime = view.getUint32(body + 1, true) * 1000;
    } else if (id === 0x7075 && len >= 5 && bytes[body] === 1) {
      // Info-ZIP Unicode Path (APPNOTE 4.6.9): version, CRC-32 of the header's
      // own name (so a rename by another tool voids it), then the UTF-8 name.
      out.unicodePath = { crc: view.getUint32(body + 1, true), bytes: bytes.subarray(body + 5, body + len) };
    }
    p = body + len;
  }
  return out;
}

// Parse the central-directory header at bytes[p]; the caller has already
// checked the whole record is in the buffer. Returns null for an entry that
// is skipped (counted into `skipped` or left out silently). With `locked`, an
// entry that can't be opened (a password's, or squeezed some way openEntry
// doesn't read) is kept, for a list of what is inside, and still counted.
function parseHeader(bytes, view, p, skipped, locked = false) {
  const flags = view.getUint16(p + 8, true);
  const method = view.getUint16(p + 10, true);
  const time = view.getUint16(p + 12, true);
  const date = view.getUint16(p + 14, true);
  const crc32 = view.getUint32(p + 16, true);
  let compressedSize = view.getUint32(p + 20, true);
  let size = view.getUint32(p + 24, true);
  const nameLen = view.getUint16(p + 28, true);
  const extraLen = view.getUint16(p + 30, true);
  let offset = view.getUint32(p + 42, true);

  const nameBytes = bytes.subarray(p + 46, p + 46 + nameLen);
  const extraStart = p + 46 + nameLen;
  const extra = parseExtra(bytes, view, extraStart, extraStart + extraLen, {
    size: size === 0xFFFFFFFF,
    compressedSize: compressedSize === 0xFFFFFFFF,
    offset: offset === 0xFFFFFFFF,
  });
  if (extra.size !== null) size = extra.size;
  if (extra.compressedSize !== null) compressedSize = extra.compressedSize;
  if (extra.offset !== null) offset = extra.offset;

  // Which encoding is the name in? Entries that say so (bit 11, a valid 0x7075
  // field) or that prove it (ASCII, strict UTF-8) are decided here; the rest
  // are `undecided`, kept as bytes and resolved once per archive by
  // readZipDirectory (resolveLegacyNames).
  let decoded = null;
  if (flags & 0x800) {
    decoded = new TextDecoder('utf-8').decode(nameBytes);
  } else {
    const up = extra.unicodePath;
    // An empty field would drop the entry: fall through to the header's own name.
    if (up && up.crc === crc32Of(nameBytes)) decoded = decodeUtf8Strict(up.bytes) || null;
    if (decoded === null && nameBytes.every((b) => b < 0x80)) decoded = new TextDecoder('utf-8').decode(nameBytes);
    if (decoded === null) decoded = decodeUtf8Strict(nameBytes);
  }
  let dir;
  let path = null;
  let rawBytes = null;
  if (decoded === null) {
    rawBytes = nameBytes.slice(); // a copy: nameBytes is a view into a reused piece
    dir = nameBytes[nameBytes.length - 1] === 0x2F;
  } else {
    // NFC: macOS writes decomposed names, which would not match anything typed.
    const name = decoded.normalize('NFC');
    dir = /[\\/]$/.test(name);
    path = sanitizePath(name);
    if (!path) return null;
  }

  // A directory entry carries no data, so there is nothing to refuse.
  if (!dir) {
    if (flags & 1) { skipped.encrypted++; if (!locked) return null; }
    else if (method !== 0 && method !== 8) { skipped.unsupported++; if (!locked) return null; }
  }

  const lastModified = extra.mtime ?? dosToMs(date, time);
  const entry = { path, dir, method, compressedSize, size, crc32, offset, flags, lastModified };
  if (rawBytes) entry.rawName = rawBytes;
  return entry;
}

// Where the central directory sits, from the end of the file alone: the EOCD
// (and the ZIP64 records, when there are any). `entries` is the count it
// declares. The converter reads a zip it holds only part of with this, to
// know which bytes to ask for next.
export async function zipDirectoryBounds(blob) {
  const total = blob.size;
  if (total < 22) throw new ZipReadError('not_zip', 'Not a zip file.');

  // Find the EOCD in the tail (plus the 20 bytes before it, for the ZIP64 locator).
  const tailStart = Math.max(0, total - EOCD_SCAN - 20);
  const tail = await readRange(blob, tailStart, total);
  const tv = viewOf(tail);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tv.getUint32(i, true) !== SIG_EOCD) continue;
    // A comment may itself contain the signature; the real record's comment
    // length must fit in what remains.
    if (i + 22 + tv.getUint16(i + 20, true) <= tail.length) { eocd = i; break; }
  }
  if (eocd < 0) throw new ZipReadError('not_zip', 'Not a zip file.');

  let entryCount = tv.getUint16(eocd + 10, true);
  let cdSize = tv.getUint32(eocd + 12, true);
  let cdOffset = tv.getUint32(eocd + 16, true);

  const hasLocator = eocd >= 20 && tv.getUint32(eocd - 20, true) === SIG_ZIP64_LOCATOR;
  const saturated = entryCount === 0xFFFF || cdSize === 0xFFFFFFFF || cdOffset === 0xFFFFFFFF;
  let zip64 = false;
  if (hasLocator || saturated) {
    if (!hasLocator) throw new ZipReadError('truncated', 'ZIP64 locator is missing.');
    const recAt = u64(tv, eocd - 20 + 8);
    if (recAt + 56 > total) throw new ZipReadError('truncated', 'ZIP64 record is past the end of the file.');
    const rec = await readRange(blob, recAt, recAt + 56);
    const rv = viewOf(rec);
    if (rv.getUint32(0, true) !== SIG_ZIP64_EOCD) throw new ZipReadError('truncated', 'ZIP64 record is damaged.');
    entryCount = u64(rv, 32);
    cdSize = u64(rv, 40);
    cdOffset = u64(rv, 48);
    zip64 = true;
  }
  if (cdOffset + cdSize > total) throw new ZipReadError('truncated', 'Central directory is past the end of the file.');
  return { cdStart: cdOffset, cdEnd: cdOffset + cdSize, entries: entryCount, zip64 };
}

// Read the central directory of `blob`. `pieceBytes` is the read granularity
// (default 8 MB); tests lower it to exercise a header straddling two reads.
// `locked` keeps the entries openEntry can't open (parseHeader), for showing
// what a zip holds rather than taking it out.
export async function readZipDirectory(blob, {
  onProgress, pieceBytes = PIECE_BYTES, locked = false, languages = globalThis.navigator?.languages ?? [],
} = {}) {
  const { cdStart, cdEnd, zip64 } = await zipDirectoryBounds(blob);

  const entries = [];
  const skipped = { encrypted: 0, unsupported: 0 };
  const end = cdEnd;
  let pos = cdStart;
  let carry = new Uint8Array(0);

  while (pos < end || carry.length) {
    let buf = carry;
    if (pos < end) {
      const n = Math.min(Math.max(1, pieceBytes), end - pos);
      const piece = await readRange(blob, pos, pos + n);
      pos += n;
      if (carry.length) {
        buf = new Uint8Array(carry.length + piece.length);
        buf.set(carry, 0);
        buf.set(piece, carry.length);
      } else {
        buf = piece;
      }
    }
    const view = viewOf(buf);
    let p = 0;
    for (;;) {
      if (buf.length - p < 46) break;
      if (view.getUint32(p, true) !== SIG_CENTRAL) {
        throw new ZipReadError('truncated', 'Central directory is damaged.');
      }
      const len = 46 + view.getUint16(p + 28, true) + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
      if (p + len > buf.length) break;
      const entry = parseHeader(buf, view, p, skipped, locked);
      p += len;
      if (entry) {
        entries.push(entry);
        if (entries.length % 1000 === 0) onProgress?.({ entries: entries.length });
      }
    }
    // slice(), not subarray(): the carry must not pin the whole 8 MB piece.
    carry = buf.slice(p);
    if (pos >= end) {
      // The directory ended mid-header.
      if (carry.length) throw new ZipReadError('truncated', 'Central directory ends mid-entry.');
      break;
    }
  }
  // Names nothing decided: one encoding for all of them.
  let nameEncoding = null;
  const undecided = entries.filter((e) => e.path === null);
  if (undecided.length) {
    const { encoding, names } = resolveLegacyNames(undecided.map((e) => e.rawName), languages);
    nameEncoding = encoding;
    undecided.forEach((e, i) => {
      const name = (names?.[i] ?? decodeCp437(e.rawName)).normalize('NFC');
      e.dir = /[\\/]$/.test(name);
      e.path = sanitizePath(name);
      delete e.rawName;
    });
    for (let i = entries.length - 1; i >= 0; i--) if (!entries[i].path) entries.splice(i, 1);
  }
  onProgress?.({ entries: entries.length });
  return { entries, skipped, zip64, nameEncoding };
}

// The bytes of one entry as a Blob. See the header for why STORE is a slice.
export async function openEntry(blob, entry) {
  if (blob.size < entry.offset + 30) throw new ZipReadError('truncated', 'Entry header is past the end of the file.');
  const head = await readRange(blob, entry.offset, entry.offset + 30);
  const hv = viewOf(head);
  if (hv.getUint32(0, true) !== SIG_LOCAL) throw new ZipReadError('truncated', 'Entry header is damaged.');
  const start = entry.offset + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);

  if (entry.method === 0) {
    if (start + entry.size > blob.size) throw new ZipReadError('truncated', 'Entry data is past the end of the file.');
    return blob.slice(start, start + entry.size);
  }

  if (!canInflate()) throw new ZipReadError('no_inflate', 'This browser cannot decompress zip entries.');
  if (start + entry.compressedSize > blob.size) throw new ZipReadError('truncated', 'Entry data is past the end of the file.');

  const reader = blob
    .slice(start, start + entry.compressedSize)
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
    .getReader();

  const parts = [];
  let pending = [];
  let pendingBytes = 0;
  let count = 0;
  let crc;
  try {
    for (;;) {
      let r;
      try {
        r = await reader.read();
      } catch (e) {
        // The platform inflater rejects on a stream that ends early or is not
        // deflate at all.
        throw new ZipReadError('truncated', 'Entry data is damaged or incomplete.');
      }
      if (r.done) break;
      const chunk = r.value;
      count += chunk.length;
      if (count > entry.size) {
        // Never inflate past the declared size.
        await reader.cancel().catch(() => {});
        throw new ZipReadError('too_big', 'Entry inflates to more than its declared size.');
      }
      crc = crc32Update(crc, chunk);
      pending.push(chunk);
      pendingBytes += chunk.length;
      if (pendingBytes >= FOLD_BYTES) {
        parts.push(new Blob(pending));
        pending = [];
        pendingBytes = 0;
      }
    }
  } finally {
    reader.releaseLock?.();
  }
  if (count < entry.size) throw new ZipReadError('truncated', 'Entry is shorter than its declared size.');
  if (crc32Final(crc) !== entry.crc32) throw new ZipReadError('crc', 'Entry failed its checksum.');
  return new Blob([...parts, ...pending]);
}

const MEDIA_EXT = /\.(jpe?g|png|heic|gif|webp|mp4|mov)$/i;
const SIDECAR_SUFFIX = '.supplemental-metadata';

// Google Photos writes "IMG_1.jpg.supplemental-metadata.json" next to each
// photo, with the suffix truncated to fit a filename limit
// ("IMG_1.jpg.supplemen.json"). They are metadata, not the user's files.
function isSidecar(segs) {
  const base = segs[segs.length - 1];
  if (!/\.json$/i.test(base)) return false;
  if (segs.slice(0, -1).includes('Google Photos')) return true;
  let stem = base.slice(0, -5);
  const dot = stem.lastIndexOf('.');
  if (dot >= 0) {
    const tailPart = stem.slice(dot).toLowerCase();
    if (tailPart.length > 1 && SIDECAR_SUFFIX.startsWith(tailPart)) stem = stem.slice(0, dot);
  }
  return MEDIA_EXT.test(stem);
}

function isJunkName(base) {
  const lower = base.toLowerCase();
  return base.startsWith('._') || lower === '.ds_store' || lower === 'thumbs.db' || lower === 'desktop.ini';
}

// Pre-order: a parent always precedes its children and a subtree is contiguous.
function compareSegments(a, b) {
  const as = a.split('/');
  const bs = b.split('/');
  const n = Math.min(as.length, bs.length);
  for (let i = 0; i < n; i++) {
    if (as[i] !== bs[i]) return as[i] < bs[i] ? -1 : 1;
  }
  return as.length - bs.length;
}

// Which dropped zips are parts of one export. Google Takeout and Google
// Drive's Download split a big export into <name>-<UTC stamp>-001.zip,
// -002.zip…, each holding a slice of one tree, so those merge. Any other zip
// stands alone: merged with an unrelated one it would nest inside the other's
// name, and two IMG_0001.JPGs at their roots would meet as duplicates and one
// would be dropped. → arrays of indexes into `names`, each in part order.
export function groupArchives(names) {
  const groups = new Map();
  Array.from(names || []).forEach((name, i) => {
    const m = /^(.*-\d{8}T\d{6}Z)-(\d{3})\.zip$/i.exec(String(name || ''));
    const key = m ? m[1].toLowerCase() : `\0${i}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ i, part: m ? Number(m[2]) : 0 });
  });
  return [...groups.values()].map((g) => g.sort((a, b) => a.part - b.part).map((x) => x.i));
}

// Merge the listings of several parts of one export into a single tree.
// listings: [{ name, entries }] (entries from readZipDirectory).
export function mergeArchives(listings) {
  const dropped = { macosx: 0, sidecars: 0, junk: 0, duplicates: 0 };
  let files = [];
  let dirPaths = [];
  const seen = new Set();

  listings.forEach((listing, zip) => {
    for (const entry of listing.entries || []) {
      const segs = entry.path.split('/');
      if (entry.dir) {
        // Empty-folder markers. Junk folders never become app folders, and
        // aren't counted: they are not files.
        if (!segs.includes('__MACOSX')) dirPaths.push(entry.path);
        continue;
      }
      if (seen.has(entry.path)) { dropped.duplicates++; continue; }
      seen.add(entry.path);
      if (segs.includes('__MACOSX')) { dropped.macosx++; continue; }
      if (isJunkName(segs[segs.length - 1])) { dropped.junk++; continue; }
      if (isSidecar(segs)) { dropped.sidecars++; continue; }
      files.push({ relPath: entry.path, size: entry.size, lastModified: entry.lastModified, zip, entry });
    }
  });

  // Strip a prefix from every file and every folder marker. A folder marker
  // outside the prefix, or the prefix itself, is not part of the tree.
  const strip = (prefix) => {
    files = files.map((f) => ({ ...f, relPath: f.relPath.slice(prefix.length + 1) }));
    dirPaths = dirPaths
      .filter((d) => d.startsWith(prefix + '/'))
      .map((d) => d.slice(prefix.length + 1));
  };
  const allUnder = (prefix) => files.length > 0 && files.every((f) => f.relPath.startsWith(prefix + '/'));

  let driveStripped = false;
  if (allUnder('Takeout')) {
    strip('Takeout');
    if (allUnder('Drive')) { strip('Drive'); driveStripped = true; }
  }

  let rootName;
  const first = files.length ? files[0].relPath.split('/')[0] : null;
  if (first && files.every((f) => f.relPath.includes('/') && f.relPath.split('/')[0] === first)) {
    rootName = first;
    strip(first);
  } else if (driveStripped) {
    rootName = 'Google Drive';
  } else {
    // A Takeout of several products ("takeout-20261019T091522Z-001.zip") gets
    // a name a person would give it, not Google's timestamp.
    const base = String(listings[0]?.name || '').replace(/\.zip$/i, '').replace(/-\d+$/, '');
    rootName = /^takeout-\d{8}T\d{6}Z$/i.test(base) ? 'Google Takeout' : base || 'Import';
  }

  // Every folder the files imply, parents included, plus the empty ones.
  const dirSet = new Set();
  const addWithParents = (path) => {
    const segs = path.split('/');
    for (let i = 1; i <= segs.length; i++) dirSet.add(segs.slice(0, i).join('/'));
  };
  for (const f of files) {
    const segs = f.relPath.split('/');
    if (segs.length > 1) addWithParents(segs.slice(0, -1).join('/'));
  }
  for (const d of dirPaths) if (d) addWithParents(d);
  const dirs = [...dirSet].sort(compareSegments);

  return { rootName, files, dirs, dropped };
}
