// How the boot prefetch is wired in, read from the source: where AuthGate
// starts it, what it may import, and which callers may take its reads.
// Run: node --test src/lib/bootWiring.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(resolve(SRC, rel), 'utf8');

test('AuthGate starts it after the claims and the returns, just before each setSession', () => {
  const s = read('auth/AuthGate.jsx');
  for (const [setLine, start] of [
    ['if (!cancelled) setSession(data.session);', 'startBootPrefetch(data.session.user.id)'],
    ['if (!cancelled) setSession(sess);', 'startBootPrefetch(sess.user.id)'],
  ]) {
    const set = s.indexOf(setLine);
    const at = s.indexOf(start);
    assert.ok(set > 0 && at > 0, setLine);
    assert.ok(at < set, `${start} before ${setLine}`);
    // The claims rewrite the keys that say which workspace and cluster open.
    const block = s.slice(s.lastIndexOf('consumeDeepLink(', at), at);
    for (const step of ['consumePendingInvite(', 'consumePendingJoin(', 'consumePendingWsJoin(', 'consumeScoutClaim(',
      'if (consumeShareReturn()) return;', 'if (consumeFileReturn()) return;']) {
      assert.ok(block.includes(step), `${step} runs before ${start}`);
    }
  }
  assert.match(s, /if \(event === 'SIGNED_OUT'\) clearBootPrefetch\(\);/);
});

test('it stays light enough for the entry chunk', () => {
  const imports = (rel) => [...read(rel).matchAll(/^import[^;]*?from '([^']+)';/gm)].map((m) => m[1]).sort();
  assert.deepEqual(imports('lib/bootPrefetch.js'),
    ['./bootPlan.js', './bootQueries.js', './bootStore.js', './prefetch.js', './supabase.js']);
  assert.deepEqual(imports('lib/bootPlan.js'), ['./bootQueries.js', './startWorkspace.js']);
  assert.deepEqual(imports('lib/bootQueries.js'), []);
  assert.deepEqual(imports('lib/bootStore.js'), []);
  assert.deepEqual(imports('lib/startWorkspace.js'), []);
  assert.deepEqual(imports('lib/prefetch.js'), []);
});

test('no builder is ever .catch()ed: it is a thenable, and the catch swallows the query', () => {
  for (const rel of ['lib/bootPrefetch.js', 'lib/bootQueries.js', 'lib/bootStore.js', 'lib/bootPlan.js']) {
    const code = read(rel).replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/\.catch\(/.test(code), rel);
  }
});

test('the personal-workspace RPC starts at sign-in only for an account this device knows', () => {
  const s = read('lib/bootPrefetch.js');
  assert.match(s, /if \(plan\.rpc\) start\('personal'/);
  assert.match(read('lib/bootPlan.js'), /rpc: !!open,/);
});

test('only first calls take a prefetched read', () => {
  const tier = read('hooks/useMyTier.js');
  assert.match(tier, /const first = _store\.data === EMPTY;\s*const boot = first \? takeBoot\('tier', forUser\) : null;/);
  const all = read('hooks/useAllWorkspaces.js');
  assert.match(all, /const refresh = useCallback\(\(\) => load\(false\), \[load\]\);/);
  assert.match(all, /useEffect\(\(\) => \{ load\(true\); \}, \[load\]\);/);
  for (const rel of ['hooks/useBoardList.js', 'hooks/useSharedBoards.js']) {
    assert.match(read(rel), /bootRef\.current = false;/, `${rel} takes on its first refresh only`);
  }
  const ws = read('hooks/useWorkspace.js');
  // The repair path reads the root it just repaired, never a prefetched one.
  assert.match(ws, /await ensureWorkspaceRoot\(ws\.id\);\s*root = await getRootBoard\(ws\.id\);/);
});

test('boardsApi builds its boot reads where bootPrefetch does', () => {
  const s = read('lib/boardsApi.js');
  for (const call of ['personalWorkspaceQuery(supabase, userId, name)', 'boardListQuery(supabase, workspaceId)',
    'rootBoardQuery(supabase, workspaceId)', 'boardStateQuery(supabase, boardId)', 'sharedBoardsQuery(supabase)']) {
    assert.ok(s.includes(call), call);
  }
});
