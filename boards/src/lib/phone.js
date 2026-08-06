// Phone-number normalization — the routing key for everything Scout does.
//
// This lives on its own, with ZERO imports, because three very different
// runtimes need the exact same answer out of it:
//
//   · the Cloudflare Worker  (/api/scout/signup — someone typing their number
//     into the landing page)
//   · the Node ingest service (scoutIdentity.js — a handle Photon reports)
//   · tests
//
// It used to live inside scoutIdentity.js, which imports yjs. Importing that
// module at the edge just to normalize a string would drag the whole CRDT
// library into the Worker bundle, so the pure part was lifted out here.
//
// WHY THIS MATTERS MORE THAN IT LOOKS: scout_identities is keyed on
// (platform, handle). If the landing page stores "+1 555 123 4567" and Photon
// later reports "+15551234567", those are two different keys, and the person
// who signed up gets a SECOND account instead of the one waiting for them —
// with the invite sitting on a row nothing will ever match. One function, one
// answer, everywhere.

// Dialing codes for the countries film production actually happens in. Not a
// complete ITU table on purpose — this is a FALLBACK for the case where we're
// handed a national-format number, and a wrong guess is worse than an honest
// refusal (see the bottom of normalizeHandle).
const DIALING_CODES = {
  US: '1', CA: '1', PR: '1', DO: '1', JM: '1',
  GB: '44', IE: '353', FR: '33', DE: '49', ES: '34', PT: '351', IT: '39',
  NL: '31', BE: '32', CH: '41', AT: '43', SE: '46', NO: '47', DK: '45',
  FI: '358', IS: '354', PL: '48', CZ: '420', SK: '421', HU: '36', RO: '40',
  BG: '359', GR: '30', HR: '385', RS: '381', UA: '380', TR: '90',
  AU: '61', NZ: '64', JP: '81', KR: '82', CN: '86', HK: '852', TW: '886',
  SG: '65', MY: '60', TH: '66', PH: '63', ID: '62', IN: '91', PK: '92',
  AE: '971', SA: '966', IL: '972', JO: '962', MA: '212', EG: '20',
  ZA: '27', NG: '234', KE: '254', GH: '233',
  MX: '52', BR: '55', AR: '54', CL: '56', CO: '57', PE: '51', UY: '598',
};

// Italy keeps the leading 0 as part of the subscriber number; almost everywhere
// else it's a national trunk prefix that must be dropped before the country
// code. NANP numbers have no trunk prefix at all.
const KEEPS_LEADING_ZERO = new Set(['IT']);

// Normalize a chat handle into the routing key stored in scout_identities.
//
// The (platform, handle) unique index IS the routing table, so the only thing
// that truly matters is that ONE person always produces ONE handle. A handle
// that's merely ugly is fine; a handle that varies between messages silently
// creates a second account for someone who already exists.
//
// `country` is the ISO code the provider reports alongside the sender (or, on
// the landing page, the `cf-ipcountry` header). Photon documents it on the user
// object, and it's what makes non-US numbers safe: without it, a UK mobile in
// national form (7911123456) is indistinguishable from a US number and would
// normalize to +17911123456 — valid-looking, completely wrong, and impossible
// to notice until someone's board goes missing.
export function normalizeHandle(raw, country = null) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (s.includes('@')) return s.toLowerCase();

  const cleaned = s.replace(/[^\d+]/g, '');
  if (!cleaned) return s.toLowerCase();

  // Already E.164 — the expected path. Providers send this; trust it.
  if (cleaned.startsWith('+')) return `+${cleaned.replace(/\D/g, '')}`;

  const digits = cleaned.replace(/\D/g, '');
  const cc = country ? DIALING_CODES[String(country).toUpperCase()] : null;

  if (cc) {
    const iso = String(country).toUpperCase();
    let national = digits;
    // Drop the national trunk prefix (a leading 0 nearly everywhere).
    if (!KEEPS_LEADING_ZERO.has(iso) && national.startsWith('0')) national = national.slice(1);
    // The number may ALREADY carry its country code — someone typing "+" -lessly
    // often writes 15551234567, and a provider can report the same with country
    // US. Prepending again yields +115551234567, a second key for the same
    // person. Only strip when what's left is still a plausible subscriber
    // number, so a genuine local number that happens to begin with the dialing
    // digits survives.
    if (national.startsWith(cc) && national.length - cc.length >= 6) {
      national = national.slice(cc.length);
    }
    return `+${cc}${national}`;
  }

  // No country hint. Only assume North America when the shape is unambiguously
  // NANP, and even then only because the line itself is US-registered.
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;

  // Anything else: refuse to guess. A stable, obviously-not-E.164 key keeps the
  // user routed consistently and makes the gap visible in logs, instead of
  // minting a plausible wrong number that nobody catches.
  return `unknown:${digits}`;
}

// Is this a handle we can actually text?
//
// normalizeHandle NEVER throws — it always returns something routable, which is
// right for inbound (a weird handle still has to reach its owner's board) and
// wrong for the landing page, where we're about to send a stranger a message.
// So the signup path asks this instead: E.164, plausible length, and not the
// `unknown:` sentinel that means "I refused to guess".
// This must stay in lockstep with the CHECK in scout_request_invite (0210):
//   ^\+[1-9][0-9]{7,14}$
// If this is the looser of the two, a number gets past the page and is refused
// by Postgres instead — which surfaces as a generic 500 rather than the "check
// the number" message the person actually needs.
export function isTextablePhone(handle) {
  // No country code begins with 0, and ITU E.164 caps the whole number at 15
  // digits. Below 8 it is a typo, not a number.
  return /^\+[1-9][0-9]{7,14}$/.test(String(handle || ''));
}

// Display form for a number we're about to text back, e.g. "+1 (555) 012-3456".
// NANP only — everywhere else keeps E.164, which is unambiguous and correct
// even if it isn't how a local would write it. Guessing at national formatting
// for 60 countries would be a lot of code to occasionally insult someone.
export function formatPhone(e164) {
  const h = String(e164 || '');
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(h);
  return m ? `+1 (${m[1]}) ${m[2]}-${m[3]}` : h;
}
