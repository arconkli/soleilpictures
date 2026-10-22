// editorLimitPreview.test.mjs — Settings › Preview stays an admin-only,
// preview-and-dev-only, look-only door onto the 10-editor limit's states.
//
//   node --test src/lib/editorLimitPreview.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(path.join(here, '..', p), 'utf8');

test('the preview is available on the preview host and in dev, and reads null otherwise', () => {
  const src = read('lib/editorLimitPreview.js');
  assert.match(src, /export function editorLimitPreviewAvailable\(\) \{\s+return onPreviewHost\(\) \|\| !!import\.meta\.env\.DEV;\s+\}/);
  assert.match(src, /export function readEditorLimitPreview\(\) \{\s+if \(!editorLimitPreviewAvailable\(\)\) return null;/);
});

test('Preview is an admin tab, not a public one, and its pane re-checks isAdmin', () => {
  const panel = read('components/SettingsPanel.jsx');
  const adminTabs = panel.slice(panel.indexOf('const ADMIN_TABS = ['), panel.indexOf('];', panel.indexOf('const ADMIN_TABS = [')));
  assert.ok(adminTabs.includes("{ id: 'preview', label: 'Preview', group: 'admin' }"));
  const publicTabs = panel.slice(panel.indexOf('const TABS = ['), panel.indexOf('];', panel.indexOf('const TABS = [')));
  assert.doesNotMatch(publicTabs, /'preview'/);
  assert.ok(panel.includes("{tab === 'preview' && isAdmin && ("));
  assert.ok(panel.includes("t.id !== 'preview' || editorLimitPreviewAvailable()"));
});

test('the hook restates the numbers through the preview, and the ask just says so', () => {
  const hook = read('hooks/useEditorLimit.js');
  assert.ok(hook.includes('applyEditorLimitPreview('));
  assert.ok(hook.includes('EDITOR_LIMIT_PREVIEW_EVENT'));
  assert.ok(read('components/ShareModal.jsx').includes("if (editorLimit.previewing) { setAskState('sent'); return; }"));
});
