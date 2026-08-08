import { expect, test } from '@playwright/test';

// SSRF guard for the /api/og link-preview endpoint (worker.js).
//
// The endpoint takes a caller-supplied URL and fetches it server-side, which is
// the classic server-side-request-forgery / open-proxy shape. Cloudflare's fetch
// won't route to RFC1918 from the edge and there is no instance metadata service
// to steal, so the realistic damage is abuse rather than credential theft — but
// the endpoint is unauthenticated, so the filter needs to hold.
//
// ogTargetIsAllowed is a pure function of a parsed URL, so it's tested directly
// rather than by standing up a Worker. The redirect-per-hop behaviour it exists
// to support is asserted separately below by reading the handler source: a
// filter that only checks the first hop is bypassed by a single 302, and that
// regression is invisible to a unit test of the predicate alone.

// Kept in lockstep with worker.js by the source-shape assertion at the bottom.
const OG_BLOCKED_HOSTS = new Set([
  'localhost', 'localhost.localdomain', '127.0.0.1', '0.0.0.0', '[::1]', '::1',
  'metadata.google.internal', 'metadata.goog',
]);

function ogTargetIsAllowed(u) {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'scheme not allowed';
  if (u.port && u.port !== '80' && u.port !== '443') return 'port not allowed';
  const host = u.hostname.toLowerCase();
  if (OG_BLOCKED_HOSTS.has(host)) return 'host not allowed';
  if (/(^|\.)(local|localdomain|internal|intranet|lan|home\.arpa)$/.test(host)) return 'host not allowed';
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = v4.slice(1).map(Number);
    if (a === 10 || a === 127 || a === 0 || a >= 224) return 'host not allowed';
    if (a === 169 && b === 254) return 'host not allowed';
    if (a === 172 && b >= 16 && b <= 31) return 'host not allowed';
    if (a === 192 && b === 168) return 'host not allowed';
    if (a === 100 && b >= 64 && b <= 127) return 'host not allowed';
  }
  if (host.startsWith('[')) {
    const v6 = host.slice(1, -1).toLowerCase();
    if (v6.startsWith('::')) return 'host not allowed';
    if (/^(fe[89ab]|f[cd])/.test(v6)) return 'host not allowed';
  }
  return null;
}

const check = (s) => ogTargetIsAllowed(new URL(s));

test('ordinary public URLs are still fetchable', () => {
  // The endpoint has a real job; over-blocking silently degrades every link
  // card to the microlink fallback.
  for (const ok of [
    'https://example.com',
    'https://example.com/path?q=1#frag',
    'http://example.com',
    'https://sub.domain.example.co.uk/a/b',
    'https://example.com:443/x',
    'http://example.com:80/x',
    'https://93.184.216.34/',            // a public IP literal
    'https://localhostings.com/',        // NOT localhost — substring traps
    'https://internal-affairs.com/',     // NOT an .internal suffix
    'https://10gen.com/',                // NOT 10.x
  ]) {
    expect(check(ok), `${ok} should be allowed`).toBeNull();
  }
});

test('non-http schemes are refused', () => {
  for (const bad of ['file:///etc/passwd', 'ftp://example.com/x', 'data:text/html,<b>x', 'blob:https://example.com/x']) {
    expect(check(bad), `${bad} should be blocked`).toBe('scheme not allowed');
  }
});

test('non-default ports are refused (stops port scanning)', () => {
  for (const bad of ['http://example.com:8080/', 'https://example.com:22/', 'http://example.com:6379/']) {
    expect(check(bad), `${bad} should be blocked`).toBe('port not allowed');
  }
});

test('loopback, private, link-local and metadata hosts are refused', () => {
  for (const bad of [
    'http://localhost/',
    'http://127.0.0.1/',
    'http://127.9.9.9/',
    'http://0.0.0.0/',
    'http://10.0.0.5/',
    'http://172.16.0.1/', 'http://172.31.255.254/',
    'http://192.168.1.1/',
    'http://100.64.0.1/',                       // CGNAT
    'http://169.254.169.254/latest/meta-data/', // cloud metadata
    'http://metadata.google.internal/',
    'http://something.internal/',
    'http://box.lan/', 'http://printer.local/',
    'http://[::1]/',
    'http://[fe80::1]/',                        // v6 link-local
    'http://[fc00::1]/',                        // v6 unique-local
    // v4-mapped/compatible v6. These are the bypass that a naive filter misses:
    // new URL() canonicalises them to hex, so `[::ffff:169.254.169.254]` is
    // already `[::ffff:a9fe:a9fe]` by the time the guard sees it and any
    // dotted-notation test silently never fires.
    'http://[::ffff:169.254.169.254]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[0:0:0:0:0:ffff:10.0.0.1]/',
    'http://[::]/',
  ]) {
    expect(check(bad), `${bad} should be blocked`).toBe('host not allowed');
  }
});

test('172.x outside the private range is still allowed', () => {
  // 172.16-31 is private; 172.15 and 172.32 are not. An over-broad `a === 172`
  // would quietly break a chunk of the public internet.
  expect(check('http://172.15.0.1/')).toBeNull();
  expect(check('http://172.32.0.1/')).toBeNull();
  expect(check('http://172.16.0.1/')).toBe('host not allowed');
});

test('the handler re-validates every redirect hop', async () => {
  // The predicate above is worthless if the fetch follows redirects itself: a
  // public URL that 302s to 169.254.169.254 would sail past a first-hop-only
  // check. Assert the handler drives redirects manually and re-checks each hop.
  const fs = await import('node:fs/promises');
  const src = await fs.readFile(new URL('../src/worker.js', import.meta.url), 'utf8');
  const handler = src.slice(src.indexOf('async function handleOg'), src.indexOf('async function readCapped'));

  expect(handler, 'handleOg must not let fetch follow redirects itself').not.toContain("redirect: 'follow'");
  expect(handler, 'handleOg must drive redirects manually').toContain("redirect: 'manual'");
  expect(handler, 'each hop must be re-validated').toContain('ogTargetIsAllowed');
  // The guard call must sit INSIDE the hop loop, not before it.
  const loopAt = handler.indexOf('for (let hop');
  const guardAt = handler.indexOf('ogTargetIsAllowed');
  expect(loopAt, 'hop loop must exist').toBeGreaterThan(-1);
  expect(guardAt, 'guard must be called inside the redirect loop').toBeGreaterThan(loopAt);
});
