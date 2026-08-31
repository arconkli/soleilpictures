// Source-guard for the workspace-root brick.
//
// A workspace with no live root cluster made getRootBoard() return null — not
// throw — and App.jsx renders <LoadingShell/> until a root exists. So the app
// sat on a bare spinner with no error and no button, and because the selected
// workspace id is persisted in localStorage (readSession uses localStorage
// despite the SESSION_PREFIX name), every reload replayed it. There is no
// /b/<id> route to edit and the workspace switcher lives inside <Workspace>,
// which never mounts while stuck — so the account was unrecoverable in that
// browser. Twelve workspaces across twelve users were in that state; eight of
// those users had no working workspace at all.
//
// Migration 0275 fixes the data side. These assertions pin the client side,
// none of which is reachable from the backend-free harness.

import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, new URL('../', import.meta.url)), 'utf8');
const app = () => read('src/App.jsx');
const api = () => read('src/lib/boardsApi.js');
const useWorkspace = () => read('src/hooks/useWorkspace.js');
const useBoardList = () => read('src/hooks/useBoardList.js');
const sidebar = () => read('src/components/SidebarBoardTree.jsx');
const boundary = () => read('src/components/AppErrorBoundary.jsx');

test.describe('a workspace that cannot be opened must not become a dead account', () => {
  test('the repair RPC is wired, and not through a swallowed .catch', () => {
    const s = api();
    expect(s).toContain("rpc('ensure_workspace_root'");
    expect(s).toMatch(/export async function ensureWorkspaceRoot/);
    // House rule: a supabase builder is a thenable, and .catch() on it
    // swallows the query rather than handling a rejection.
    expect(s).not.toMatch(/rpc\('ensure_workspace_root'[\s\S]{0,200}?\.catch\(/);
  });

  test('App repairs a rootless workspace, then errors — it never falls through to the spinner', () => {
    const s = app();
    expect(s).toContain('ensureWorkspaceRoot');
    // The null branch must attempt a repair rather than storing null.
    expect(s).toMatch(/if \(!r\) \{\s*\n\s*await ensureWorkspaceRoot/);
    // The catch must set state. Logging alone is what made this permanent:
    // the effect deps never change, so it never retried either.
    expect(s).toMatch(/catch \(e\) \{[\s\S]{0,240}setActiveRootError\(e\)/);
    expect(s).toMatch(/if \(activeRootError\)/);
    // And the error screen must offer the escape, not just "Sign out".
    expect(s).toContain('recoverToPersonalWorkspace');
    expect(s).toMatch(/localStorage\.removeItem\(workspaceSessionKey\)/);
  });

  test('the LoadingShell gate is still guarded by an error branch ABOVE it', () => {
    const s = app();
    const errIdx = s.indexOf('if (activeRootError)');
    const shellIdx = s.indexOf('return <LoadingShell />');
    expect(errIdx).toBeGreaterThan(-1);
    expect(shellIdx).toBeGreaterThan(-1);
    // If the spinner is reached first, the recovery screen is dead code.
    expect(errIdx).toBeLessThan(shellIdx);
  });

  test('the personal-workspace bootstrap treats a null root as an error too', () => {
    const s = useWorkspace();
    expect(s).toContain('ensureWorkspaceRoot');
    // Storing { rootBoard: null, error: null } fed the same infinite shell.
    expect(s).toMatch(/if \(!root\) throw new Error/);
  });

  test('useBoardList always clears loading, the way useSharedBoards does', () => {
    const s = useBoardList();
    // An unhandled rejection left loading true forever, which early-returned
    // every stale-id cleanup in App.jsx and froze the board map.
    expect(s).toMatch(/} finally \{\s*\n\s*setLoading\(false\);/);
    expect(s).toMatch(/catch \(e\) \{[\s\S]{0,120}console\.error/);
  });

  test('the last root cluster cannot be deleted from the sidebar', () => {
    const s = sidebar();
    expect(s).toContain('isLastRootCluster');
    // Must be disabled AND inert — a disabled flag alone still runs on click
    // in menus that do not honour it.
    expect(s).toMatch(/disabled: isLastRootCluster/);
    expect(s).toMatch(/run: \(\) => \{ if \(!isLastRootCluster\) onDeleteBoard/);
  });

  test('the error boundary can clear the state that survives a reload', () => {
    const s = boundary();
    expect(s).toContain('resetLocalState');
    expect(s).toMatch(/startsWith\('soleil\.boards\.session\.'\)/);
    // Reload alone cannot help when the poison is what we restore FROM.
    expect(s).toContain('Reset view state');
  });
});
