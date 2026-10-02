// scriptImport — a dropped .fountain parses the same way the doc menu's import
// does, names the card sensibly, and is WRITTEN into the card's doc as the card
// is made: on every device at once, for every reader, never waiting for an
// editor to open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Y from 'yjs';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { ScreenplayBlock } from '../components/docExtensions/screenplay/ScreenplayBlock.js';
import { parseScriptText, isEmptyScript, scriptBody, SCRIPT_FILE_RE } from './scriptImport.js';
import {
  initCardDocStore, cardScope, setTitlePage, getTitlePage, getDocUndoManager,
  writeScriptBody, readPages, pageContentMap, readDocSummary, followTitle, renamePage,
} from './docState.js';

const FOUNTAIN = [
  'Title: The Long Night',
  'Credit: written by',
  'Author: Someone',
  '',
  'INT. DINER - NIGHT',
  '',
  'Rain on the windows.',
  '',
  'MAYA',
  'We should go.',
  '',
].join('\n');

test('only screenplay extensions are claimed', () => {
  for (const n of ['a.fountain', 'B.FDX', 'draft v2.fountain']) assert.ok(SCRIPT_FILE_RE.test(n), n);
  for (const n of ['a.txt', 'a.fountain.zip', 'fdx.pdf', 'a.pur']) assert.ok(!SCRIPT_FILE_RE.test(n), n);
});

test('a fountain file parses into blocks and a title page', () => {
  const p = parseScriptText(FOUNTAIN, 'long-night.fountain');
  assert.equal(p.format, 'fountain');
  assert.ok(p.blocks.length >= 3, 'scene, action and dialogue all survive');
  assert.equal(p.titlePage?.title, 'The Long Night');
  assert.equal(p.title, 'The Long Night', 'the title page names the card');
  assert.equal(isEmptyScript(p), false);
});

test('without a title page the file name names the card', () => {
  const p = parseScriptText('INT. HOUSE - DAY\n\nQuiet.\n', 'My Short.fountain');
  assert.equal(p.titlePage, null);
  assert.equal(p.title, 'My Short');
});

test('an empty file is recognised as nothing to import', () => {
  assert.equal(isEmptyScript(parseScriptText('', 'empty.fountain')), true);
  assert.equal(isEmptyScript(null), true);
});

// Every element the parsers produce, dual dialogue, a forced page break.
const FULL = [
  'Title: The Long Night', 'Author: Someone', '',
  'INT. DINER - NIGHT', '', 'Rain on the windows.', '',
  'MAYA', '(quietly)', 'We should go.', '',
  'TOM ^', 'No.', '',
  '> THE END? <', '', '===', '', 'CUT TO:', '',
  'EXT. ROAD - LATER', '', '!MAYA WALKS.', '',
].join('\n');

// The schema the doc editor binds with, for every node a script is made of:
// baseDocExtensions is StarterKit + ScreenplayBlock + marks and other nodes
// (asserted below), and it can't be imported here whole — some of its nodes
// pull in the Supabase client.
const schema = getSchema([StarterKit.configure({ history: false, heading: { levels: [1, 2, 3, 4, 5, 6] } }), ScreenplayBlock]);

// A board doc holding one script card, made the way App's addScriptCard makes
// it: card, doc store, title page and body in ONE 'local' transaction.
function boardWithDroppedScript(parsed) {
  const ydoc = new Y.Doc();
  const cards = ydoc.getMap('cards');
  const boardUndo = new Y.UndoManager(cards, { trackedOrigins: new Set(['local']) });
  ydoc.transact(() => {
    const ym = new Y.Map();
    cards.set('doc-1', ym);
    ym.set('kind', 'doc');
    initCardDocStore(ydoc, ym);
    const scope = cardScope(ym);
    if (parsed.titlePage) setTitlePage(ydoc, scope, { enabled: true, ...parsed.titlePage });
    writeScriptBody(ydoc, scope, scriptBody(parsed), { name: parsed.title });
  }, 'local');
  return { ydoc, boardUndo, scope: () => cardScope(cards.get('doc-1')) };
}

test('the body is written as the card is made: one page, every block, on any device', () => {
  const parsed = parseScriptText(FULL, 'night.fountain');
  const { ydoc } = boardWithDroppedScript(parsed);
  // Another device (or this one after a reload) is a fresh doc from the state.
  const again = new Y.Doc();
  Y.applyUpdate(again, Y.encodeStateAsUpdate(ydoc));
  const scope = cardScope(again.getMap('cards').get('doc-1'));
  const pages = readPages(again, scope);
  assert.equal(pages.length, 1, 'one page, so an editor opening it seeds nothing of its own');
  assert.equal(pages[0].name, 'The Long Night');
  assert.equal(getTitlePage(again, scope).title, 'The Long Night');
  assert.match(readDocSummary(again, 600, scope).firstText, /^INT\. DINER - NIGHT Rain on the windows\. MAYA \(quietly\) We should go\./,
    'the closed card previews the script, for every reader');
});

test('what is written is exactly what the editor would write — y-prosemirror reads it back whole', () => {
  // The editor's binding DELETES any element that fails the schema on its first
  // render, so this is the difference between a script and an empty page.
  const parsed = parseScriptText(FULL, 'night.fountain');
  const { ydoc, scope } = boardWithDroppedScript(parsed);
  const frag = pageContentMap(ydoc, scope()).get(readPages(ydoc, scope())[0].id);
  const root = yXmlFragmentToProseMirrorRootNode(frag, schema);
  root.check();
  const expected = schema.nodeFromJSON(scriptBody(parsed));
  assert.deepEqual(root.toJSON(), expected.toJSON(), 'identical to what the toolbar Import hands setContent');
  const els = new Set(scriptBody(parsed).content.map((n) => (n.type === 'screenplayBlock' ? n.attrs.element : n.type)));
  for (const e of ['scene', 'action', 'character', 'parenthetical', 'dialogue', 'centered', 'transition', 'horizontalRule']) {
    assert.ok(els.has(e), `the fixture exercises ${e}`);
  }
  assert.ok(scriptBody(parsed).content.some((n) => n.attrs?.dual === 'right'), 'and dual dialogue');
});

test('the test schema is the editor\'s, for every node a script is made of', () => {
  const base = read('../components/docExtensions/baseExtensions.js');
  assert.match(base, /StarterKit\.configure\(\{\s*history: false,/);
  assert.match(base, /\bScreenplayBlock,\s*\];/);
  for (const n of ['doc', 'text', 'horizontalRule', 'screenplayBlock']) assert.ok(schema.nodes[n], n);
});

test('one canvas undo takes back the whole import, and nothing is left waiting anywhere', () => {
  const parsed = parseScriptText(FOUNTAIN, 'x.fountain');
  const { ydoc, boardUndo, scope } = boardWithDroppedScript(parsed);
  assert.equal(boardUndo.undoStack.length, 1, 'card + doc store + title page + body: one step');
  assert.equal(getDocUndoManager(ydoc, scope()).undoStack.length, 0, 'not a doc-structure step');
  for (const k of scope().meta.keys()) assert.doesNotMatch(k, /pending|import/i, 'docMeta holds settings, never a waiting body');
  boardUndo.undo();
  assert.equal(ydoc.getMap('cards').get('doc-1'), undefined);
});

test('a script with only a title page writes no page — the editor seeds its own', () => {
  const parsed = parseScriptText('Title: Just A Title\n', 't.fountain');
  assert.equal(scriptBody(parsed), null);
  const { ydoc, scope } = boardWithDroppedScript(parsed);
  assert.equal(readPages(ydoc, scope()).length, 0);
  assert.equal(writeScriptBody(ydoc, scope(), { type: 'doc', content: [] }), null);
});

// ── Wiring. Playwright is not in CI. ──
const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(here, rel), 'utf8');

test('the card is made with its title page and body, and a refused card is never reported', () => {
  const app = read('../App.jsx');
  const fn = app.slice(app.indexOf('const addScriptCard = ('), app.indexOf('const setBoardBgColor = '));
  assert.match(fn, /afterInsert: \(cardYM\) => \{[\s\S]*setTitlePage\(ydoc, scope, \{ enabled: true, \.\.\.script\.titlePage \}\)[\s\S]*writeScriptBody\(ydoc, scope, script\.body, \{ name: title \}\)/,
    'inside the creation transaction, so one undo takes back the whole import');
  assert.match(fn, /if \(!placed\) return null;\s*setAutoFocusId\(placed\);\s*return placed;/);
  const add = app.slice(app.indexOf('const addCard = (card, { afterInsert = null } = {}) => {'), app.indexOf('const guardWeightedAdd = '));
  assert.match(add, /surfaceCapHit\(cs\);\s*return null;/, 'a cap refusal places nothing and says so');
  assert.match(add, /tourFireRef\.current\?\.\([^)]*\);\s*\}\s*\}\s*return placedId;\s*\};/, 'a placed card names itself');
  const drop = read('./dropOutcomes.js');
  assert.match(drop, /const id = addScriptCard\?\.\(pos, \{ title: parsed\.title, script: \{ titlePage: parsed\.titlePage, body: mod\.scriptBody\(parsed\) \} \}\);\s*if \(!id\) return null;\s*try \{ logEvent\(EV\.SCRIPT_IMPORTED/,
    'script_imported only for a card that exists');
  const fn2 = drop.slice(drop.indexOf('export async function importDroppedScripts('));
  assert.ok(fn2.indexOf('SCRIPT_ONE_AT_A_TIME') > fn2.indexOf('if (!id) return null;'), '"the first is on the board" is said only once it is');
});

test('no editor applies a script on open any more — there is nothing waiting to apply', () => {
  const ds = read('../components/DocSurface.jsx');
  assert.doesNotMatch(ds, /ScriptImport|scriptImport|pendingScript/);
  assert.doesNotMatch(read('./scriptImport.js'), /new Map\(\)/, 'no page-memory copy left to come back empty after a reload');
  assert.doesNotMatch(read('./docState.js'), /pendingScriptImport|PENDING_SCRIPT_KEY/);
  assert.doesNotMatch(read('../components/DocCard.jsx'), /pendingScript/);
});

test('the first page follows the card title while it tracks it, and stops once named by hand', () => {
  const parsed = parseScriptText(FOUNTAIN, 'x.fountain');
  const { ydoc, scope } = boardWithDroppedScript(parsed);
  const name = () => readPages(ydoc, scope())[0].name;
  assert.equal(name(), 'The Long Night');
  // Renamed before the first open — the closed card's title field.
  assert.equal(followTitle(ydoc, scope(), 'The Long Night', 'Draft 3'), true);
  assert.equal(name(), 'Draft 3');
  // The person names the page themselves: from then on a title change leaves it.
  renamePage(ydoc, readPages(ydoc, scope())[0].id, 'Act One', scope());
  assert.equal(followTitle(ydoc, scope(), 'Draft 3', 'Draft 4'), false);
  assert.equal(name(), 'Act One');
  // A seeded default always follows.
  renamePage(ydoc, readPages(ydoc, scope())[0].id, 'Untitled', scope());
  assert.equal(followTitle(ydoc, scope(), 'Draft 4', 'Draft 5'), true);
  assert.equal(name(), 'Draft 5');
});

test('the closed card\'s title field and the open doc share that one rule', () => {
  const card = read('../components/DocCard.jsx');
  assert.match(card, /ydoc\.transact\(\(\) => \{\s*try \{ followTitle\(ydoc, scope, card\.title \|\| '', next\); \} catch \(_\) \{\}\s*onUpdate\(\{ title: next \}\);\s*\}, 'local'\);/,
    'the page and the title move in one canvas step');
  const ds = read('../components/DocSurface.jsx');
  assert.match(ds, /followTitle\(ydoc, scope, prev, titleOverride\);/);
  assert.doesNotMatch(ds, /const DEFAULT_NAMES = /, 'one copy of the rule, in docState');
});
