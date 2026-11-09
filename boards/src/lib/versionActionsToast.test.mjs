// versionActionsToast.test.mjs — a failed new version says so once.
//
//   node --test src/lib/versionActionsToast.test.mjs
//
// The failed tray row and the card's "Didn’t upload" strip carry Retry and
// Dismiss; the coded toast is only for a surface with no tray.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('./versionActions.js', import.meta.url), 'utf8');

test('version_upload_failed toasts only when no tray is mounted', () => {
  assert.match(src, /import \{[^}]*\btrayMounted\b[^}]*\} from '\.\/activity\.js'/);
  assert.match(src, /if \(!trayMounted\(\)\) feedback\?\.toast\?\.\(\{ type: 'error', code: 'version_upload_failed'/);
});
