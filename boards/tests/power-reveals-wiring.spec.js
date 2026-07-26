// Source-guard for the just-in-time power-reveal wiring in App.jsx — the
// Supabase Workspace path isn't reachable from the backend-free harness, so
// (per the collab-nudge-wiring.spec.js convention) we pin the integration
// contract by reading the source. The pure engine has its own node tests
// (src/lib/powerReveals.test.mjs).
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, new URL('../', import.meta.url)), 'utf8');
const app = () => read('src/App.jsx');
const ev = () => read('src/lib/analyticsEvents.js');

// The reveal effect body, sliced between its two unique landmarks so the
// assertions below can't accidentally anchor on unrelated code further down.
const revealBlock = () => {
  const s = app();
  const start = s.indexOf('if (sessionRevealShown()) return;');
  const end = s.indexOf('EV.POWER_REVEAL_SHOWN');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return s.slice(start, end);
};

test.describe('power reveal wiring', () => {
  test('App imports the engine and evaluates it', () => {
    const s = app();
    expect(s).toMatch(/from '.\/lib\/powerReveals\.js'/);
    expect(s).toMatch(/pickReveal\(/);
  });

  test('the reveal effect is fully gated: session, signed-in, desktop, editable, no tour, no coachmark', () => {
    const block = revealBlock();
    for (const gate of ['user?.id', 'mobileShell', 'canEditCurrent', 'tourActive', 'showCoachmark']) {
      expect(block).toContain(gate);
    }
  });

  test('reveals only run in the user\'s OWN workspace — never on boards they merely edit', () => {
    expect(revealBlock()).toContain("currentBoardPerm.source !== 'workspace'");
  });

  test('reveals wait out the cold-RPC window and never run mid-onboarding', () => {
    const block = revealBlock();
    expect(block).toContain('myTier.loading');
    expect(block).toMatch(/seeded === true && .*done !== true/);
  });

  test('reveals never evaluate another board\'s snapshot (navigation-commit stale cards)', () => {
    expect(revealBlock()).toMatch(/!yb\.ready \|\| yb\.boardId !== currentId/);
  });

  test('seen + session guards are marked BEFORE the toast, with a write-verify bail', () => {
    const block = revealBlock();
    const marks = block.indexOf('markRevealSeen(picked.key)');
    expect(marks).toBeGreaterThan(-1);
    expect(block.indexOf('markSessionRevealShown()')).toBeGreaterThan(marks);
    // quota-exhausted localStorage (write fails, reads work) must mean "never
    // toast" — not "toast every session forever"
    expect(block).toContain('if (!revealSeen(picked.key)) return;');
    const toast = block.indexOf('feedback.toast');
    expect(toast).toBeGreaterThan(block.indexOf('if (!revealSeen(picked.key)) return;'));
  });

  test('toast actions no-op after unmount OR board change (no orphaned rows in destroyed docs)', () => {
    const block = revealBlock();
    expect(block).toContain('aliveRef.current');
    expect(block).toContain('currentIdRef.current !== firedBoardId');
    const s = app();
    expect(s).toMatch(/aliveRef\.current = false/);
  });

  test('create actions land beside the user\'s content, never at the off-camera (60,60) fallback', () => {
    const block = revealBlock();
    expect(block).toContain('nearContent()');
    expect(block).not.toMatch(/addGrid\?\.\(null/);
    expect(block).not.toMatch(/addDocCard\?\.\(\)/);
  });

  test('per-kind counts feed the engine from genuineCards (seeds/showcase excluded)', () => {
    const block = revealBlock();
    for (const id of ['imageCards', 'noteCards', 'gridCards', 'docCards', 'nonBoardCards', 'clusterCards']) {
      expect(block).toContain(id);
    }
  });

  test('the reveal-driven view switch is via power_reveal — reveal is the list-surface action, not ours', () => {
    const s = app();
    expect(s).toContain("setView('list', 'power_reveal')");
    expect(s).toContain("setView('canvas', 'reveal')");
  });

  test('feature usage self-retires its pitch: view switches and palette opens stamp the flags', () => {
    const s = app();
    expect(s).toMatch(/markViewSwitched\(\)/);
    expect(s).toMatch(/if \(paletteOpen\) markRevealSeen\('palette'\)/);
  });

  test('the analytics registry names both reveal events', () => {
    const e = ev();
    expect(e).toMatch(/POWER_REVEAL_SHOWN:\s*'power_reveal_shown'/);
    expect(e).toMatch(/POWER_REVEAL_ENGAGED:\s*'power_reveal_engaged'/);
  });

  test('the tour-completion beat owns its session and the desktop momentum rows are distinguishable', () => {
    const s = app();
    expect((s.match(/markSessionRevealShown\(\)/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(s).toMatch(/revealSeen\('momentum'\)/);
    expect(s).toMatch(/markRevealSeen\('momentum'\)/);
    expect(s).toContain('boards get good at 3+');
    // the phone emitters' payloads have no source key — the desktop port must
    expect(s).toContain("source: 'project_first_completion'");
  });

  test('public repo: the comments carry no internal retention findings', () => {
    for (const src of [app(), read('src/lib/powerReveals.js')]) {
      expect(src).not.toMatch(/retained worse|completers retained/i);
    }
  });
});
