// Closing a board revalidates its cached preview in place instead of
// blanking it (PERF-10). The hook pulls in Supabase, so the source is pinned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'hooks', 'useBoardPreview.js'), 'utf8');
const fn = src.slice(src.indexOf('export function invalidateBoardPreview'));
const body = fn.slice(0, fn.indexOf('\n}\n'));

test('invalidate keeps the stale data and never pushes null to listeners', () => {
  assert.doesNotMatch(body, /entry\.data = null/);
  assert.doesNotMatch(body, /fn\(null\)/);
  assert.match(body, /entry\.expiresAt = 0;/);
  assert.match(body, /notifyListeners\(boardId, d\)/, 'the fresh data still lands');
});
