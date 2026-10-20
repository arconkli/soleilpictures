// emailTypo.js — a mistyped consumer domain gets a one-tap fix, and an address
// that cannot receive mail is refused before the code is sent.
//
// Submitting an address creates the account on the spot (shouldCreateUser and
// email autoconfirm), so a typo becomes an account whose code goes nowhere: the
// person waits a couple of minutes for it and leaves, or comes back with the
// right address as a second account. Many signups that never got past the code
// step had typed gmail.como, gamil.com, a bare "gmail", or a domain with no
// ending at all (@ddsb, @a.m). The form can see this before the send. Pure,
// node-testable, no network: a small dictionary of consumer providers, a map of
// the typos actually seen, and an edit distance for the rest.
//
// suggestEmail only ever OFFERS. emailProblem is the one thing the form refuses.

const DOMAINS = Object.freeze([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'hotmail.com', 'hotmail.co.uk',
  'outlook.com', 'live.com', 'msn.com', 'aol.com', 'icloud.com', 'me.com', 'mac.com',
  'protonmail.com', 'proton.me',
]);
const KNOWN = new Set(DOMAINS);

// Bare provider names → the domain (someone typed "me@gmail").
const BARE = Object.freeze({
  gmail: 'gmail.com', googlemail: 'googlemail.com', yahoo: 'yahoo.com', hotmail: 'hotmail.com',
  outlook: 'outlook.com', live: 'live.com', msn: 'msn.com', aol: 'aol.com', icloud: 'icloud.com',
  protonmail: 'protonmail.com',
});

// Typos observed on real signups plus the obvious neighbours. Checked before
// the distance rule so a very short domain (gmail.co) resolves deterministically.
const TYPOS = Object.freeze({
  'gmail.co': 'gmail.com', 'gmail.con': 'gmail.com', 'gmail.cm': 'gmail.com', 'gmail.como': 'gmail.com',
  'gmail.comm': 'gmail.com', 'gmial.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gamil.com': 'gmail.com',
  'gmaill.com': 'gmail.com', 'gmasil.com': 'gmail.com', 'gnail.com': 'gmail.com', 'gmail.om': 'gmail.com',
  'hotmal.com': 'hotmail.com', 'hotmail.co': 'hotmail.com', 'hotmai.com': 'hotmail.com', 'hotmial.com': 'hotmail.com',
  'yaho.com': 'yahoo.com', 'yahoo.co': 'yahoo.com', 'yahooo.com': 'yahoo.com',
  'outlok.com': 'outlook.com', 'outlook.co': 'outlook.com', 'iclould.com': 'icloud.com', 'icloud.co': 'icloud.com',
});

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j += 1) prev[j] = j;
  for (let i = 1; i <= m; i += 1) {
    const cur = [i];
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

function fixDomain(domain) {
  if (!domain) return null;
  if (KNOWN.has(domain)) return null;
  if (TYPOS[domain]) return TYPOS[domain];
  if (!domain.includes('.')) return BARE[domain] || null;
  // Close to a known provider, same first letter, and not so short that the
  // distance is meaningless. Corporate domains never land here: they are not
  // within two edits of a consumer provider.
  let best = null, bestD = Infinity;
  for (const d of DOMAINS) {
    if (d[0] !== domain[0]) continue;
    const dist = levenshtein(domain, d);
    const limit = d.length >= 7 ? 2 : 1;
    if (dist <= limit && dist < bestD) { best = d; bestD = dist; }
  }
  return best;
}

// { suggestion, fromDomain, toDomain } or null. The local part is kept verbatim
// (case included); only the domain is compared, lower-cased.
export function suggestEmail(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  const at = s.indexOf('@');
  if (at <= 0 || at !== s.lastIndexOf('@')) return null;
  const local = s.slice(0, at);
  const domain = s.slice(at + 1).toLowerCase();
  if (!local || !domain || /\s/.test(domain)) return null;
  const to = fixDomain(domain);
  if (!to || to === domain) return null;
  return { suggestion: `${local}@${to}`, fromDomain: domain, toDomain: to };
}

// A domain whose last label cannot be a top-level domain: no dot at all (@ddsb,
// @maildrop), a one-letter ending (@a.m), digits, or an empty one (@ddsb.).
// The browser's type="email" check passes these, because user@localhost is a
// valid HTML address, and GoTrue then sends a code into the void. 'no_tld' or
// null; everything else about the address is left to the browser and GoTrue.
const TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

export function emailProblem(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  const at = s.lastIndexOf('@');
  if (at <= 0) return null;
  const labels = s.slice(at + 1).toLowerCase().split('.');
  if (labels.length < 2 || !TLD.test(labels[labels.length - 1])) return 'no_tld';
  return null;
}
