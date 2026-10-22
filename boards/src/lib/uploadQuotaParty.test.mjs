// The single-PUT presign checks the storage quota with or without a boardId
// (DB-10): a doc-page paste is not a way around a full account.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const party = readFileSync(join(here, '..', '..', 'party', 'upload.ts'), 'utf8');
// From the presign's derived-key check to ITS intent (other routes record
// intents too, earlier in the file).
const presignAt = party.indexOf('const isDerivedKey = ');
const presign = party.slice(presignAt, party.indexOf('record_upload_intent', presignAt));

test('main content is quota-checked whether or not a board is named', () => {
  assert.match(presign, /if \(!isDerivedKey\) \{/);
  assert.doesNotMatch(presign, /if \(body\.boardId && !isDerivedKey\)/);
  assert.match(presign, /supabaseRpc\("authorize_upload", \{ p_workspace_id: workspaceId, p_bytes: declared \}/);
  assert.match(presign, /auth\.reason === "over_quota"/);
});

test('the quota check runs before the intent is recorded and the URL signed', () => {
  assert.ok(party.indexOf('supabaseRpc("authorize_upload", { p_workspace_id: workspaceId, p_bytes: declared }')
    < party.indexOf('"record_upload_intent", {\n        p_key: key, p_bytes: declared, p_kind: "put"'));
});
