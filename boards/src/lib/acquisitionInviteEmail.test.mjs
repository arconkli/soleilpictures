// acquisitionInviteEmail.test.mjs — 0888: sign-ups from an email are
// filed under 'email', invited people with no other source under 'invite'.
//
//   node --test src/lib/acquisitionInviteEmail.test.mjs
//
// derive_acquisition_channel is 0741's body with one declaration and two arms
// added (firstSourceInvitedMark.test.mjs covers 0889, which sets the marker the
// invite arms read). These pin the text. The behaviour is proved by the
// migration's own asserts when it is applied.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, latestDefinition, definitionsOf, bodyText } from './migrationText.mjs';

const F888 = '0888_channel_email_and_invite.sql';
const strip = (s) => s.replace(/--.*$/gm, '');
const src888 = readFileSync(join(MIGRATIONS_DIR, F888), 'utf8');

const DECL = `inv boolean := coalesce(fs->>'invited', '') = 'true';`;
const LAST = `if inv then return 'invite'; end if;`;
const MAIL_END = `then return case when inv then 'invite' else 'email' end; end if;`;

test("derive_acquisition_channel is 0741's body plus the declaration, the mail arm and the last arm", () => {
  const [prev, now] = definitionsOf('derive_acquisition_channel').slice(-2);
  assert.equal(prev.file, '0741_channel_credits_file_shares.sql');
  assert.equal(now.file, F888);
  assert.equal(latestDefinition('derive_acquisition_channel').file, F888);
  let a = bodyText(strip(now.body));
  const b = bodyText(strip(prev.body));
  for (const piece of [DECL, LAST, MAIL_END]) assert.equal(a.split(piece).length, 2, `${piece} appears once`);
  const from = a.indexOf("if ref ~ '(^|//)(mail");
  const to = a.indexOf(MAIL_END) + MAIL_END.length;
  assert.ok(from > 0 && to > from, 'the mail arm is there');
  a = a.slice(0, from) + a.slice(to).replace(/^ /, '');
  a = a.replace(DECL + ' ', '').replace(LAST + ' ', '');
  assert.equal(a, b, 'and nothing else moved');
});

test('the mail arm runs before the assistants and the search engines, and only on a referrer', () => {
  const a = bodyText(strip(latestDefinition('derive_acquisition_channel').body));
  const mail = a.indexOf("if ref ~ '(^|//)(mail");
  assert.ok(a.indexOf("if ref <> '' then") < mail);
  assert.ok(mail < a.indexOf("if ref ~ '(chatgpt"));
  assert.ok(mail < a.indexOf("if ref ~ 'google[.]'"));
  assert.ok(a.indexOf('if utm_s <> ') < mail, 'a utm_source still leads');
  for (const host of ['mail\\.google\\.com', 'com\\.google\\.android\\.gm(\\.lite)?', 'outlook\\.live\\.com',
    'com\\.microsoft\\.office\\.outlook', 'mail\\.yahoo\\.com', 'mail\\.proton\\.me']) {
    assert.ok(a.includes(host), `${host} is a mail host`);
  }
  assert.ok(a.includes(")($|[/:])'"), 'whole host names only');
});

test("'invite' is the last arm before 'direct'", () => {
  const a = bodyText(strip(latestDefinition('derive_acquisition_channel').body));
  assert.ok(a.endsWith(`${LAST} return 'direct'; end;`));
});

test('0888 keeps the function immutable, keeps its grants and restates every 0741 assert', () => {
  assert.match(src888, /language plpgsql\s+immutable/i);
  assert.match(src888, /provolatile[\s\S]*<> 'i'/);
  assert.match(src888, /not has_function_privilege\('authenticated', 'public\.derive_acquisition_channel\(jsonb\)', 'execute'\)/);
  assert.doesNotMatch(strip(src888), /^\s*(insert|update|delete|grant|revoke)\s/im);
  const old = readFileSync(join(MIGRATIONS_DIR, '0741_channel_credits_file_shares.sql'), 'utf8');
  const asserts = old.split('\n').filter((l) => /^\s*assert public\.derive_acquisition_channel\(/.test(l));
  assert.ok(asserts.length > 5);
  for (const l of asserts) assert.ok(src888.includes(l), `kept: ${l.trim().slice(0, 80)}`);
  assert.match(src888, /"referrer_host":"com\.google\.android\.gm"\}'::jsonb\) = 'email'/);
  assert.match(src888, /"share_token":"x","invited":true\}'::jsonb\) = 'share_link'/);
});

test('invitation links are not tagged utm_source=email', () => {
  assert.match(src888, /Invitation links are NOT given utm_source=email/);
});
