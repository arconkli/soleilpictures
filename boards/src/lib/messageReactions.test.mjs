// COMMS-02: a reaction to someone else's message saves.
//
// messages has an author-only UPDATE policy, so the client's plain UPDATE of
// `reactions` was a silent zero-row no-op on anyone else's message. Reactions
// now go through toggle_message_reaction (0398). Pinned at the source: the
// latest definition, its grants, and the client calling it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { latestDefinition, migrationFiles, MIGRATIONS_DIR } from './migrationText.mjs';

const def = latestDefinition('toggle_message_reaction');
const file = def && readFileSync(MIGRATIONS_DIR + def.file, 'utf8');

test('toggle_message_reaction lets in exactly who may post in the conversation', () => {
  assert.ok(def, 'toggle_message_reaction is defined');
  assert.match(def.body, /security definer/i);
  assert.match(def.body, /set search_path = public/i);
  assert.match(def.body, /public\.is_active_conversation_participant\(v_conv\)/);
  assert.match(def.body, /public\.can_write_workspace\(v_ws\)/);
  assert.match(def.body, /auth\.uid\(\)/);
});

test('it locks the row and touches only the caller\'s own entry', () => {
  assert.match(def.body, /for update/i, 'concurrent reactions do not overwrite each other');
  assert.match(def.body, /v_list \? v_uid::text/);
  assert.match(def.body, /v_list - v_uid::text/);
  assert.match(def.body, /update public\.messages set reactions = v_reactions where id = p_message_id/);
  assert.doesNotMatch(def.body, /set\s+body|set\s+attachments/i);
  assert.match(def.body, /deleted_at is null/, 'no reacting to a deleted message');
});

test('its grants are proven: no anon, yes authenticated', () => {
  assert.match(file, /revoke execute on function public\.toggle_message_reaction\(uuid, text\) from public, anon;/);
  assert.match(file, /grant execute on function public\.toggle_message_reaction\(uuid, text\) to authenticated;/);
  assert.match(file, /has_function_privilege\('anon', 'public\.toggle_message_reaction\(uuid, text\)', 'execute'\)/);
  assert.match(file, /not has_function_privilege\('authenticated', 'public\.toggle_message_reaction\(uuid, text\)', 'execute'\)/);
  assert.ok(migrationFiles().includes(def.file));
});

test('the client reacts through the RPC and checks the error', () => {
  const src = readFileSync(new URL('./messages.js', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('export async function toggleReaction'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /supabase\.rpc\('toggle_message_reaction'/);
  assert.match(body, /if \(error\)/);
  assert.doesNotMatch(body, /\.update\(/, 'no direct UPDATE: RLS makes it a silent no-op');
  // Until 0398 is applied, a missing RPC falls back to the author-only path,
  // and only then; the fallback reads back the row it wrote, so a zero-row
  // UPDATE on someone else's message throws instead of passing silently.
  assert.match(body, /if \(error && isMissingFunction\(error\)\) return toggleOwnReactionLegacy\(/);
  assert.match(src, /error\?\.code === 'PGRST202' \|\| error\?\.code === '42883'/);
  const legacy = src.slice(src.indexOf('async function toggleOwnReactionLegacy'));
  const lbody = legacy.slice(0, legacy.indexOf('\n}\n'));
  assert.match(lbody, /\.update\(\{ reactions \}\)\.eq\('id', messageId\)\.select\('id'\)/);
  assert.match(lbody, /if \(!rows \|\| rows\.length === 0\) throw/);
  const thread = readFileSync(new URL('../components/MessageThread.jsx', import.meta.url), 'utf8');
  const react = thread.slice(thread.indexOf('const handleReact'), thread.indexOf('const handleReply'));
  assert.match(react, /catch[\s\S]*feedback\.toast\(\{ type: 'error'/, 'a failed reaction says so');
});
