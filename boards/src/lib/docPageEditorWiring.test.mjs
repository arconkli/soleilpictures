// Wiring checks on DocPageEditor that need a workspace backend to exercise in
// a browser, so they are pinned at the source level instead.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(here, rel), 'utf8');

test('TAGS-04-DOC: "See all references" in a doc uses the ref the popover hands over', () => {
  const pop = read('../components/EntityHoverPopover.jsx');
  // The popover passes (ref, name) — a term-only hover has no linkHover.refs.
  assert.match(pop, /onSeeAll\(seeAllRef, headingTerm\)/);
  const ed = read('../components/DocPageEditor.jsx');
  const m = /<EntityHoverPopover[\s\S]*?onSeeAll=\{\(([^)]*)\) => \{([\s\S]*?)\}\}/.exec(ed);
  assert.ok(m, 'DocPageEditor passes onSeeAll to EntityHoverPopover');
  assert.match(m[1], /ref\s*,\s*name/, 'onSeeAll takes (ref, name)');
  assert.match(m[2], /linkHover\.refs\?\.\[0\]\s*\|\|\s*ref/, 'falls back to the handed-over ref');
  assert.match(m[2], /_name:\s*name/, 'names the drawer after the term');
});
