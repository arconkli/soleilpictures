// 0895: _email_locale, the one place that says which language an email is
// written in. Text only, no Postgres: it pins the shape of the latest
// definition and that send-transactional-email asks for it by that name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { latestDefinition, MIGRATIONS_DIR } from './migrationText.mjs';

const FILE = '0895_email_locale.sql';
const fileText = () => readFileSync(join(MIGRATIONS_DIR, FILE), 'utf8');
const code = (s) => s.replace(/--[^\n]*/g, '');   // comments are not wiring
const def = () => {
  const d = latestDefinition('_email_locale');
  assert.ok(d, 'no definition of _email_locale');
  return d;
};

test('the latest _email_locale lives in 0895, security definer with an empty search_path', () => {
  const d = def();
  assert.equal(d.file, FILE);
  const head = code(d.body).slice(0, code(d.body).indexOf('$$'));
  assert.match(head, /_email_locale\(p_email text, p_actor uuid default null\)/);
  assert.match(head, /returns text/);
  assert.match(head, /\bstable\b/);
  assert.match(head, /security definer/);
  assert.match(head, /set search_path = ''/);
});

test('the account that owns the address answers first, the sender only when there is none', () => {
  const b = code(def().body);
  const account = b.indexOf('lower(u.email) = lower(p_email)');
  const found = b.indexOf('if found then');
  const actor = b.indexOf('u.id = p_actor');
  assert.ok(account > -1 && found > -1 && actor > -1);
  assert.ok(account < found && found < actor, 'account lookup, then its answer, then the actor');
  // An account with no saved language answers null: the actor's language is not theirs.
  assert.match(b, /if found then\s+return v_locale;\s+end if;/);
  assert.match(b, /if p_actor is null then\s+return null;/);
});

test('service role only, and the file proves it', () => {
  const t = code(fileText());
  assert.match(t, /revoke execute on function public\._email_locale\(text, uuid\) from public, anon, authenticated;/);
  assert.match(t, /grant execute on function public\._email_locale\(text, uuid\) to service_role;/);
  const proof = t.slice(t.indexOf('do $$'));
  assert.match(proof, /has_function_privilege\('anon', 'public\._email_locale\(text,uuid\)', 'execute'\)/);
  assert.match(proof, /has_function_privilege\('authenticated', 'public\._email_locale\(text,uuid\)', 'execute'\)/);
  assert.match(proof, /not has_function_privilege\('service_role', 'public\._email_locale\(text,uuid\)', 'execute'\)/);
  assert.ok(t.indexOf('revoke execute') < t.indexOf('do $$'), 'the proof comes after the grants');
});

test('send-transactional-email asks _email_locale, never fails the send over it, and keeps English-only English', () => {
  const src = readFileSync(
    new URL('../../../supabase/functions/send-transactional-email/index.ts', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('async function readerLocale'), src.indexOf('// Coarse bucket'));
  assert.match(fn, /\.rpc\("_email_locale", \{ p_email: to, p_actor: actorId \?\? null \}\)/);
  assert.match(fn, /\.abortSignal\(AbortSignal\.timeout\(3000\)\)/);
  assert.match(fn, /try \{[\s\S]*await logDb[\s\S]*\} catch \{\s+return "en";/);
  assert.ok(!/\.catch\(/.test(fn), 'never .catch() an rpc builder');
  assert.match(src, /const locale = ENGLISH_ONLY\.has\(body\.template\) \? "en" : await readerLocale\(to, actorId\);/);
  assert.match(src, /renderTemplate\(body\.template as TemplateName, body\.data \|\| \{\}, locale\)/);
});
