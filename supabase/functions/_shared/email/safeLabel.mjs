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
//   - anything shaped like a link: a scheme, `www.`, or a `name.tld` token.
//     The text is NFKC-normalised first, and look-alike full stops are folded
//     to ".", so a full-width or ideographic dot is still a dot
//   - length, capped with an ellipsis
//
// Plain JavaScript (.mjs) so the Deno edge function and the node test suite
// import the same code. No dependencies.
//
// The special characters below are written as code points, never as escape
// sequences in the source: the tooling this file is deployed through rewrites
// such escapes into the characters themselves, and a raw line separator inside
// a regular-expression literal is a syntax error that fails the whole bundle.

const cp = (...codes) => String.fromCodePoint(...codes);

// Ideographic and halfwidth full stops, one-dot leader, hyphenation point.
const LOOKALIKE_DOTS = new Set([0x3002, 0xff61, 0x2024, 0x2027]);
const ELLIPSIS = cp(0x2026);
// What a removed link leaves trailing: spaces, colons, commas, hyphens, and
// en/em dashes ("Log in -", "see:").
const TRAILING_LEAD_IN = new RegExp("[\\s:;,\\-" + cp(0x2013, 0x2014) + "]+$", "u");

const SCHEME = /[a-z][a-z0-9+.-]*:\/\/\S*/giu;
const WWW = /www\.\S*/giu;
// One or more labels, a dot, then an all-letter top-level label of two or more
// (Cyrillic included), with an optional path. "v2.0" and "Mr. Smith" survive;
// "calendar.app.google/x" and "яндекс.рф" do not.
const DOMAINISH = /[\p{L}\p{N}][\p{L}\p{N}_-]*(?:\.[\p{L}\p{N}_-]+)*\.\p{L}{2,}(?:[/?#]\S*)?/gu;
// A plain mailbox address and nothing else: no scheme, path, port or space.
const PLAIN_ADDRESS = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const INVISIBLE = /\p{Default_Ignorable_Code_Point}/u;

// C0 and C1 controls, plus the two Unicode line terminators.
function isControl(c) {
  return c < 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029;
}

// Invisible characters are dropped (so a split domain closes up again and is
// then caught), controls become `withText`, and look-alike dots become "."
// when asked.
function scrub(s, withText, foldDots) {
  let out = "";
  for (const ch of s) {
    if (INVISIBLE.test(ch)) continue;
    const c = ch.codePointAt(0);
    out += isControl(c) ? withText : (foldDots && LOOKALIKE_DOTS.has(c)) ? "." : ch;
  }
  return out;
}

/**
 * Free text from a name field, safe for a subject line or a heading.
 * @param {unknown} value
 * @param {number} [max=60]  characters, ellipsis included
 * @param {string} [fallback=""]  returned when nothing usable is left
 * @returns {string}
 */
export function safeLabel(value, max = 60, fallback = "") {
  let s = scrub(String(value ?? "").normalize("NFKC"), " ", true);
  s = s.replace(SCHEME, " ").replace(WWW, " ").replace(DOMAINISH, " ");
  s = s.replace(/\s+/g, " ").trim().replace(TRAILING_LEAD_IN, "").trim();
  if (!s) return fallback;
  const chars = [...s];
  if (chars.length > max) s = chars.slice(0, Math.max(1, max - 1)).join("").trimEnd() + ELLIPSIS;
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
  const s = scrub(String(value ?? "").normalize("NFKC"), "", false).trim();
  if (s.length <= 100 && PLAIN_ADDRESS.test(s) && !/^www\./i.test(s)) return s;
  return safeLabel(s, max, fallback);
}
