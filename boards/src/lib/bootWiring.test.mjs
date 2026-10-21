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
  // AuthGate asks the setup's rule before the personal workspace's head start,
  // from its own module: a module goes whole into one chunk, and setupGate.js
  // or workspaceSetup.js would bring the whole setup into the entry.
  assert.ok(!/from '\.\.\/lib\/(setupGate|workspaceSetup)\.js'/.test(read('auth/AuthGate.jsx')));
  assert.deepEqual(imports('lib/setupRule.js'), ['./experiments.js']);
  assert.deepEqual(imports('lib/experiments.js'), []);
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
  assert.match(read('lib/bootPlan.js'), /rpc: !!personalWs,/);
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

test('a reload inside a cluster never opens the root in its place while the lists load', () => {
  const s = read('App.jsx');
  assert.match(s, /const landingPending = boardListsLoading && currentId !== rootBoard\.id && !boards\[currentId\];/);
  assert.match(s, /const yb = useYBoard\(landingPending \? null : currentBoard\.id,/);
});

test("a new account's workspace starts at sign-in, never where the setup may open first", () => {
  const gate = read('auth/AuthGate.jsx');
  // Beside each startBootPrefetch, so after the same claims and returns, and
  // on the phone long before AppShell (TierRouter) has arrived to ask.
  assert.match(gate, /startBootPrefetch\(data\.session\.user\.id\);\s*startPersonalPrefetch\(data\.session\.user\);/);
  assert.match(gate, /startBootPrefetch\(sess\.user\.id\);\s*startPersonalPrefetch\(sess\.user\);/);
  const call = 'bootPrefetchPersonal(user);';
  const fn = gate.slice(gate.indexOf('function startPersonalPrefetch('), gate.indexOf(call) + call.length);
  assert.ok(fn.length > 1, 'AuthGate starts bootPrefetchPersonal behind its guard');
  // Only where the app is about to open: its page, and the checkout success
  // page that opens it in place.
  assert.match(gate, /const OPENS_APP = new Set\(\['\/', '\/pricing\/success'\]\);/);
  assert.match(fn, /if \(!OPENS_APP\.has\(window\.location\.pathname\)\) return;/);
  // Held back while the setup may still open: an account new enough for it
  // (the gate's own rule, before the tier says whether it was ever set up) in
  // the setup's arm B, or the arm ?setup= picks where the gate takes it.
  assert.match(fn, /allowed: import\.meta\.env\.DEV \|\| onPreviewHost\(\),/);
  assert.match(fn, /if \(setupMayOpenFirst\(\{ user, allowed: workspaceSetupAllowed\(\), override \}\)\) return;\s*bootPrefetchPersonal\(user\);/);
  assert.match(read('lib/setupRule.js'), /if \(!user\?\.id \|\| !isSetupCandidate\(\{ allowed, createdAt: user\.created_at \}\)\) return false;\s*return \(override \|\| assignArm\('workspace_setup', user\.id\)\) === 'B';/);
  assert.match(read('hooks/useSetupGate.js'), /isSetupCandidate\(\{\s*allowed: workspaceSetupAllowed\(\), createdAt: user\?\.created_at, onboarding,/);
  // The same arm the setup gate opens on: change one and this test makes you
  // look at the other.
  assert.match(read('hooks/useSetupGate.js'), /const arm = candidate \? \(override \|\| assignArm\('workspace_setup', uid\)\) : null;/);
  assert.match(read('hooks/useSetupGate.js'), /readSetupOverride\(\{[\s\S]{0,160}allowed: import\.meta\.env\.DEV \|\| onPreviewHost\(\),/);
  const s = read('lib/bootPrefetch.js');
  const body = s.slice(s.indexOf('export function bootPrefetchPersonal('), s.indexOf('// useWorkspace\'s note of which workspace'));
  // Once per account per page (the listener hears the hourly token refresh
  // too), and never a second RPC beside the sign-in one.
  assert.match(body, /startedFor !== uid \|\| personalFor === uid\) return;\s*personalFor = uid;\s*if \(hasBoot\('personal', uid\)\) return;/);
  assert.match(s, /export function clearBootPrefetch\(\) \{\s*startedFor = null;\s*personalFor = null;/);
  assert.match(body, /bootPrefetchPersonalList\(user, ws\.id\);/);
  assert.match(body, /bootPrefetchLanding\(user, ws\.id, root\.id, \{ personal: true \}\)/);
  // Nothing in TierRouter starts it any more: AppShell arrives too late.
  assert.ok(!read('auth/TierRouter.jsx').includes('bootPrefetchPersonal'));
});

test("the setup's last step starts what the app opens with, for someone landing in the workspace it named", () => {
  const setup = read('components/setup/WorkspaceSetup.jsx');
  assert.match(setup, /import \{ bootPrefetchSetupDone \} from '\.\.\/\.\.\/lib\/bootPrefetch\.js';/);
  // As the invite step shows, and again at "Open", beside the save; never for
  // someone joining another workspace, who lands there.
  assert.match(setup, /if \(step === 'invite' && !invitee && ws\?\.id\) bootPrefetchSetupDone\(user, ws\.id\);/);
  assert.match(setup, /if \(!invitee && ws\?\.id\) bootPrefetchSetupDone\(user, ws\.id\);\s*await Promise\.race\(\[persist\(next\), wait\(1500\)\]\);/);
  const s = read('lib/bootPrefetch.js');
  const fn = s.slice(s.indexOf('export function bootPrefetchSetupDone('), s.indexOf("// useWorkspace's note of which workspace"));
  assert.ok(fn.length > 1);
  // Only what is not live already, so the call at "Open" starts only what the
  // step outlasted.
  assert.match(fn, /const fresh = \(key, build\) => \{ if \(!hasBoot\(key, uid\)\) start\(key, uid, build\); \};/);
  assert.ok(fn.includes("fresh('personal', () => personalWorkspaceQuery(supabase, uid));"));
  assert.ok(fn.includes("fresh('members', () => membershipsQuery(supabase, uid));"));
  assert.ok(fn.includes('fresh(`list:${workspaceId}`, () => boardListQuery(supabase, workspaceId));'));
  assert.match(fn, /bootPrefetchLanding\(user, workspaceId, root\.id\)/);
  // Under the keys the app's first reads take.
  assert.ok(read('hooks/useAllWorkspaces.js').includes("takeBootResponse('members', user.id)"));
  assert.ok(read('hooks/useBoardList.js').includes('takeBootResponse(`list:${workspaceId}`, userId)'));
  assert.ok(read('hooks/useWorkspace.js').includes('await takeBootPersonal(user.id)'));
});
