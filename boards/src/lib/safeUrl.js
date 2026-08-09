// Is this a URL the SERVER may fetch or call?
//
// One definition, because there is now more than one place that asks. Webhooks
// POST to a customer-supplied URL; the importer GETs one. Both hand an
// attacker-chosen address to a process sitting inside our network, which is the
// whole shape of SSRF: `http://169.254.169.254/…` is a cloud metadata endpoint,
// `http://localhost:8787/…` is another service on the same box.
//
// A second copy of this rule is the kind of thing that stays right for a year
// and then diverges silently in the direction of permissive.
//
// This is deliberately a DENY-list of shapes rather than a DNS check. A Worker
// cannot resolve a hostname before fetching it, so a name that resolves to
// 127.0.0.1 still gets through — the real containment is that the fetch runs
// with no credentials, no cookies and no access to any internal binding, and
// that its response is only ever stored, never interpreted. What this stops is
// the direct, obvious address.

const BLOCKED_HOSTS = new Set([
  'localhost', 'localhost.localdomain', '127.0.0.1', '0.0.0.0', '::1', '[::1]',
  'metadata.google.internal', 'metadata.goog',
]);

// The private and link-local IPv4 ranges, plus the cloud metadata address that
// lives inside 169.254/16 and is the single most-targeted one.
const PRIVATE_V4 = /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

/**
 * Returns a sentence describing what is wrong, or null if the URL is fine to
 * call from the server. The message is shown to the caller, so it says what to
 * change rather than that something was rejected.
 */
export function publicHttpsUrlProblem(raw) {
  let u;
  try {
    u = new URL(String(raw));
  } catch {
    return 'must be an absolute https URL';
  }
  if (u.protocol !== 'https:') return 'must use https';
  if (u.port && u.port !== '443') return 'must use the default port';

  const host = u.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host) || host.endsWith('.local') || host.endsWith('.internal')) {
    return 'must be a public host';
  }
  if (PRIVATE_V4.test(host)) return 'must be a public host';
  // Bracketed IPv6 literals: unique-local (fc00::/7) and link-local (fe80::/10).
  if (/^\[(::1|fc|fd|fe8|fe9|fea|feb)/i.test(u.hostname)) return 'must be a public host';

  return null;
}
