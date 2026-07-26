// Source-guard for the 2026-07 production-error fixes. These paths need the
// real Yjs/collab runtime or Supabase (the ?local harness stubs them), so — as
// with the other *-wiring specs — we pin the wiring by reading the source. The
// Yjs guard's runtime behaviour is exercised live in yjs-corruption-guard.spec.js.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, new URL('../', import.meta.url)), 'utf8');

test.describe('Fix 1 — Yjs corruption self-heal', () => {
  test('perf.js guards the transact choke point, logs, and dispatches the heal event', () => {
    const s = read('src/lib/perf.js');
    expect(s).toContain("import { logClientError } from './errorReporting.js'");
    // The patched transact wraps the (both-branch) call in try/catch.
    expect(s).toMatch(/function patchedTransact[\s\S]*try\s*\{[\s\S]*_origTransact\.call/);
    expect(s).toContain('_reportYjsCorruption');
    expect(s).toContain("kind: 'yjs-transact'");
    expect(s).toContain("'soleil:yjs-corruption'");
    // The catch must NOT re-throw (that would defeat the swallow).
    expect(s).toMatch(/catch \(err\)[\s\S]*_reportYjsCorruption[\s\S]*return undefined/);
  });

  test('yboard stamps boardId, poisons on corruption, and purges local caches', () => {
    const s = read('src/lib/yboard.js');
    expect(s).toContain('ydoc._soleilBoardId = boardId');
    expect(s).toContain('poison: () =>');
    expect(s).toContain('export function purgeLocalBoardState');
    // A poisoned handle skips ALL persistence on teardown (no re-seeding).
    expect(s).toMatch(/if \(initialized && !poisoned\)/);
    expect(s).toContain('deleteSnapshot');
  });

  test('snapshotCache exposes a per-board delete', () => {
    expect(read('src/lib/snapshotCache.js')).toContain('export async function deleteSnapshot');
  });

  test('useYBoard listens for corruption, caps resyncs, poisons + purges, then remounts', () => {
    const s = read('src/hooks/useYBoard.js');
    expect(s).toContain("'soleil:yjs-corruption'");
    expect(s).toContain('CORRUPTION_MAX_RESYNCS');
    expect(s).toContain('purgeLocalBoardState');
    expect(s).toContain('poison?.()');
    expect(s).toContain("triggerReset('yjs-corruption')");
    // Exact-board guard: an unknown/null-board corruption must NOT remount every open board.
    expect(s).toMatch(/e\.detail\.boardId !== boardId/);
  });
});

test.describe('Fix 2 — TipTap editor RangeErrors', () => {
  test('find/replace decorations clamp to doc size (no out-of-range resolve)', () => {
    const s = read('src/components/DocFindReplace.jsx');
    expect(s).toContain('state.doc.content.size');
    // decorations() skips out-of-range spans instead of creating them.
    expect(s).toMatch(/const f = Math\.max\(0, Math\.min\(from, max\)\)/);
    expect(s).toMatch(/if \(t <= f\) return/);
  });

  test('list/heading commands run through the safe-dispatch guard', () => {
    expect(read('src/lib/safeEditorCmd.js')).toContain('export function safeRun');
    for (const f of ['src/components/ToolOptionsBar.jsx', 'src/components/DocToolbar.jsx', 'src/components/DocPageEditor.jsx']) {
      const s = read(f);
      expect(s).toContain("from '../lib/safeEditorCmd.js'");
      expect(s).toContain('safeRun(');
    }
  });
});

test.describe('Fix 3 — error noise filter', () => {
  test('isNoise drops extension/reader-mode signatures but keeps real fetch failures', () => {
    const s = read('src/lib/errorReporting.js');
    expect(s).toMatch(/Object Not Found Matching Id/);
    expect(s).toContain('__firefox__');
    expect(s).toContain('window\\.ethereum');
    // "Failed to fetch" must NOT be message-matched — real users' network
    // failures stay logged (dropped only by bot UA).
    expect(s).not.toMatch(/if \(\/Failed to fetch/);
  });
});
