// first-board-wiring.spec.js — source-guard for the App.jsx-only wiring of the
// first-board panel. ?local=1 mounts LocalBoardsApp, so nothing in App.jsx's
// body is reachable in a live test; these assert on CODE SHAPE, not prose
// (the collab-nudge-wiring idiom).
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, new URL('../', import.meta.url)), 'utf8');
const app = () => read('src/App.jsx');
const canvas = () => read('src/components/CanvasSurface.jsx');

test.describe('first-board wiring', () => {
  test('App passes readiness, first-board and kind to the canvas', () => {
    const s = app();
    expect(s).toMatch(/boardReady=\{/);
    expect(s).toMatch(/firstBoard=\{/);
    expect(s).toMatch(/firstBoardKind=\{firstBoardKind\}/);
    expect(s).toMatch(/firstBoardKindFrom\(/);
  });

  test('the intent pick no longer seeds an empty named cluster', () => {
    expect(app()).not.toMatch(/addNewBoard\?\.\(null, \{ name: choice\.boardName/);
  });

  test('the empty panel waits for the board to hydrate', () => {
    expect(canvas()).toMatch(/const emptyPanelVisible = canEdit && !isPublic && boardReady/);
  });
});
