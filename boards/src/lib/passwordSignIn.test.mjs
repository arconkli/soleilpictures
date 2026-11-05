import test from 'node:test';
import assert from 'node:assert/strict';
import { PASSWORD_SIGN_IN, usesPassword } from './passwordSignIn.js';
import { latestDefinition, latestMatch } from './migrationText.mjs';

test('the allowlist is the one review address', () => {
  assert.deepEqual(PASSWORD_SIGN_IN, ['review@soleilpictures.com']);
});

test('matches the address regardless of case and padding', () => {
  assert.equal(usesPassword('review@soleilpictures.com'), true);
  assert.equal(usesPassword(' Review@SoleilPictures.com '), true);
});

test('exact match only', () => {
  for (const v of ['review@soleilpictures.com.evil', 'xreview@soleilpictures.com', 'review@soleilpictures.co', '', null, undefined, 42]) {
    assert.equal(usesPassword(v), false, String(v));
  }
});

// 0869: the database lets that account's own password session count as the
// account (0600 counted every password session as nobody), and nothing else
// about passwords changes: securityHardening.test.mjs still pins that a
// password never proves an inbox.
test('the database names the same addresses as the sign-in screen', () => {
  const def = latestDefinition('_password_sign_in_allowed');
  assert.ok(def, '_password_sign_in_allowed is defined');
  const listed = [...def.body.matchAll(/'([^'\s]+@[^'\s]+)'/g)].map(m => m[1]);
  assert.deepEqual(listed, PASSWORD_SIGN_IN, 'the SQL list and lib/passwordSignIn.js must name the same addresses');
});

test('only while the account is on the internal list, and no client can ask', () => {
  const def = latestDefinition('_password_sign_in_allowed').body;
  assert.match(def, /stable security definer/);
  assert.match(def, /join public\.internal_accounts i on i\.user_id = u\.id/);
  assert.match(def, /where u\.id = p_user\s+and lower\(u\.email\) = any \(array\[/);
  assert.ok(latestMatch(/revoke execute on function public\._password_sign_in_allowed\(uuid\) from public, anon, authenticated/));
});

test('_actor_active admits that session, still subject to a ban, ahead of the unchanged inbox rule', () => {
  const def = latestDefinition('_actor_active').body;
  const demo = def.search(/when auth\.jwt\(\) -> 'amr' @> '\[\{"method": "password"\}\]'::jsonb\s+and public\._password_sign_in_allowed\(auth\.uid\(\)\)\s+then coalesce\(\(select p\.banned_at is null from public\.profiles p\s+where p\.user_id = auth\.uid\(\)\), false\)/);
  const inbox = def.indexOf("when jsonb_typeof(auth.jwt() -> 'amr') = 'array' and not public._session_proves_inbox() then false");
  assert.ok(demo > 0, 'the password branch asks the allowlist and the ban');
  assert.ok(inbox > demo, 'the inbox rule follows it word for word');
});

test('the password hook, if switched on, lets only that account through', () => {
  const def = latestDefinition('auth_refuse_password').body;
  assert.match(def, /if event ->> 'authentication_method' = 'password'\s+and not public\._password_sign_in_allowed\(\(event ->> 'user_id'\)::uuid\) then/);
  assert.ok(latestMatch(/grant execute on function public\._password_sign_in_allowed\(uuid\) to supabase_auth_admin/));
});
