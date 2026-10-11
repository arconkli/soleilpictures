// The "Linked from" drawer (EntityBacklinksPanel) takes the entity it shows as
// `target`. It used to take it as `ref`, which React 18 reserves: a plain
// function component never sees props.ref, so the panel read undefined, hit its
// `if (!targetRef) return null` and never drew — from every entry point (the
// card and background context menus, a doc link's "See all references").
//
// A source pin rather than a render: the panel pulls in supabase and the
// entity context, and the bug is entirely in how the prop is spelled.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), 'utf8');

test('the panel reads its entity from `target`, not the reserved `ref`', () => {
  const panel = read('../components/EntityBacklinksPanel.jsx');
  assert.match(panel, /export function EntityBacklinksPanel\(\{ target: targetRef, onClose \}\)/);
  assert.doesNotMatch(panel, /EntityBacklinksPanel\(\{\s*ref\b/);
});

test('every mount passes `target=`, none passes `ref=`', () => {
  for (const file of ['../App.jsx', '../components/DocPageEditor.jsx']) {
    const src = read(file);
    const mounts = src.match(/<EntityBacklinksPanel\b[\s\S]*?\/>/g) || [];
    assert.ok(mounts.length > 0, `${file} mounts the panel`);
    for (const m of mounts) {
      assert.match(m, /\btarget=\{/, `${file}: ${m}`);
      assert.doesNotMatch(m, /\sref=\{/, `${file}: ${m}`);
    }
  }
});
