// Text pins for the app half of working live together: the wiring that no
// unit test drives (the socket, App.jsx, the harness guard). The room's
// message and the chip's words are tested in liveTogether.test.mjs; the state
// fold in togetherState.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const party = read('./yPartyKit.js');
const app = read('../App.jsx');
const api = read('./boardsApi.js');
const budget = read('../../scripts/bundleBudget.mjs');
const main = read('../main.jsx');
const chip = read('../components/TogetherChip.jsx');

test('the socket hands the room\'s together message to the app, with the board', () => {
  assert.match(party, /provider\.on\('custom-message', onTogether\)/);
  assert.match(party, /readTogether\(text\)/);
  assert.match(party, /new CustomEvent\('soleil-together', \{ detail: \{ boardId, \.\.\.m \} \}\)/);
  assert.match(party, /provider\.off\('custom-message', onTogether\)/);
});

test('the here stamp is throttled, gated on visibility and removed on destroy', () => {
  assert.match(party, /import \{ HERE_EVERY_MS \} from '\.\/togetherClock\.js'/);
  assert.match(party, /setLocalStateField\('here'/);
  assert.match(party, /now - lastHereAt < HERE_EVERY_MS/);
  assert.match(party, /export function setHereBoard\(boardId\) \{ hereBoardId = boardId \|\| null; \}/);
  assert.match(party, /boardId !== hereBoardId/);
  assert.match(app, /setHereBoard\(landingPending \? null : currentBoard\?\.id\)/);
  assert.match(party, /document\.visibilityState !== 'visible'/);
  assert.match(party, /if \(user && typeof window !== 'undefined'\) \{\s*for \(const ev of HERE_EVENTS\) window\.addEventListener\(ev, onHereInput, hereOpts\)/);
  assert.match(party, /for \(const ev of HERE_EVENTS\) \{ try \{ window\.removeEventListener\(ev, onHereInput, hereOpts\)/);
  // Every listener added for this has its removal.
  const added = party.match(/addEventListener\(ev, onHereInput/g) || [];
  const removed = party.match(/removeEventListener\(ev, onHereInput/g) || [];
  assert.equal(added.length, removed.length);
  assert.ok(added.length >= 1);
  for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']) {
    assert.ok(party.includes(`'${ev}'`), ev);
  }
});

test('App lazy-loads the chip and shows it to free accounts only', () => {
  assert.match(app, /const TogetherChip = lazyWithReload\(\(\) => import\('\.\/components\/TogetherChip\.jsx'\)\)/);
  assert.match(app, /myTier\.tier === 'demo' && togetherShown\(together, Date\.now\(\)\)/);
  assert.equal((app.match(/\{togetherChipEl\}/g) || []).length, 2);
});

test('the referral reward toast leaves out cards from working together', () => {
  assert.match(app, /getMyTogetherStats\(\)\.then\(/);
  assert.match(app, /rewardCardsBeyondTogether\(was, now, delta\)/);
  assert.match(app, /if \(rest > 0\)/);
  assert.match(app, /bonusSplitRef\.current = step\.then\(/);
});

test('get_my_together_stats is awaited, never .catch()ed', () => {
  const at = api.indexOf("supabase.rpc('get_my_together_stats')");
  assert.ok(at > 0);
  const line = api.slice(at, api.indexOf('\n', at));
  assert.ok(!line.includes('.catch('), line);
});

test('the chip is a lazy chunk of its own in the bundle budget', () => {
  assert.match(budget, /LAZY_IN_APP = \[[\s\S]*'TogetherChip'/);
});

test('the popover is portaled to <body> and opening it closes the arrival note', () => {
  const chip = read('../components/TogetherChip.jsx');
  assert.match(chip, /import \{ createPortal \} from 'react-dom'/);
  assert.match(chip, /createPortal\(/);
  assert.match(chip, /document\.body,\s*\)/);
  assert.match(chip, /noteDismissRef\.current = onArrive\?\.\(/);
  assert.match(chip, /if \(!open \|\| !noteDismissRef\.current\) return;[\s\S]*?noteDismissRef\.current = null;[\s\S]*?try \{ if \(typeof dismiss === 'function'\) dismiss\(\); \} catch/);
});

test('the dev harness stays behind the literal DEV guard', () => {
  assert.match(main, /\} else if \(import\.meta\.env\.DEV && isTogetherQaMode\(\)\) \{/);
});

test('the chip popover takes focus and names itself on the button', () => {
  assert.match(chip, /aria-controls=\{open \? popId : undefined\}/);
  assert.match(chip, /popRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
});
