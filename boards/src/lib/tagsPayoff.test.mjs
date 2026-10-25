// tagsPayoff.test.mjs — tagging reaches groups, clusters and passages; one
// count; the keyboard and Cmd-K reach tags.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(here, rel), 'utf8');

test('a group and the cluster itself open the real tag picker', () => {
  const canvas = read('../components/CanvasSurface.jsx');
  assert.doesNotMatch(canvas, /Group tagging is coming/, 'the placeholder toast is back');
  assert.match(canvas, /setTagPicker\(\{ kind: 'group', id: gid, anchorRect: r \}\)/);
  assert.match(canvas, /label: 'Tag this cluster…'/);
  // A removal keeps the tag off for the automatic paths, as a card's does.
  assert.match(canvas, /dismissAutotagSuggestion\(\{ workspaceId, targetKind: kind, targetId, tagId: tag\.id, userId \}\)/);
  assert.match(read('../hooks/useWorkspaceTags.js'), /return \{ tags, loaded, byCard, byBoard, byGroup, refresh \};/);
});

test('a selection in a document can be tagged, one block at a time', () => {
  const doc = read('../components/DocPageEditor.jsx');
  assert.match(doc, /label="Tag selection…"/);
  assert.match(doc, /onTagSelection=\{editable && scope\?\.docCardId \? openTagSelection : null\}/);
  assert.match(doc, /if \(to > \$from\.end\(depth\)\) return null;/, 'a selection across blocks is refused');
  assert.match(doc, /tagId: tag\.id, source: 'user',\s+sourceAnchor: picked\.anchor,/);
});

test('one count: the sidebar counts live tagged things on the server', () => {
  assert.match(read('tagsApi.js'), /supabase\.rpc\('tag_item_counts', \{ p_workspace_id: workspaceId \}\)/);
  const sql = readFileSync(join(here, '../../../supabase/migrations/0592_tag_item_counts.sql'), 'utf8');
  assert.match(sql, /revoke execute on function public\.tag_item_counts\(uuid\) from public, anon;/);
  assert.match(sql, /has_function_privilege\('anon', 'public\.tag_item_counts\(uuid\)', 'execute'\)/);
  assert.match(read('../components/TagDetailView.jsx'), /\{taggedCount\} tagged\{insideCount > 0 \?/);
});

test('the keyboard reaches tags', () => {
  const side = read('../components/SidebarTags.jsx');
  assert.match(side, /role="treeitem" tabIndex=\{-1\}/);
  assert.match(side, /if \(e\.key === 'Enter'\) \{ e\.preventDefault\(\); onOpenTag\?\.\(tag\); return; \}/);
  assert.match(side, /e\.key === 'ContextMenu' \|\| \(e\.shiftKey && e\.key === 'F10'\)/);
  assert.match(side, /if \(e\.key === 'Enter' \|\| e\.key === ' '\) \{ e\.preventDefault\(\); toggle\(\); \}/);
});

test('Cmd-K: #name lists everything carrying the tag', () => {
  const pal = read('../components/CommandPalette.jsx');
  assert.match(pal, /q\.startsWith\('#'\) && q\.length > 1/);
  assert.match(pal, /supabase\.rpc\('get_things_tagged', \{ p_tag_id: tag\.id, p_limit: 40 \}\)/);
  assert.doesNotMatch(pal, /rpc\([^)]*\)\s*\.catch\(/, 'an rpc builder is a thenable: .catch swallows it');
});
