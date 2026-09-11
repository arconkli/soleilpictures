// boards/src/lib/roleCheck.test.mjs
//
// Phase 0 of the enterprise work closes holes the organization layer would
// inherit. Each assertion here names the hole and the migration that closes
// it, and reads the LATEST migration text so a later rewrite that reopens one
// fails loudly instead of silently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, migrationFiles, latestDefinition, latestPolicy, latestMatch, duplicatePrefixes } from './migrationText.mjs';

const fileNamed = (prefix) => migrationFiles().find(f => f.startsWith(prefix));
const textOf = (prefix) => readFileSync(join(MIGRATIONS_DIR, fileNamed(prefix)), 'utf8');

test('0317: workspaces UPDATE is column-scoped and never includes created_by', () => {
  const sql = textOf('0317');
  assert.match(sql, /revoke update on public\.workspaces from anon, authenticated;/);
  const grant = /grant update \(([^)]*)\) on public\.workspaces to authenticated;/i.exec(sql);
  assert.ok(grant, '0317 must grant an explicit column list on workspaces');
  const cols = grant[1].split(',').map(s => s.trim());
  assert.deepEqual(cols.sort(), ['name', 'settings']);
});

test('0317: boards column grant drops id, workspace_id and created_by, keeps day_types', () => {
  const sql = textOf('0317');
  const grant = /grant update \(([^)]*)\) on public\.boards to authenticated, anon;/i.exec(sql);
  assert.ok(grant, '0317 must re-issue the boards column grant to authenticated, anon');
  const cols = grant[1].split(',').map(s => s.trim());
  for (const banned of ['id', 'workspace_id', 'created_by']) assert.ok(!cols.includes(banned), `boards grant must not include ${banned}`);
  assert.ok(cols.includes('day_types'), 'boards grant must keep day_types (0247)');
  assert.ok(cols.includes('parent_board_id'), 'parent_board_id stays granted; the 0118 policy governs it');
});

test('no migration after 0316 grants id/workspace_id/created_by on boards or created_by/org_id on workspaces', () => {
  for (const f of migrationFiles().filter(f => Number(f.slice(0, 4)) >= 317)) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
    for (const m of sql.matchAll(/grant update \(([^)]*)\) on public\.(boards|workspaces)/gi)) {
      const cols = m[1].split(',').map(s => s.trim());
      const banned = m[2] === 'boards' ? ['id', 'workspace_id', 'created_by'] : ['created_by', 'org_id', 'id'];
      for (const b of banned) assert.ok(!cols.includes(b), `${f} grants ${b} on ${m[2]}`);
    }
  }
});

test('0317: public_share_links is read-only to client roles', () => {
  const sql = textOf('0317');
  assert.match(sql, /revoke insert, update, delete on public\.public_share_links from anon, authenticated;/);
  assert.match(sql, /drop policy if exists "public_links manage by owner" on public\.public_share_links;/);
  const p = latestPolicy('public_links read by owner');
  assert.ok(p && p.file.startsWith('0317'), 'select-only owner policy must be in 0317');
  assert.match(p.body, /for select/i);
});

test('0317: formalises the drifted ai_tagger_enabled column without changing it', () => {
  assert.match(textOf('0317'), /alter table public\.workspaces\s+add column if not exists ai_tagger_enabled boolean;/);
});

test('no duplicate migration prefixes from 0317 on', () => {
  const dupes = duplicatePrefixes().filter(p => Number(p) >= 317);
  assert.deepEqual(dupes, [], `duplicated prefixes: ${dupes.join(', ')}`);
});
