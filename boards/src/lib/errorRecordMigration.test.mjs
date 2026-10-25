// errorRecordMigration.test.mjs — 0580 put every failure on record; these pin
// what a later migration could quietly undo.
//
//   node --test src/lib/errorRecordMigration.test.mjs
//
// client_errors is written by signed-out browsers through PostgREST, so its
// insert policy and its before-insert triggers are the whole defence: what the
// policy lets through is what lands, and the triggers are the only place a row
// is cleaned before it is stored. The production client shares the database,
// so nothing 0580 added may require a column an old client doesn't send.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, latestDefinition, latestMatch, latestPolicy } from './migrationText.mjs';

const FILE = '0580_every_failure_on_record.sql';
const src = readFileSync(join(MIGRATIONS_DIR, FILE), 'utf8');

// latestPolicy() reads CREATE POLICY only; 0580 restates this one with ALTER.
function insertPolicy() {
  const created = latestPolicy('anyone insert client_errors');
  const altered = latestMatch(/alter\s+policy\s+"anyone insert client_errors"[\s\S]*?;/i);
  return altered && altered.file > created.file ? altered.match[0] : created.body;
}

test('a signed-out caller writes client rows only', () => {
  const policy = insertPolicy();
  assert.match(policy, /source\s*=\s*'client'/, 'a row claiming a server is refused');
  for (const kind of ['discovery_pipeline', 'aeo_probe', 'seo_health', 'csp_violation']) {
    assert.ok(policy.includes(`'${kind}'`), `a client cannot forge a ${kind} row`);
  }
  assert.doesNotMatch(policy, /with check\s*\(\s*true\s*\)/i);
});

test('the shape trigger runs after the link-token redaction', () => {
  // Before-insert triggers fire in name order. Fingerprinting a message that
  // still holds a share token would key a group by the token.
  const shape = latestMatch(/create or replace trigger (client_errors_\w+)\s+before insert on public\.client_errors/i);
  assert.equal(shape?.match[1], 'client_errors_shape');
  assert.ok(latestMatch(/create (?:or replace )?trigger client_errors_redact_links\s+before insert/i),
    'the redaction trigger exists');
  assert.ok(['client_errors_clamp_time', 'client_errors_redact_links', 'client_errors_shape']
    .every((n, i, a) => i === 0 || a[i - 1] < n), 'the names sort clamp, redact, shape');
  assert.match(src, /'client_errors_clamp_time,client_errors_redact_links,client_errors_shape'/,
    'the proof asserts the live order');
});

test('the trigger cleans what it keeps and caps floods', () => {
  const def = latestDefinition('_tg_client_errors_shape');
  assert.ok(def, '_tg_client_errors_shape is defined');
  // _redact_link_text is the service role's alone, so the shaping runs as owner.
  assert.match(def.body, /security definer/i);
  for (const col of ['kind', 'name', 'message', 'stack', 'component_stack', 'path', 'release', 'user_agent']) {
    assert.match(def.body, new RegExp(`new\\.${col}\\s*:=\\s*left\\(new\\.${col},`), `${col} is clamped`);
  }
  assert.match(def.body, /new\.context\s*:=\s*public\._client_error_context\(new\.context\)/);
  assert.match(def.body, /new\.breadcrumbs\s*:=\s*public\._client_error_crumbs\(new\.breadcrumbs\)/);
  assert.match(def.body, /new\.fingerprint\s*:=/);
  assert.match(def.body, /v_recent >= 300/, 'a session is capped at 300 rows an hour');
  assert.match(def.body, /v_recent >= 60/, 'a sessionless fingerprint is capped at 60 a minute');
});

test('an old client keeps working: every new column is nullable or defaulted', () => {
  const adds = [...src.matchAll(/add column if not exists\s+(\w+)\s+([^,;\n]+)/gi)];
  assert.ok(adds.length >= 8, 'the new columns are found');
  for (const [, name, rest] of adds) {
    assert.ok(!/not null/i.test(rest) || /default/i.test(rest), `${name} would refuse an old client's row`);
  }
  // A volatile default on ADD COLUMN rewrites the table under live inserts.
  assert.doesNotMatch(src, /add column if not exists\s+received_at[^,;\n]*default/i);
  assert.match(src, /alter column received_at set default now\(\)/);
});

test('the mute key stays as it was, and a fingerprint ignores the build', () => {
  // The stored mutes are keyed by _error_message_key; changing it unmutes them.
  assert.doesNotMatch(src, /function public\._error_message_key\b/);
  const frame = latestDefinition('_error_frame_key');
  assert.match(frame.body, /-\[A-Za-z0-9_-\]\{8\}\\\.js/, 'the content hash is not part of the frame key');
});

test('erasure reaches the new identifier', () => {
  const def = latestDefinition('anonymize_user_client_errors');
  assert.match(def.body, /app_session_id = null/);
});

test('every function 0580 creates is in its grants proof', () => {
  assert.doesNotMatch(src, /drop\s+(function|policy|trigger)/i, 'a DROP discards the ACL');
  const proof = src.slice(src.indexOf('do $proof$'));
  const created = [...src.matchAll(/create or replace function (public\.\w+)\(/g)].map((m) => m[1]);
  assert.ok(created.length >= 10);
  for (const fn of created) {
    assert.ok(proof.includes(`'${fn}(`), `${fn} is checked with has_function_privilege`);
  }
  assert.match(proof, /has_function_privilege\('anon', v_fn, 'execute'\)/);
  assert.match(proof, /has_function_privilege\('authenticated', v_fn, 'execute'\)/);
});
