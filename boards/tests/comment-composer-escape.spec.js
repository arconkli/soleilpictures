// comment-composer-escape.spec.js
//
// SHARE-9: Escape in the @mention picker also closed the whole comment
// composer, losing what was typed. The picker (EntityPicker) closes on a
// window Escape listener, and InlineComposer's document listener fired for
// the same keypress with no check for the picker.
//
// Source-level: the ?noteqa harness mounts the composer with no workspaceId,
// so typing "@" never opens a picker there, and the picker's search needs
// Supabase. The composer itself is driven end to end by
// note-comment-composer.spec.js.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

test('Escape with the mention picker open leaves the composer and its text alone', () => {
  const s = read('src/components/InlineComposer.jsx');
  expect(s).toContain('mentionRef.current = mention;');
  const at = s.indexOf("document.addEventListener('keydown', onKey)");
  expect(at).toBeGreaterThan(-1);
  const effect = s.slice(s.lastIndexOf('useEffect(', at), at);
  expect(effect).toMatch(/if \(e\.key !== 'Escape' \|\| mentionRef\.current\) return;\s*onCancel\?\.\(\);/);
  // The picker still closes itself on that Escape.
  expect(s).toMatch(/onCancel=\{\(\) => setMention\(null\)\}/);
  expect(read('src/components/EntityPicker.jsx')).toContain('useDismissOnOutside(popRef, true, onCancel)');
});
