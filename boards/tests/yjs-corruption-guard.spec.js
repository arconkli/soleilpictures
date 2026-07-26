// Runtime test of the Yjs corruption guard (2026-07 error-fix pass).
//
// perf.js patches Y.Doc.prototype.transact so that a throwing transaction —
// which is how Yjs CRDT struct-store corruption surfaces from applyUpdate
// (remote/library), a local transact, or UndoManager.undo — is CAUGHT rather
// than escaping as an uncaught window error / unhandled promise rejection. On
// catch it swallows, logs, and dispatches 'soleil:yjs-corruption' so useYBoard
// can self-heal (drop caches + re-sync from the server).
//
// We exercise the REAL patched prototype through the ?noteqa harness, which
// exposes an in-memory Y.Doc on window.__soleilNoteTest.docA.
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/?noteqa=1');
  await expect(page.locator('#noteqa-ready')).toHaveText('noteqa ready', { timeout: 15000 });
});

test('a throwing transaction is swallowed (not thrown) and fires the self-heal event', async ({ page }) => {
  const result = await page.evaluate(() => {
    const t = window.__soleilNoteTest;
    let eventDetail = null;
    const onCorruption = (e) => { eventDetail = e.detail || {}; };
    window.addEventListener('soleil:yjs-corruption', onCorruption);
    let threw = false;
    try {
      // Routes through the real, patched Y.Doc.prototype.transact.
      t.docA.transact(() => { throw new Error("Cannot read properties of null (reading 'forEach')"); }, 'test-origin');
    } catch (_) {
      threw = true;
    }
    window.removeEventListener('soleil:yjs-corruption', onCorruption);
    return { threw, eventDetail };
  });
  // The guard caught it — nothing propagated to crash the surface.
  expect(result.threw).toBe(false);
  // …and it signalled the board layer to self-heal, tagging the origin.
  expect(result.eventDetail).not.toBeNull();
  expect(result.eventDetail.origin).toBe('test-origin');
});

test('a normal transaction still runs and does NOT fire the event', async ({ page }) => {
  const result = await page.evaluate(() => {
    const t = window.__soleilNoteTest;
    let eventFired = false;
    const onCorruption = () => { eventFired = true; };
    window.addEventListener('soleil:yjs-corruption', onCorruption);
    let ran = false;
    t.docA.transact(() => { ran = true; t.docA.getMap('cards'); }, 'test-normal');
    window.removeEventListener('soleil:yjs-corruption', onCorruption);
    return { ran, eventFired };
  });
  expect(result.ran).toBe(true);
  expect(result.eventFired).toBe(false);
});
