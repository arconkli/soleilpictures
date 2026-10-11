// Screenplay ⇄ Doc mode switch — lossless both ways, and converted by ONE
// writer in the same transaction as the flip (so a collaborator's editor never
// converts too and duplicates the doc).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Y from 'yjs';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { yXmlFragmentToProseMirrorRootNode, prosemirrorToYXmlFragment } from 'y-prosemirror';
import { ScreenplayBlock } from '../components/docExtensions/screenplay/ScreenplayBlock.js';
import {
  initCardDocStore, cardScope, writeScriptBody, readPages, pageContentMap,
  switchDocMode, getDocMode, getDocUndoManager, metaMap, renamePage, healDocMode,
} from './docState.js';

// The doc editor's schema for these nodes (see scriptImport.test.mjs).
const schema = getSchema([StarterKit.configure({ history: false, heading: { levels: [1, 2, 3, 4, 5, 6] } }), ScreenplayBlock]);

const sp = (element, text, extra = {}) => ({ type: 'screenplayBlock', attrs: { element, sceneNumber: null, dual: null, ...extra }, content: text ? [{ type: 'text', text }] : [] });
const SCRIPT = {
  type: 'doc',
  content: [
    sp('scene', 'INT. DINER - NIGHT', { sceneNumber: '5A' }),
    sp('action', 'Rain on the windows.'),
    sp('character', 'MAYA', { dual: 'left' }),
    sp('parenthetical', '(quietly)', { dual: 'left' }),
    sp('dialogue', 'We should go.', { dual: 'left' }),
    sp('character', 'TOM', { dual: 'right' }),
    sp('dialogue', 'No.', { dual: 'right' }),
    sp('shot', 'CLOSE ON THE DOOR'),
    sp('centered', 'THE END'),
    sp('transition', 'CUT TO:'),
  ],
};

function scriptDoc() {
  const ydoc = new Y.Doc();
  const cards = ydoc.getMap('cards');
  ydoc.transact(() => {
    const ym = new Y.Map();
    cards.set('doc-1', ym);
    ym.set('kind', 'doc');
    initCardDocStore(ydoc, ym);
    const scope = cardScope(ym);
    writeScriptBody(ydoc, scope, SCRIPT, { name: 'Night' });
    metaMap(ydoc, scope).set('mode', 'screenplay');
  }, 'local');
  const scope = () => cardScope(ydoc.getMap('cards').get('doc-1'));
  const frag = () => pageContentMap(ydoc, scope()).get(readPages(ydoc, scope())[0].id);
  // What the editor would render: y-prosemirror reads it against the schema
  // (an invalid element would be DELETED on first render).
  const pm = () => { const root = yXmlFragmentToProseMirrorRootNode(frag(), schema); root.check(); return root; };
  return { ydoc, scope, frag, pm };
}

const blocks = (root) => root.content.content.map((n) => ({
  type: n.type.name,
  element: n.type.name === 'screenplayBlock' ? n.attrs.element : (n.attrs.spElement ?? null),
  sceneNumber: n.type.name === 'screenplayBlock' ? n.attrs.sceneNumber : (n.attrs.spSceneNumber ?? null),
  dual: n.type.name === 'screenplayBlock' ? n.attrs.dual : (n.attrs.spDual ?? null),
  text: n.textContent,
}));

test('Screenplay off then on keeps every element, locked scene number and dual column', () => {
  const { ydoc, scope, pm } = scriptDoc();
  const before = blocks(pm());

  switchDocMode(ydoc, scope(), 'doc');
  assert.equal(getDocMode(ydoc, scope()), 'doc');
  const prose = pm();
  assert.deepEqual(prose.content.content.map((n) => n.type.name), Array(SCRIPT.content.length).fill('paragraph'),
    'Doc mode shows plain paragraphs, so the prose toolbar applies');
  assert.deepEqual(prose.content.content.map((n) => n.textContent), before.map((b) => b.text), 'text untouched');

  switchDocMode(ydoc, scope(), 'screenplay');
  assert.deepEqual(blocks(pm()), before, 'every element comes back — not just sluglines and transitions');
});

test('the memory survives the editor rewriting the paragraphs (the attrs are in the schema)', () => {
  const { ydoc, scope, frag, pm } = scriptDoc();
  const before = blocks(pm());
  switchDocMode(ydoc, scope(), 'doc');
  // The editor binding writes the doc back through y-prosemirror on every
  // edit; an attr the schema didn't declare would be stripped right there.
  ydoc.transact(() => { prosemirrorToYXmlFragment(pm(), frag()); });
  assert.equal(frag().toArray()[2].getAttribute('spElement'), 'character');
  switchDocMode(ydoc, scope(), 'screenplay');
  assert.deepEqual(blocks(pm()), before);
});

test('prose written in Doc mode is still detected as before', () => {
  const ydoc = new Y.Doc();
  const ym = new Y.Map();
  ydoc.getMap('cards').set('d', ym);
  initCardDocStore(ydoc, ym);
  const scope = cardScope(ym);
  const id = writeScriptBody(ydoc, scope, { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'int. warehouse - night' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'A guard sleeps.' }] },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'smash cut to:' }] },
  ] });
  switchDocMode(ydoc, scope, 'screenplay');
  const root = yXmlFragmentToProseMirrorRootNode(pageContentMap(ydoc, scope).get(id), schema);
  root.check();
  assert.deepEqual(root.content.content.map((n) => [n.type.name, n.attrs.element, n.textContent]), [
    ['screenplayBlock', 'scene', 'INT. WAREHOUSE - NIGHT'],
    ['screenplayBlock', 'action', 'A guard sleeps.'],
    ['screenplayBlock', 'transition', 'SMASH CUT TO:'],
  ]);
});

test('a collaborator gets the mode and the converted content in ONE update, and converts nothing itself', () => {
  const a = scriptDoc();
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a.ydoc));
  const bScope = () => cardScope(b.getMap('cards').get('doc-1'));
  const bFrag = () => pageContentMap(b, bScope()).get(readPages(b, bScope())[0].id);
  const updates = [];
  a.ydoc.on('update', (u) => updates.push(u));

  // What B's DocSurface reacts to: the meta observer that remounts its editor.
  // At that moment the content must already be prose.
  let seenAtFlip = null;
  metaMap(b, bScope()).observe(() => { seenAtFlip = bFrag().toArray().map((n) => n.nodeName); });

  switchDocMode(a.ydoc, a.scope(), 'doc');
  assert.equal(updates.length, 1, 'one transaction: mode + content');
  Y.applyUpdate(b, updates[0]);
  assert.equal(getDocMode(b, bScope()), 'doc');
  assert.deepEqual(seenAtFlip, Array(SCRIPT.content.length).fill('paragraph'), 'no window with the new mode over old content');
  assert.equal(bFrag().length, SCRIPT.content.length, 'nothing duplicated');
});

// y-prosemirror's binding transacts with its PluginKey as the origin.
const TYPING = { key: 'y-sync$' };
const typeInto = (ydoc, el, text) => ydoc.transact(() => {
  const t = el.toArray().find((c) => typeof c.toDelta === 'function');
  t.insert(t.length, text);
}, TYPING);

test('the switch is not a doc-structure undo step', () => {
  const { ydoc, scope } = scriptDoc();
  const um = getDocUndoManager(ydoc, scope());
  switchDocMode(ydoc, scope(), 'doc');
  assert.equal(um.undoStack.length, 0, 'the Screenplay pill is its own (lossless) inverse');
});

test('a structural undo after the switch never takes back what was typed into the converted lines', () => {
  const { ydoc, scope, frag, pm } = scriptDoc();
  const um = getDocUndoManager(ydoc, scope());
  // Something earlier on the structure stack for Cmd+Z to reach.
  renamePage(ydoc, readPages(ydoc, scope())[0].id, 'Night 2', scope());
  um.stopCapturing();
  switchDocMode(ydoc, scope(), 'doc');
  typeInto(ydoc, frag().toArray()[4], ' Right now.');       // my typing
  ydoc.transact(() => {                                       // a peer's new line
    const p = new Y.XmlElement('paragraph');
    const t = new Y.XmlText(); t.insert(0, 'A whole new line');
    p.insert(0, [t]);
    frag().insert(frag().length, [p]);
  }, TYPING);
  const before = blocks(pm());

  um.undo();
  assert.equal(readPages(ydoc, scope())[0].name, 'Night', 'the undo reached the rename');
  assert.equal(getDocMode(ydoc, scope()), 'doc');
  assert.deepEqual(blocks(pm()), before, 'every typed word, in order, still in Doc mode');
  assert.ok(before.some((b) => b.text === 'We should go. Right now.'));
});

test('a remembered line rewritten in Doc mode keeps its casing on the way back', () => {
  const { ydoc, scope, frag, pm } = scriptDoc();
  switchDocMode(ydoc, scope(), 'doc');
  // The MAYA cue, rewritten as ordinary prose (typing in a paragraph keeps its memory).
  ydoc.transact(() => {
    const t = frag().toArray()[2].toArray()[0];
    t.delete(0, t.length);
    t.insert(0, 'Maya hesitates at the door.');
  }, TYPING);
  switchDocMode(ydoc, scope(), 'screenplay');
  assert.deepEqual(blocks(pm())[2], { type: 'screenplayBlock', element: 'character', sceneNumber: null, dual: 'left', text: 'Maya hesitates at the door.' });
});

test('healDocMode brings stranded lines into the current mode, and writes nothing when there are none', () => {
  const { ydoc, scope, frag, pm } = scriptDoc();
  // A screenplay line left behind in Doc mode (say, a page restored by undo).
  metaMap(ydoc, scope()).set('mode', 'doc');
  const updates = [];
  ydoc.on('update', (u) => updates.push(u));
  assert.equal(healDocMode(ydoc, scope()), true);
  assert.equal(updates.length, 1);
  assert.deepEqual(pm().content.content.map((n) => n.type.name), Array(SCRIPT.content.length).fill('paragraph'));
  const first = frag().toArray()[0];
  assert.equal(healDocMode(ydoc, scope()), false);
  assert.equal(updates.length, 1, 'idempotent: no update at all');
  assert.equal(frag().toArray()[0], first);
  assert.equal(getDocUndoManager(ydoc, scope()).undoStack.length, 0, 'not a structural undo step either');
});

test('switching to the mode a doc is already in changes nothing', () => {
  const { ydoc, scope, frag } = scriptDoc();
  const first = frag().toArray()[0];
  switchDocMode(ydoc, scope(), 'screenplay');
  assert.equal(frag().toArray()[0], first, 'same Y element — no delete + reinsert');
});

// ── Wiring. Playwright is not in CI. ──
const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(here, rel), 'utf8');

test('no editor converts on mount any more, and only an editor can switch', () => {
  const ed = read('../components/DocPageEditor.jsx');
  assert.doesNotMatch(ed, /convertProseToScreenplay|convertScreenplayToProse/,
    'every client remounts on a mode change: a conversion there runs on all of them');
  assert.match(ed, /docMode === 'screenplay' && editable && editor\.isEmpty/, 'a viewer seeds nothing');
  const ds = read('../components/DocSurface.jsx');
  assert.match(ds, /const toggleScreenplay = useCallback\(\(\) => \{\s*if \(!canEdit\) return;\s*switchDocMode\(/);
  assert.doesNotMatch(ds, /\bsetDocMode\(/, 'the person-facing switches all convert');
});

test('only one editor heals, so two clients never convert the same lines', () => {
  const ds = read('../components/DocSurface.jsx');
  const heal = ds.slice(ds.indexOf('// Heal content'), ds.indexOf('healDocMode(ydoc, scope)') + 30);
  assert.match(heal, /if \(!canEdit \|\| !awareness\) return/, 'viewers write nothing');
  assert.match(heal, /Math\.min\(\.\.\.awareness\.getStates\(\)\.keys\(\)\)/, 'the lowest client id heals');
});
