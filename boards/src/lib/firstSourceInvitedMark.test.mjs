// firstSourceInvitedMark.test.mjs — 0889: an invited account's first_source
// says so, which is what 0888's 'invite' channel reads.
//
//   node --test src/lib/firstSourceInvitedMark.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, latestDefinition } from './migrationText.mjs';

const F889 = '0889_first_source_marks_invited.sql';
const src889 = readFileSync(join(MIGRATIONS_DIR, F889), 'utf8');
const code889 = src889.replace(/--.*$/gm, '');

test('0889 marks from a collab referral, in both orders, and never fills an empty first_source', () => {
  assert.match(code889, /create trigger referrals_marks_invited\s+after insert on public\.referrals\s+for each row\s+when \(new\.source = 'collab'\)/);
  assert.match(code889, /create trigger profiles_keeps_invited\s+before insert or update of first_source on public\.profiles/);
  const guards = code889.match(/first_source <> '\{\}'::jsonb/g) || [];
  assert.ok(guards.length >= 4, 'every write and the proof skip an empty first_source');
  assert.equal((code889.match(/\|\| '\{"invited": true\}'::jsonb/g) || []).length, 3);
  assert.equal((code889.match(/exception when others then\s+null;/g) || []).length, 2, 'both triggers swallow their own errors');
  assert.match(code889, /r\.source = 'collab'/);
});

test('0889 closes its trigger functions to clients and proves it', () => {
  for (const fn of ['_tg_referral_marks_invited', '_tg_profile_keeps_invited']) {
    const def = latestDefinition(fn);
    assert.equal(def.file, F889);
    assert.ok(code889.includes(`revoke execute on function public.${fn}() from public, anon, authenticated;`));
    assert.ok(code889.includes(`'public.${fn}()'`), `${fn} is in the proof`);
  }
  assert.match(code889, /security definer\s+set search_path = public/);
  assert.match(code889, /if has_function_privilege\(r, f, 'execute'\) then/);
});
