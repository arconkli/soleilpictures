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

test('Spotlight (direction A): a chip lights its tag up on the cluster', () => {
  const canvas = read('../components/CanvasSurface.jsx');
  assert.match(canvas, /toggleSpotlight\(t\.id, 'card_chip'\)/);
  assert.match(canvas, /toggleSpotlight\(t\.id, 'board_chip'\)/);
  assert.match(canvas, /toggleSpotlight\(t\.id, 'group_chip'\)/);
  assert.match(canvas, /\$\{spotMatched && !spotMatched\.has\(c\.id\) \? ' is-spot-dim' : ''\}/);
  assert.match(canvas, /className="tag-spotlight-pill" role="status"/);
  assert.match(canvas, /aria-label=\{`Clear filter: \$\{spotlightTag\.name\}`\}/);
  assert.match(canvas, /openTagPage\(spotlightTag\.id, 'spotlight'\)/, 'the tag in the pill opens its page');
  assert.match(canvas, /openTagPage\(tag\.id, 'chip_menu'\)/, 'the chip menu opens its page');
  const css = read('../styles.css');
  assert.match(css, /\.card\.is-spot-dim \{\s*opacity: \.16;\s*filter: grayscale\(\.85\);/, 'the mockup\'s dim');
});

test('a suggestion shows on its card, kept or dismissed in one tap', () => {
  const canvas = read('../components/CanvasSurface.jsx');
  assert.match(canvas, /className="card-tag-chip is-suggested"/);
  assert.match(canvas, /acceptSuggestion\(c\.id, suggTag\)/);
  assert.match(canvas, /dismissSuggestion\(c\.id, suggTag\)/);
  // Dismissing keeps it off the card for the automatic paths too.
  assert.match(canvas, /await dismissCardSuggestion\(\{ tagId: tag\.id, cardId \}\);\s*await dismissAutotagSuggestion\(/);
  // The scorer writes the cluster on each row, so the canvas can read them back.
  assert.match(canvas, /kind: 'card', id: c\.id, boardId: s\.board\.id,/);
  assert.match(read('../hooks/useTagSuggestions.js'), /\.eq\('board_id', boardId\)\s*\.eq\('source_kind', 'card'\)\s*\.is\('dismissed_at', null\)/);
});
