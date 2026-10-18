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


// 0387 now owns the latest definition (it adds in-flight uploads to the quota
// count); every property below still has to hold of whichever migration does.
test('the latest authorize_upload is a create or replace, and keeps 0318\'s property', () => {
  const def = latestDefinition('authorize_upload');
  assert.ok(def && Number(def.file.slice(0, 4)) >= 367, `authorize_upload is last defined in ${def?.file}`);
  assert.match(def.body, /^create or replace function/i, 'same signature, ACL preserved');
  assert.doesNotMatch(readFileSync(join(MIGRATIONS_DIR, def.file), 'utf8'), /drop function[^;]*authorize_upload/i);
  assert.doesNotMatch(def.body, /is_workspace_member/, 'no membership OR (0318)');
  assert.match(def.body, /can_write_workspace\(p_workspace_id\)/);
});

test('no plan refuses a file for its size — the server and the client agree (0413)', () => {
  // 0367 opened file TYPES on the free plan and kept a per-file SIZE cap, and
  // this file pinned the two halves of that cap to each other. 0413 removed the
  // cap: the owner's drive is the only byte limit on every plan. So the pin is
  // now that NEITHER half refuses a file for its size — a client that still
  // blocked would refuse what the server takes, and a server that still
  // answered owner_not_paid would refuse what the client sends.
  const body = latestDefinition('authorize_upload').body;
  assert.doesNotMatch(body, /v_free_file_cap/, 'the server has no free file cap');
  assert.doesNotMatch(body, /owner_not_paid/, 'and never answers owner_not_paid');
  assert.match(body, /v_used \+ v_bytes > v_quota/, 'the drive is what decides');
  const big = classifyDropFile({ name: 'pack.zip', type: 'application/zip', size: FREE_FILE_CAP * 100 }, { canAttemptFiles: false });
  assert.equal(big.route, 'file', 'the client sends a free owner\'s big file');
  const pdf = classifyDropFile({ name: 'deck.pdf', type: 'application/pdf', size: FREE_PDF_CAP * 10 }, { canAttemptFiles: false });
  assert.notEqual(pdf.route, 'blocked');
});
