// 0542: "Talk to us" (Team S5), pinned at the source. The form is open to
// anyone, signed out included, so its limits are what keep it from flooding
// the owner's inbox: they are pinned here as well as proven in the local
// Postgres check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { latestDefinition, MIGRATIONS_DIR } from './migrationText.mjs';

const F = '0542_team_contact.sql';
const sql = readFileSync(join(MIGRATIONS_DIR, F), 'utf8');
const code = (s) => s.replace(/--[^\n]*/g, '');   // comments are not wiring
const body = (fn) => {
  const d = latestDefinition(fn);
  assert.ok(d, `no definition of ${fn}`);
  return code(d.body);
};

test('0542 is one transaction that proves its own grants, with no DROP', () => {
  assert.match(sql, /STATUS: written 2026-10-27\./);
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /set local lock_timeout = '3s';/);
  assert.match(sql, /commit;\s*$/);
  assert.match(sql, /has_function_privilege\('anon', 'public\.request_team_contact/);
  assert.match(sql, /has_table_privilege\('anon', 'public\.team_contact_requests', 'select'\)/);
  assert.match(sql, /an overload exists \(PGRST203\)/);
  assert.doesNotMatch(code(sql), /\bdrop\s+(function|table|policy)\b/i);
});

test('anyone may send a request; only admins read or mark them; nobody reads the table', () => {
  assert.match(sql, /grant execute on function public\.request_team_contact\(text, text, text, integer, text\[\], text\) to anon, authenticated;/);
  assert.match(sql, /revoke execute on function public\.admin_team_contacts\(integer\) from public, anon;/);
  assert.match(sql, /revoke execute on function public\.admin_set_team_contact\(uuid, text\) from public, anon;/);
  assert.match(sql, /revoke all on public\.team_contact_requests from public, anon, authenticated;/);
  assert.match(sql, /alter table public\.team_contact_requests enable row level security;/);
  for (const fn of ['admin_team_contacts', 'admin_set_team_contact']) {
    assert.match(body(fn), /perform public\._require_admin\(\);/, fn);
  }
});

test('the limits: one a day per address, 20 an hour in all, 10 emails a day', () => {
  const b = body('request_team_contact');
  assert.match(b, /r\.email = v_email and r\.created_at > now\(\) - interval '24 hours'\) then\s+return 'already';/);
  assert.match(b, /interval '1 hour'\) >= 20 then\s+raise exception [^;]*hint = 'team_contact_busy';/);
  assert.match(b, /a\.kind = 'team_contact' and a\.page\s+and a\.created_at > now\(\) - interval '24 hours'\) < 10;/);
  assert.match(b, /pg_advisory_xact_lock\(hashtext\('team_contact:' \|\| v_email\)\)/);
  assert.match(b, /hint = 'team_contact_invalid'/);
  // The email goes through the alert pager the breaking problems use (0369).
  assert.match(b, /public\.ops_alert_raise\('team_contact',/);
});
