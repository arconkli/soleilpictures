// One file-name sanitizer for every download, export and signed header.
// PURE, no imports, so the Worker, the party and node tests can all use it.
//
// Checked sanitize-filename (unmaintained, cuts bytes, drops the extension);
// built our own on Intl.Segmenter. The old hand-written ones kept ASCII only
// ("報告書" became "___") or cut UTF-16 units with slice(), which leaves a lone
// surrogate that makes encodeURIComponent throw.

// Characters Windows or macOS refuse in a file name, plus C0 controls and DEL.
const ILLEGAL = /[\\/:*?"<>|\x00-\x1f\x7f]+/g;
// Bidi embedding/override/isolate controls: "invoice<RLO>fdp.exe" spoofs an extension.
const BIDI_CONTROLS = /[\u{202A}-\u{202E}\u{2066}-\u{2069}]/gu;
const LINE_SEPS = /[\u{2028}\u{2029}]+/gu;
const RESERVED = /^(con|prn|aux|nul|com[0-9\u{B9}\u{B2}\u{B3}]|lpt[0-9\u{B9}\u{B2}\u{B3}])$/iu;
const OWN_EXT = /\.([A-Za-z0-9]{1,10})$/;
// Regional indicators: a name of flags only is not Extended_Pictographic.
// Built at run time: a literal with a property the engine lacks fails the whole chunk.
const MEANINGFUL = (() => {
  try { return new RegExp('[\\p{L}\\p{N}\\p{Extended_Pictographic}\\p{Regional_Indicator}]', 'u'); } catch {
    return new RegExp('[\\p{L}\\p{N}\\u{1F1E6}-\\u{1F1FF}\\u{1F000}-\\u{1FAFF}\\u{2600}-\\u{27BF}]', 'u');
  }
})();
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

const encoder = new TextEncoder();
const byteLen = (s) => encoder.encode(s).length;

// Text with no lone surrogates, in NFC (macOS hands out NFD names).
export function wellFormed(s) {
  const str = String(s ?? '');
  const ok = typeof str.toWellFormed === 'function' ? str.toWellFormed() : str.replace(LONE_SURROGATE, '�');
  return ok.normalize('NFC');
}

// Grapheme clusters, so a cut never splits an emoji family or a base + accent.
function units(s) {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    return Array.from(new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(s), (x) => x.segment);
  }
  return Array.from(s);
}

// The longest whole-grapheme prefix within maxChars (code points) and maxBytes (UTF-8).
export function cutToLimits(s, { maxChars = Infinity, maxBytes = Infinity } = {}) {
  let out = '';
  let chars = 0;
  let bytes = 0;
  for (const u of units(String(s ?? ''))) {
    const c = Array.from(u).length;
    const b = byteLen(u);
    if (chars + c > maxChars || bytes + b > maxBytes) break;
    out += u;
    chars += c;
    bytes += b;
  }
  return out;
}

const tidy = (s) => s.replace(/^[\s.]+/, '').replace(/[\s.]+$/, '');

export function safeFileName(name, { ext = null, fallback = 'file', maxChars = 80, maxBytes = 200 } = {}) {
  const s = wellFormed(name).replace(BIDI_CONTROLS, '').replace(LINE_SEPS, ' ').replace(ILLEGAL, '-');
  let cleanExt = ext == null ? null : String(ext).replace(/^\.+/, '');
  if (cleanExt !== null && !/^[A-Za-z0-9]{1,10}$/.test(cleanExt)) cleanExt = null;

  let base = s;
  let tail = null;
  if (cleanExt) {
    const own = OWN_EXT.exec(s);
    if (own && own[1].toLowerCase() === cleanExt.toLowerCase()) {
      tail = own[1];
      base = s.slice(0, own.index);
    } else {
      tail = cleanExt.toLowerCase();
    }
  } else {
    const own = OWN_EXT.exec(tidy(s));
    if (own) {
      tail = own[1];
      base = tidy(s).slice(0, own.index);
    }
  }

  base = tidy(base);
  const dot = base.indexOf('.');
  const head = dot === -1 ? base : base.slice(0, dot);
  if (RESERVED.test(head.trim())) base = head + '_' + (dot === -1 ? '' : base.slice(dot));

  const room = maxBytes - (tail ? byteLen(tail) + 1 : 0);
  base = tidy(cutToLimits(base, { maxChars, maxBytes: room }));

  // The cut can leave only a reserved word ("con 12345" at 4 characters): escape it again,
  // cutting one place earlier so the underscore still fits.
  const reserved = (b) => RESERVED.test((b.indexOf('.') === -1 ? b : b.slice(0, b.indexOf('.'))).trim());
  if (reserved(base)) {
    base = tidy(cutToLimits(base, { maxChars: maxChars - 1, maxBytes: room - 1 }));
    const d = base.indexOf('.');
    base = d === -1 ? base + '_' : base.slice(0, d) + '_' + base.slice(d);
  }

  if (!MEANINGFUL.test(base)) base = String(fallback ?? '');
  if (!base) return '';
  return tail ? `${base}.${tail}` : base;
}
