// mailboxLink.js — a one-tap way to the inbox from the sign-in code step, and
// a hint for addresses whose mail servers hold codes back.
//
// After the 2026-09-20 invite abuse, Gmail filed our sign-in codes as spam for
// most of a week: people were waiting at the code step for an email sitting in
// a folder they never look in. The Gmail link opens a search across EVERY
// folder (in:anywhere) for our mail from the last day, in a new tab, so the
// code step stays where it is. Work and school servers are the other slow path:
// they quarantine or delay unknown senders, and those addresses never reached
// the app far more often than consumer ones.
const GMAIL_SEARCH = 'in:anywhere from:soleilpictures newer_than:1d';

const PROVIDERS = Object.freeze([
  { id: 'gmail',   label: 'Open Gmail',       test: /^(gmail|googlemail)\.com$/,
    href: () => `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(GMAIL_SEARCH)}` },
  { id: 'outlook', label: 'Open Outlook',     test: /^(outlook|hotmail|live|msn)\.[a-z.]+$/,
    href: () => 'https://outlook.live.com/mail/0/' },
  { id: 'yahoo',   label: 'Open Yahoo Mail',  test: /^(yahoo|ymail)\.[a-z.]+$/,
    href: () => 'https://mail.yahoo.com/' },
  { id: 'icloud',  label: 'Open iCloud Mail', test: /^(icloud|me|mac)\.com$/,
    href: () => 'https://www.icloud.com/mail' },
  { id: 'proton',  label: 'Open Proton Mail', test: /^(proton\.me|protonmail\.(com|ch)|pm\.me)$/,
    href: () => 'https://mail.proton.me/u/0/inbox' },
]);

// Consumer providers beyond the five with a web inbox link — the hint about
// work mail must not appear for a gmx.de or naver.com address.
const OTHER_CONSUMER = /^(aol|gmx|web|yandex|mail|inbox|list|bk|rambler|qq|163|126|yeah|sina|sohu|naver|daum|hanmail|kakao|nate|libero|virgilio|tiscali|alice|orange|free|laposte|sfr|wanadoo|bol|uol|terra|ig|rediffmail|zoho|tutanota|tuta|fastmail|hey|mailbox|posteo|seznam|wp|o2|onet|interia|t-online|freenet|bluewin|telenet|skynet|shaw|rogers|sympatico|bigpond|optusnet|comcast|verizon|att|sbcglobal|cox|charter|earthlink|btinternet|sky|virginmedia|talktalk|ntlworld|ziggo|kpn|home|planet|telia|xs4all)\.[a-z.]+$/;

function domainOf(email) {
  if (typeof email !== 'string') return '';
  const at = email.lastIndexOf('@');
  return at < 0 ? '' : email.slice(at + 1).trim().toLowerCase();
}

// { id, label, href } for an address with a known web inbox, else null.
export function mailboxFor(email) {
  const d = domainOf(email);
  if (!d) return null;
  const p = PROVIDERS.find((x) => x.test.test(d));
  return p ? { id: p.id, label: p.label, href: p.href() } : null;
}

// True for a personal mailbox provider; false for a work, school or custom
// domain (the ones that can hold a code back for minutes).
export function isConsumerAddress(email) {
  const d = domainOf(email);
  if (!d) return true;               // nothing to say about an empty field
  return PROVIDERS.some((x) => x.test.test(d)) || OTHER_CONSUMER.test(d);
}
