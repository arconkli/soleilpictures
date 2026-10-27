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

test('a card\'s chips hang under it, outside the card that clips', () => {
  const canvas = read('../components/CanvasSurface.jsx');
  // .card clips what it holds (overflow: hidden, contain: paint): a strip
  // inside it never showed, from May until 2026-10-26.
  assert.match(canvas, /const tagStrip = \(cardTags\.length > 0 \|\| suggTag\) \? \(\s*<div className=\{`card-tags-strip/);
  assert.match(canvas, /return <Fragment key=\{c\.id\}>\{cardEl\}\{tagStrip\}<\/Fragment>;/);
  assert.match(canvas, /const stripStyle = \{ position: 'absolute', left: x, top: y \+ h \+ 6, width: Math\.max\(w, 180\) \};/);
  const css = read('../styles.css');
  assert.match(css, /\.card \{[^}]*overflow: hidden;[^}]*contain: paint;/, 'if .card stops clipping, this test can go');
  assert.match(css, /\.card-tags-strip\.is-spot-dim \{ opacity: \.16; filter: grayscale\(\.85\); \}/, 'the chips dim with their card');
  // One slot at the top centre: the pill sits below the Studio bar or a hint.
  assert.match(css, /\.canvas-wrap:has\(> \.cnv-studio-bar, > \.cnv-hint\) > \.tag-spotlight-pill \{ top: 60px; \}/);
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

test('several cards at once: the tri-state picker over the selection', () => {
  const canvas = read('../components/CanvasSurface.jsx');
  assert.match(canvas, /id: 'tag-many', label: `Tag \$\{selected\.size\} cards…`/);
  assert.match(canvas, /<TagManyPicker/);
  assert.match(canvas, /tagManyCards\(ids, tag, 'add', 'drop_selection'\)/, 'a drop on a selected card tags the selection');
  const bar = read('../components/toolbar/SelectionBarA.jsx');
  assert.match(bar, /find\(api\.items\(\), 'tag-many'\)\?\.run\?\.\(e\.currentTarget\.getBoundingClientRect\(\)\)/);
  // Tag reads as pressed while its picker is open, and a second press closes it.
  assert.match(bar, /aria-haspopup="dialog" aria-expanded=\{tagOpen\} data-tag-many-trigger=""/);
  assert.match(canvas, /setTagMany\(prev => \(prev \? null : \{ anchorRect, cardIds: ids \}\)\)/);
  const picker = read('../components/TagManyPicker.jsx');
  assert.match(picker, /aria-pressed=\{st === 'all' \? 'true' : st === 'some' \? 'mixed' : 'false'\}/);
  assert.match(picker, /useDismissOnOutside\(ref, open, onClose, \{ ignore: '\[data-tag-many-trigger\]' \}\)/);
  assert.match(picker, /onApply\?\.\(row\.tag, stateOf\(row\.tag\) === 'all' \? 'remove' : 'add'\)/);
  const api = read('tagCardsBatch.js');
  // One write each way; a removal keeps the tag off unless it's an undo.
  assert.match(api, /export async function untagCards\(\{ workspaceId, boardId, cardIds, tagId, userId = null, keepOff = true \}\)/);
  assert.match(picker, /untagCards\(\{ workspaceId, boardId, cardIds: missing, tagId: tag\.id, keepOff: false \}\)/);
});

test('phones reach a tag\'s actions and a tagged item\'s', () => {
  const side = read('../components/SidebarTags.jsx');
  assert.match(side, /className="sb-tag-row-more"/);
  assert.match(side, /if \(prefersSheet\(\)\) \{ setSheetFor\(tag\); return; \}/);
  assert.match(side, /\{ id: 'delete', label: 'Delete tag', danger: true, run: \(\) => promptDelete\(sheetFor\) \}/);
  const page = read('../components/TagDetailView.jsx');
  assert.match(page, /onPointerDown=\{onItemPressStart\}/);
  assert.match(page, /data-tag-item=\{JSON\.stringify\(menuTarget\)\}/);
  assert.match(page, /itemSheet\.source \? \{ id: 'remove', label: 'Remove tag', run: \(\) => removeTag\(itemSheet\) \} : null/);
  // The sheet loads on demand: phones alone need it, the sidebar loads with every page.
  assert.match(side, /const TagActionSheet = lazyWithReload\(\(\) => import\('\.\/TagActionSheet\.jsx'\)/);
  assert.doesNotMatch(side, /from '\.\/TagActionSheet\.jsx'/);
  assert.match(readFileSync(join(here, '../../scripts/bundleBudget.mjs'), 'utf8'), /'TagActionSheet',/);
  // A doc item opens at its page from the menu and the sheet alike.
  assert.match(page, /if \(m\.kind === 'doc' && m\.pageId\) \{\s*navigate\(\{ kind: 'docPos'/);
  assert.match(read('../styles.css'), /@media \(hover: none\) \{\s*\.sb-tag-row-more \{ opacity: 1; width: 40px; height: 40px;/);
});
