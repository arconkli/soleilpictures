// resumeWiring.test.mjs — the day-one resume greeting is wired the way its
// header says, and the retired mix prompt stays retired.
//
//   node --test src/lib/resumeWiring.test.mjs
//
// App.jsx is not reachable from the ?local=1 harness (LocalBoardsApp mounts
// instead), so the wiring is checked at the source, sliced to the block.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MIX_PROMPT_RETIRED } from './mixPrompt.js';

const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
const canvas = readFileSync(new URL('../components/CanvasSurface.jsx', import.meta.url), 'utf8');

function block() {
  const start = app.indexOf('// ── Day one, after the first break (lib/resumeSitting.js)');
  const end = app.indexOf('// Post-signup journey:', start);
  assert.ok(start > 0 && end > start, 'resume block found');
  return app.slice(start, end);
}

test('the greeting claims the slot before it shows, and only for genuine cards', () => {
  const b = block();
  const claim = b.indexOf("claimUpsellSlot('resume')");
  const toast = b.indexOf('feedback.toast(');
  assert.ok(claim > 0 && toast > claim, 'claim first: never stacked on an offer, asks stand down for its minute');
  assert.match(b, /genuineCards\(ybCardsRef\.current/, 'seed cards never count as work to come back to');
  assert.match(b, /shouldGreetResume\(\{ awayMs, accountAgeMs: now - created/, 'day-one gate is the pure predicate');
  assert.match(b, /resumeGreetedRef\.current = true/, 'once per page');
});

test('every way back is watched, and the hide is stamped where a later page can read it', () => {
  const b = block();
  assert.match(b, /visibilityState === 'hidden'\) \{ stampHidden\(\); return; \}/);
  assert.match(b, /addEventListener\('pagehide', stampHidden\)/, 'a closed tab stamps too');
  assert.match(b, /greet\('tab'/);
  assert.match(b, /greet\('reopen'/);
  assert.match(b, /greet\('idle'/);
  assert.match(b, /resumeReopenTriedRef\.current = true/, 'the reopen check runs once, not on every board switch');
});

test('the jump never re-pushes the open board, and goes through the flash-card path', () => {
  const b = block();
  assert.match(b, /if \(currentIdRef\.current !== boardId\) openBoardRef\.current\?\.\(boardId\)/);
  assert.match(b, /new CustomEvent\('soleil-flash-card'/);
});

test('the mix prompt is retired at one flag, with the dock wiring left in place', () => {
  assert.equal(MIX_PROMPT_RETIRED, true);
  assert.match(canvas, /const mixPromptEligible = !MIX_PROMPT_RETIRED && dockAllowed\('mix'\)/);
  assert.match(canvas, /\{mixPromptVisible && selectedTool === 'select' && \(/, 'the JSX stays, so a revert is one line');
});
