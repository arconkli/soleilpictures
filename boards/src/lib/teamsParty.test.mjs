// The party server learns about teams (Task 8): the Workspace door and the
// upload party's foreign-prefix check ask 0530's can_open_workspace first and
// fall back to today's membership read, so the party can deploy before or
// after the migration. Source pins; the rooms' re-checks are partyAccessRecheck's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('the Workspace door asks can_open_workspace and falls back on a 404', () => {
  const auth = read('../../party/auth.ts');
  const door = auth.slice(auth.indexOf('async function authWorkspaceUncached'));
  assert.match(door, /canOpenWorkspace\(workspaceId, accessToken\)/);
  const rpc = auth.slice(auth.indexOf('async function canOpenWorkspace'));
  assert.match(rpc, /rest\/v1\/rpc\/can_open_workspace/);
  assert.match(rpc, /p_workspace_id: workspaceId/);
  assert.match(rpc, /res\.status === 404\) return "missing"/, 'a 404 (0530 not live) is told apart');
  assert.match(door, /workspace_members\?workspace_id=/, 'the membership read is still the fallback');
  assert.match(door, /open === "error"\) return \{ ok: false/, 'any other failure is closed');
});

test('the upload party\'s foreign-prefix check asks can_open_workspace and falls back to the row read', () => {
  const up = read('../../party/upload.ts');
  const at = up.indexOf('if (boardWorkspace !== workspaceId)');
  assert.ok(at > 0, 'the foreign-prefix check moved');
  const check = up.slice(at, at + 1600);
  assert.match(check, /supabaseRpc\("can_open_workspace", \{ p_workspace_id: workspaceId \}, accessToken\)/);
  assert.match(check, /opens === true/);
  assert.match(check, /workspace_members\?workspace_id=/, 'the row read is still the fallback');
});
