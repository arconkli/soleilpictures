// The doc page's applied-tag subscriptions (inline ranges and the page chip
// strip) must be workspace-scoped and must not reload on an unattributable
// DELETE: unfiltered, every open doc received every entity_links DELETE on
// the platform (with RLS a DELETE's `old` is only the id) and refetched.
// This tab's own removals come through TAG_LINKS_CHANGED instead.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(here, rel), 'utf8');

for (const [label, rel] of [
  ['useAppliedTagRanges', '../hooks/useAppliedTagRanges.js'],
  ['DocPageTagChips', '../components/DocPageTagChips.jsx'],
]) {
  test(`TAGS-RT-DOC: ${label} subscribes per workspace and refreshes on this tab's changes`, () => {
    const src = read(rel);
    const block = /table: 'entity_links',([\s\S]*?)\.subscribe\(\)/.exec(src);
    assert.ok(block, 'has an entity_links subscription');
    assert.match(block[1], /filter: `source_workspace=eq\.\$\{workspaceId\}`/, 'filtered on source_workspace');
    assert.match(block[1], /if \(isDeleteEvent\(payload\)\) return;/, 'a bare DELETE is not a match');
    assert.doesNotMatch(block[1], /payload\?\.old/, 'never attributes a change from old');
    assert.match(src, /document\.addEventListener\(TAG_LINKS_CHANGED, load\)/);
    assert.match(src, /document\.removeEventListener\(TAG_LINKS_CHANGED, load\)/);
  });
}
