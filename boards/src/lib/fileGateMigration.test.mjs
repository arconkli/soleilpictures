// fileGateMigration.test.mjs — the client classifier and the server upload
// gate agree on the one number that now separates free from Creator for a
// non-media file: its size.
//
//   node --test src/lib/fileGateMigration.test.mjs
//
// 0367 opened file TYPES on the free plan and kept SIZE. The client decides
// in fileIngest.js (FREE_FILE_CAP) and the server in authorize_upload()
// (v_free_file_cap); a change to one without the other would let a drop
// through the canvas that the party refuses mid-upload, or refuse one the
// server would have taken. This pins them to each other.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, latestDefinition } from './migrationText.mjs';
import { FREE_FILE_CAP, FREE_PDF_CAP, classifyDropFile } from './fileIngest.js';

const FILE = '0367_free_file_types_within_size_cap.sql';
const src = readFileSync(join(MIGRATIONS_DIR, FILE), 'utf8');

test('0367 owns the latest authorize_upload, by create or replace, and keeps 0318\'s property', () => {
  const def = latestDefinition('authorize_upload');
  assert.ok(def && def.file === FILE, `authorize_upload is last defined in ${def?.file}`);
  assert.match(def.body, /^create or replace function/i, 'same signature, ACL preserved');
  assert.doesNotMatch(src, /drop function/i);
  assert.doesNotMatch(def.body, /is_workspace_member/, 'no membership OR (0318)');
  assert.match(def.body, /can_write_workspace\(p_workspace_id\)/);
});

test('the server cap is the client cap, to the byte', () => {
  const m = src.match(/v_free_file_cap constant bigint := (\d+);/);
  assert.ok(m, 'the migration names the cap as v_free_file_cap');
  assert.equal(Number(m[1]), FREE_FILE_CAP, 'fileIngest.js FREE_FILE_CAP and 0367 v_free_file_cap differ');
  assert.equal(FREE_FILE_CAP, FREE_PDF_CAP, 'one number on the pricing page');
  assert.match(latestDefinition('authorize_upload').body, /not in \('paid', 'admin'\) and v_bytes > v_free_file_cap/,
    'a demo owner is refused only PAST the cap');
});

test('the client routes a free owner\'s non-media file as the server would answer', () => {
  const at = classifyDropFile({ name: 'pack.zip', type: 'application/zip', size: FREE_FILE_CAP }, { canAttemptFiles: false });
  const over = classifyDropFile({ name: 'pack.zip', type: 'application/zip', size: FREE_FILE_CAP + 1 }, { canAttemptFiles: false });
  assert.equal(at.route, 'file');
  assert.equal(over.route, 'blocked');
  assert.equal(over.why, 'size');
});
