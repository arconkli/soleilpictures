// emailKind.test.mjs — the database's idea of a consumer address is the app's.
//
// _email_kind (0472) sorts addresses into consumer | school | custom_domain |
// ours | unknown for the admin reads. Its consumer patterns are mailboxLink.js's
// PROVIDERS and OTHER_CONSUMER, copied pattern for pattern, and nothing else
// keeps the two together. So: the same patterns in the same order, every
// domain emailTypo.js corrects to reads as consumer on both sides, and school
// is decided first, so mail.harvard.edu is a school even though mail.* is a
// consumer pattern.
//
//   node --test src/lib/emailKind.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { latestDefinition, MIGRATIONS_DIR } from './migrationText.mjs';
import { isConsumerAddress } from './mailboxLink.js';

const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const mailbox = read('./mailboxLink.js');
const typo = read('./emailTypo.js');

const clientPatterns = [
  ...[...mailbox.matchAll(/\btest:\s*\/(.+?)\/,/g)].map((m) => m[1]),
  mailbox.match(/const OTHER_CONSUMER = \/(.+)\/;/)?.[1],
];

const kind = latestDefinition('_email_kind');
const serverPatterns = (() => {
  const arr = kind?.body.match(/~ any \(array\[([\s\S]*?)\]\)/);
  return arr ? [...arr[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
})();

test("the consumer patterns are mailboxLink.js's, in its order", () => {
  assert.ok(kind, '_email_kind is defined in supabase/migrations');
  assert.ok(clientPatterns.length >= 7 && clientPatterns.every(Boolean), 'read the PROVIDERS tests and OTHER_CONSUMER');
  assert.deepEqual(serverPatterns, clientPatterns);
});

test('both sides call the same domains consumer', () => {
  const server = serverPatterns.map((s) => new RegExp(s));
  const typoDomains = [...(typo.match(/const DOMAINS = Object\.freeze\(\[([\s\S]*?)\]\)/)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(typoDomains.length >= 10, 'read emailTypo.js DOMAINS');
  const domains = [
    ...typoDomains,
    'yahoo.co.jp', 'pm.me', 'gmx.de', 'naver.com', 'mail.ru', 'web.de', 'qq.com', 't-online.de',
    'acme.io', 'studio.film', 'umn.edu', 'cs.ox.ac.uk',
  ];
  for (const d of domains) {
    assert.equal(server.some((r) => r.test(d)), isConsumerAddress(`someone@${d}`), d);
  }
  for (const d of typoDomains) assert.ok(server.some((r) => r.test(d)), `${d} reads as consumer`);
});

test('school is decided before the consumer list, by the higher-education suffixes alone', () => {
  const body = kind.body;
  const school = body.indexOf("then 'school'");
  assert.ok(school > 0 && school < body.indexOf('~ any (array['), 'school first');
  assert.match(body, /when dom ~ '\(\^\|\\\.\)edu\$\|\\\.\(edu\|ac\)\\\.\[a-z\]\{2\}\$' then 'school'/);
  assert.doesNotMatch(body, /k12|\bsch\\\./i, 'no K-12 pattern');
});

test('neither function is reachable by a client role', () => {
  const src = readFileSync(join(MIGRATIONS_DIR, kind.file), 'utf8');
  for (const fn of ['_email_kind', '_email_school_domain']) {
    assert.match(src, new RegExp(`^revoke all on function public\\.${fn}\\(text\\) from public, anon, authenticated;$`, 'm'));
    const grants = [...src.matchAll(new RegExp(`grant execute on function public\\.${fn}\\(text\\) to ([^;]+);`, 'g'))].map((m) => m[1]);
    assert.deepEqual(grants, ['service_role']);
  }
  assert.equal(latestDefinition('_email_school_domain')?.file, kind.file);
});
