import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normalizeHost, reloadTarget, guardAllows, nextGuard, safeToReload, holdReload, reloadHeld,
  HIDDEN_FOR_MS, IDLE_FOR_MS, QUIET_XHR_MS, GUARD_WINDOW_MS, MAX_RELOADS,
} from './buildWatch.js';

const OLD = 'soleil-boards-party.arconkli.partykit.dev';
const NEW = 'soleil-boards-party.arconkli.workers.dev';
const mine = { party: OLD, buildDate: '2026-10-18' };

test('hosts compare without protocol, case or path', () => {
  assert.equal(normalizeHost(`https://${OLD.toUpperCase()}/`), OLD);
  assert.equal(normalizeHost(`wss://${OLD}/parties/main`), OLD);
  assert.equal(normalizeHost(''), '');
  assert.equal(normalizeHost(null), '');
});

test('the same host never asks for a reload, whatever its spelling', () => {
  assert.equal(reloadTarget({ party: OLD }, mine), null);
  assert.equal(reloadTarget({ party: `https://${OLD}/` }, mine), null);
  // A server that names no host (an older Worker, an unstamped build) is not a mismatch.
  assert.equal(reloadTarget({ party: null }, mine), null);
  assert.equal(reloadTarget({}, mine), null);
  assert.equal(reloadTarget(null, mine), null);
  // Nor is a tab that does not know its own.
  assert.equal(reloadTarget({ party: NEW }, { party: '', buildDate: '2026-10-18' }), null);
});

test('a moved party host asks for a reload', () => {
  assert.equal(reloadTarget({ party: NEW }, mine), `party:${NEW}`);
});

test('a build floor applies only to well-formed dates, and only to older builds', () => {
  assert.equal(reloadTarget({ party: OLD, minBuild: '2026-10-19' }, mine), 'build:2026-10-19');
  assert.equal(reloadTarget({ party: OLD, minBuild: '2026-10-18' }, mine), null);
  assert.equal(reloadTarget({ party: OLD, minBuild: '2026-10-01' }, mine), null);
  assert.equal(reloadTarget({ party: OLD, minBuild: 'tomorrow' }, mine), null);
  assert.equal(reloadTarget({ party: OLD, minBuild: '2026-10-19' }, { party: OLD, buildDate: 'dev' }), null);
});

test('the loop guard allows one reload per target per window, and a few per tab', () => {
  const t0 = 1_000_000;
  assert.equal(guardAllows(null, 'party:x', t0), true);
  const g1 = nextGuard(null, 'party:x', t0);
  assert.equal(guardAllows(g1, 'party:x', t0 + 1000), false);
  assert.equal(guardAllows(g1, 'party:x', t0 + GUARD_WINDOW_MS + 1), true);
  assert.equal(guardAllows(g1, 'build:2026-10-19', t0 + 1000), true);
  let g = null;
  for (let i = 0; i < MAX_RELOADS; i++) g = nextGuard(g, `t${i}`, t0 + i);
  assert.equal(guardAllows(g, 'another', t0 + 10 * GUARD_WINDOW_MS), false);
  assert.equal(guardAllows('not json', 'party:x', t0), true);
});

const calm = {
  hidden: true, hiddenForMs: HIDDEN_FOR_MS, idleForMs: 0,
  xhrInFlight: 0, xhrQuietForMs: Infinity, held: false,
  mediaPlaying: false, fullscreen: false, modalOpen: false, typing: false, pastDeadline: false,
};

test('a hidden tab reloads after two minutes hidden; a visible one after ten idle', () => {
  assert.equal(safeToReload(calm), true);
  assert.equal(safeToReload({ ...calm, hiddenForMs: HIDDEN_FOR_MS - 1 }), false);
  const visible = { ...calm, hidden: false, hiddenForMs: 0 };
  assert.equal(safeToReload({ ...visible, idleForMs: IDLE_FOR_MS - 1 }), false);
  assert.equal(safeToReload({ ...visible, idleForMs: IDLE_FOR_MS }), true);
});

test('nothing reloads under an upload, a held page, playing media or fullscreen', () => {
  assert.equal(safeToReload({ ...calm, xhrInFlight: 1 }), false);
  assert.equal(safeToReload({ ...calm, xhrQuietForMs: QUIET_XHR_MS - 1 }), false);
  assert.equal(safeToReload({ ...calm, held: true }), false);
  assert.equal(safeToReload({ ...calm, mediaPlaying: true }), false);
  assert.equal(safeToReload({ ...calm, fullscreen: true }), false);
  // ...not even past the deadline.
  for (const k of ['held', 'mediaPlaying', 'fullscreen']) {
    assert.equal(safeToReload({ ...calm, pastDeadline: true, [k]: true }), false, k);
  }
  assert.equal(safeToReload({ ...calm, pastDeadline: true, xhrInFlight: 1 }), false);
});

test('a dialog or typed text waits, until the deadline, and then only in a hidden tab', () => {
  assert.equal(safeToReload({ ...calm, modalOpen: true }), false);
  assert.equal(safeToReload({ ...calm, typing: true }), false);
  assert.equal(safeToReload({ ...calm, typing: true, modalOpen: true, pastDeadline: true }), true);
  const visibleIdle = { ...calm, hidden: false, hiddenForMs: 0, idleForMs: IDLE_FOR_MS * 10 };
  assert.equal(safeToReload({ ...visibleIdle, pastDeadline: true }), false);
});

test('holds nest, and each releases once', () => {
  assert.equal(reloadHeld(), false);
  const a = holdReload();
  const b = holdReload();
  a(); a();                           // a second release of `a` must not release `b`
  assert.equal(reloadHeld(), true);
  b();
  assert.equal(reloadHeld(), false);
});

test('the Worker reports the stamped host, not a hand-kept copy', () => {
  const worker = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
  assert.match(worker, /import \{[^}]*\bPARTY_HOST\b[^}]*\} from '\.\/lib\/buildInfo\.js'/);
  assert.match(worker, /party: PARTY_HOST \|\| null/);
  const stamp = readFileSync(new URL('../../scripts/stamp-build.mjs', import.meta.url), 'utf8');
  // The stamp reads the variable the client modules read, with their fallback.
  assert.match(stamp, /env\.VITE_PARTYKIT_HOST \|\| 'localhost:1999'/);
  const info = readFileSync(new URL('./buildInfo.js', import.meta.url), 'utf8');
  assert.match(info, /export const PARTY_HOST = '/);
});
