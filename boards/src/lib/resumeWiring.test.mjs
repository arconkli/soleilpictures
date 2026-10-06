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
  assert.match(b, /genuineCards\(ybCardsRef\.current \|\| \[\]\)\.filter\(\(c\) => c\?\.createdBy === uid\)/,
    'only the person\'s own, non-seed cards count as work to come back to');
  assert.match(b, /if \(!gate\.canEdit \|\| gate\.tourActive \|\| gate\.showCoachmark \|\| tier\.loading\) return;/,
    'never on a board they cannot edit, under the tour or coachmark, or before the tier is known');
  assert.match(b, /shouldGreetResume\(\{ awayMs, accountAgeMs: now - created/, 'day-one gate is the pure predicate');
  assert.match(b, /pageState\.greeted = true/, 'once per page — module state, so a Workspace remount cannot replay it');
  assert.match(app, /resumeGateRef\.current = \{ canEdit: !!canEditCurrent, tourActive: !!tourActive, showCoachmark: !!showCoachmark \}/,
    'the gate values are refreshed every render');
});

test('every way back is watched, and the hide is stamped where a later page can read it', () => {
  const b = block();
  assert.match(b, /visibilityState === 'hidden'\) \{ stampHidden\(\); return; \}/);
  assert.match(b, /addEventListener\('pagehide', stampHidden\)/, 'a closed tab stamps too');
  assert.match(b, /greet\('tab'/);
  assert.match(b, /greet\('reopen'/);
  assert.match(b, /greet\('idle'/);
  assert.match(b, /pageState\.reopenTried = true/, 'the reopen check runs once per page, not on every board or workspace switch');
  assert.match(b, /if \(document\.visibilityState !== 'visible'\) return;\s+const at = readHidden\(\);\s+consumeHidden\(\);/,
    'a reopen is read only by a visible page, which consumes the stamp');
  assert.match(b, /const at = readHidden\(\);\s+consumeHidden\(\);\s+if \(at > 0\) greet\('tab'/, 'the tab path consumes it too');
});

test('the jump navigates like ⌘K — the board\'s own path, on its canvas — then flashes the card', () => {
  const b = block();
  assert.match(b, /setStack\(ancestorPath\(boardsRef\.current \|\| \{\}, boardId\)\)/, 'never a push onto the open stack');
  assert.match(b, /setViewOverride\(\(o\) => \(\{ \.\.\.o, \[boardId\]: 'canvas' \}\)\)/, 'the flash path is canvas-only');
  assert.doesNotMatch(b, /openBoardRef\.current\?\.\(boardId\)/);
  assert.match(b, /new CustomEvent\('soleil-flash-card'/);
});

test('the mix prompt is retired at one flag, with the dock wiring left in place', () => {
  assert.equal(MIX_PROMPT_RETIRED, true);
  assert.match(canvas, /const mixPromptEligible = !MIX_PROMPT_RETIRED && dockAllowed\('mix'\)/);
  assert.match(canvas, /\{mixPromptVisible && selectedTool === 'select' && \(/, 'the JSX stays, so a revert is one line');
});
