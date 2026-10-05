// Is this a URL the SERVER may fetch or call?
//
// One definition, because there is more than one place that asks. Webhooks
// POST to a customer-supplied URL; the importer GETs one; the link-preview
// endpoint (/api/og) GETs one for anybody, unauthenticated. All three hand an
// attacker-chosen address to a process sitting inside our network, which is the
// whole shape of SSRF: `http://169.254.169.254/…` is a cloud metadata endpoint,
// `http://localhost:8787/…` is another service on the same box.
//
// Until 2026-10-02 there were TWO copies of this rule, and they had already
// diverged in exactly the direction this header warned about: the importer's and
// the webhooks' copy (this file) let through the v4-mapped IPv6 form of the
// metadata address (`[::ffff:169.254.169.254]`, which `new URL` canonicalises to
// `[::ffff:a9fe:a9fe]`), `[::]`, CGNAT, multicast, broadcast and `.lan` /
// `.home.arpa` names — all of which the /api/og copy in worker.js refused. The
// stricter rule is now the only rule, and worker.js imports it.
//
// It is also a rule about EVERY hop, not the first. A check on the submitted URL
// is worthless if fetch() then follows a 302 to an address the check would have
// refused, and the importer did exactly that (`redirect: 'follow'`). Fetch
// through fetchFollowingSafely, which drives redirects by hand and re-checks
// each Location before the next request.
//
// This is deliberately a DENY-list of shapes rather than a DNS check. A Worker
// cannot resolve a hostname before fetching it, so a name that resolves to
// 127.0.0.1 still gets through — the real containment is that the fetch runs
// with no credentials, no cookies and no access to any internal binding, and
// that its response is only ever stored, never interpreted. What this stops is
// the direct, obvious address, at every hop.

const BLOCKED_HOSTS = new Set([
  'localhost', 'localhost.localdomain', '127.0.0.1', '0.0.0.0', '::1', '[::1]',
  'metadata.google.internal', 'metadata.goog',
]);

// Internal-only DNS suffixes. `localhost` is one too: every *.localhost name
// resolves to loopback (RFC 6761), so foo.localhost is localhost.
const INTERNAL_SUFFIX = /(^|\.)(localhost|local|localdomain|internal|intranet|lan|home\.arpa)$/;

/**
 * The host rule, shared by every caller. Returns true when the URL's host is
 * one the server must never fetch.
 */
export function isBlockedHost(u) {
  let host = String(u?.hostname || '').toLowerCase();
  // One trailing dot is the DNS root: "localhost." IS localhost, and the URL
  // parser keeps the dot (it also turns "localhost%2e" and "localhost。" into
  // exactly that). Without this every name rule below was one character from
  // useless — a 302 to metadata.google.internal. was followed.
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (!host) return true;
  if (BLOCKED_HOSTS.has(host) || INTERNAL_SUFFIX.test(host)) return true;

  // IPv4 literals: loopback, private, link-local (incl. cloud metadata at
  // 169.254.169.254), CGNAT, "this network", multicast and broadcast.
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = v4.slice(1).map(Number);
    if (a === 10 || a === 127 || a === 0 || a >= 224) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }

  // IPv6 literals: loopback, link-local (fe80::/10), unique-local (fc00::/7),
  // and the whole `::`-prefixed low block.
  //
  // That last rule is what stops the v4-mapped bypass, and it is NOT the
  // obvious check. `new URL()` canonicalises IPv6, so
  // `[::ffff:169.254.169.254]` arrives here as `[::ffff:a9fe:a9fe]` — the
  // dotted form is gone by the time we see it. Matching on the `::` prefix
  // catches ::1, ::, ::ffff:* (v4-mapped) and ::a.b.c.d (v4-compatible) alike,
  // and costs nothing: no publicly routable address lives in that block.
  if (host.startsWith('[')) {
    const v6 = host.slice(1, -1);
    if (v6.startsWith('::')) return true;
    if (/^(fe[89ab]|f[cd])/.test(v6)) return true;
    // Site-local (fec0::/10, deprecated but routable inside some networks) and
    // multicast (ff00::/8).
    if (/^(fe[c-f]|ff)/.test(v6)) return true;
    // The transition prefixes that carry an IPv4 address INSIDE the IPv6 one:
    // NAT64 (64:ff9b::/96 and the local-use 64:ff9b:1::/48), 6to4 (2002::/16)
    // and Teredo (2001:0::/32, which canonicalises to "2001:0:" or "2001::").
    // [64:ff9b::a9fe:a9fe] is 169.254.169.254 through a NAT64 gateway. Rather
    // than decode each one and re-run the IPv4 rule, refuse the prefixes: no
    // public import source is addressed this way.
    if (/^(64:ff9b:|2002:|2001:(0:|:))/.test(v6)) return true;
  }
  return false;
}

/**
 * Webhooks and the importer: absolute https on the default port, public host.
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
  if (isBlockedHost(u)) return 'must be a public host';
  return null;
}

/**
 * The /api/og link-preview endpoint: http or https on a default port, public
 * host. Takes a parsed URL; returns the reason it is refused, or null.
 */
export function ogTargetProblem(u) {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'scheme not allowed';
  // Only the default ports. Anything else is someone probing infrastructure.
  if (u.port && u.port !== '80' && u.port !== '443') return 'port not allowed';
  if (isBlockedHost(u)) return 'host not allowed';
  return null;
}

export class UnsafeFetchError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'UnsafeFetchError';
    this.code = code;
  }
}

/**
 * fetch() that follows redirects BY HAND, re-checking every hop.
 *
 * `check(parsedUrl)` returns a reason string to refuse that hop, or null. A
 * refused hop or a redirect loop throws UnsafeFetchError (code 'blocked_hop' or
 * 'too_many_redirects'); any other failure is fetch's own. Returns the final
 * non-redirect Response and the URL it came from.
 *
 * A 3xx without a Location is returned as the final response, as fetch would.
 */
export async function fetchFollowingSafely(url, init = {}, { check, maxHops = 5, fetchImpl = fetch } = {}) {
  if (typeof check !== 'function') throw new TypeError('fetchFollowingSafely needs a check');
  let current = String(url);
  for (let hop = 0; hop <= maxHops; hop++) {
    let parsed;
    try {
      parsed = new URL(current);
    } catch {
      throw new UnsafeFetchError('a redirect pointed at an unparseable address', 'blocked_hop');
    }
    const problem = check(parsed);
    if (problem) {
      throw new UnsafeFetchError(
        hop === 0 ? `refused: ${problem}` : `refused a redirect: ${problem}`, 'blocked_hop');
    }
    const res = await fetchImpl(current, { ...init, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return { res, url: current };
      // Release the redirect's body before the next hop: an unread body holds
      // a connection open, and a Worker gets six at a time — exactly the
      // importer's concurrency.
      try { await res.body?.cancel?.(); } catch (_) { /* already closed */ }
      // A Location that does not parse is a refused hop, not fetch's own
      // TypeError — the importer reports the two differently.
      try {
        current = new URL(loc, current).toString();   // resolve relative hops
      } catch {
        throw new UnsafeFetchError('a redirect pointed at an unparseable address', 'blocked_hop');
      }
      continue;
    }
    return { res, url: current };
  }
  throw new UnsafeFetchError(`more than ${maxHops} redirects`, 'too_many_redirects');
}
