import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { latestDefinition } from './migrationText.mjs';

// /docs/security is the URL given out as the "trust center" in directory
// listings and to Team buyers, and /.well-known/security.txt points scanners at
// it. It states only what is true today, so the claims it makes are pinned to
// the code that makes them true: change one of these and the page has to change
// with it (content/docs/security.md, then npm run docs:build).
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const page = read('../../content/docs/security.md');
const securityTxt = read('../../public/.well-known/security.txt');
const worker = read('../worker.js');

function field(name) {
  const m = securityTxt.match(new RegExp(`^${name}:\\s*(.+)$`, 'm'));
  assert.ok(m, `security.txt has no ${name}: line`);
  return m[1].trim();
}

test('security.txt is in date: renew it before it lapses (RFC 9116 wants under a year)', () => {
  const expires = Date.parse(field('Expires'));
  assert.ok(Number.isFinite(expires), 'Expires must be an ISO 8601 date');
  const days = (expires - Date.now()) / 86_400_000;
  assert.ok(days > 30, `security.txt expires in ${Math.floor(days)} days: set Expires about a year out`);
  assert.ok(days <= 366, 'security.txt Expires should be no more than a year away');
});

test('security.txt and the page give the same contact and point at each other', () => {
  const contact = field('Contact');
  assert.match(contact, /^mailto:/);
  assert.ok(page.includes(contact.slice('mailto:'.length)), 'the page must name the security.txt Contact address');
  assert.equal(field('Canonical'), 'https://clusters.soleilpictures.com/.well-known/security.txt');
  assert.equal(field('Policy'), 'https://clusters.soleilpictures.com/docs/security#report-a-vulnerability');
  assert.match(page, /^## Report a vulnerability$/m, 'the Policy anchor is this heading');
  assert.ok(page.includes('(https://clusters.soleilpictures.com/.well-known/security.txt)'), 'the page links security.txt');
});

test('/security is the short address for the page', () => {
  assert.match(worker, /\['\/security',\s*'\/docs\/security'\]/, "worker.js RETIRED_PAGES must map '/security' to '/docs/security'");
});

test('the page claims no certification, two-step sign-in or SSO that does not exist', () => {
  assert.ok(page.includes('has no SOC 2'), 'the page must say plainly there is no SOC 2');
  assert.match(page, /two-step sign-in or single sign-on[\s\S]*?a: Not today\./, 'the FAQ must say two-step and SSO are not offered today');
});

test('sign-in and keys: what the page says is what the code does', () => {
  // New keys made in Settings start read-only.
  assert.match(read('../components/settings/ConnectionsTab.jsx'), /useState\('read'\)/);
  // Keys and tokens are kept only as a SHA-256 hash.
  assert.match(read('./apiAuth.js'), /crypto\.subtle\.digest\('SHA-256'/);
  // A connected app gets read and write unless it asks for more, and the
  // consent screen's "Allow deleting" starts off.
  const oauth = read('../worker-oauth.js');
  assert.match(oauth, /const DEFAULT_SCOPES = \['read', 'write'\];/);
  assert.match(oauth, /code_challenge_methods_supported: \['S256'\]/);
  const consent = read('../pages/OAuthConsentPage.jsx');
  assert.match(consent, /const \[allowDelete, setAllowDelete\] = useState\(false\);/);
  assert.ok(consent.includes("'Allow deleting'") && page.includes('**Allow\n  deleting**'));
});

test('transport headers the page describes are the ones the Worker sends', () => {
  assert.match(worker, /'strict-transport-security': 'max-age=\d+; includeSubDomains'/);
  assert.match(worker, /'x-frame-options': 'DENY'/);
  assert.match(worker, /'x-content-type-options': 'nosniff'/);
});

test('the daily check still alerts when a table loses row-level security', () => {
  const def = latestDefinition('check_security_invariants');
  assert.ok(def, 'check_security_invariants() is gone: the page says a daily check watches row-level security');
  assert.match(def.body, /not c\.relrowsecurity/);
});
