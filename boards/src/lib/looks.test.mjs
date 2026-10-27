// looks.test.mjs — the toolbar look (the owner's pick of 2026-10-21, shipped
// 2026-10-25) is the only look the bars have: main.jsx marks <html
// data-tb="a"> without asking, and nothing asks which look the bars wear. The
// doc editor's look (shipped 2026-10-24) keeps its switch, with a dev opt-out
// for the specs that still pin today's editor; main.jsx alone reads it and
// marks <html>, and markup asks lib/looks.js, which reads the mark. Plus the
// helpers every bar uses: a shortcut's keys as caps, and a control's tooltip.
//
//   node --test src/lib/looks.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as looks from './looks.js';
import { keyCaps, shortcutAria, shortcutCaps, tlTip, docLook } from './looks.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(path.join(here, '..', p), 'utf8');
const holdBody = (name) => read('lib/appHost.js').match(new RegExp(`export function ${name}\\(\\)\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] || '';

test('docLookAllowed is on everywhere, and on dev unless the hold says \'0\'', () => {
  const body = holdBody('docLookAllowed');
  assert.match(body, /^\s*if \(!import\.meta\.env\.DEV\) return true;\n/);
  // A storage that throws (a private window) leaves it on as well.
  assert.match(body, /localStorage\.getItem\(DOC_LOOK_DEV_FLAG\) !== '0'; \} catch \(_\) \{ return true; \}/);
  assert.doesNotMatch(body, /onPreviewHost|return false/);
  assert.match(read('lib/appHost.js'), /^\s*docLook: docLookAllowed,$/m);
});

// The toolbar look's hold stays, as every lifted hold does, so session_context
// keeps saying which look a session had; there is no other to switch to.
test('the toolbar look\'s hold is lifted for good', () => {
  assert.equal(holdBody('toolbarLookAllowed').trim(), 'return true;');
  assert.match(read('lib/appHost.js'), /^\s*toolbarLook: toolbarLookAllowed,$/m);
  assert.doesNotMatch(read('lib/appHost.js'), /TOOLBAR_LOOK_DEV_FLAG|soleil\.dev\.toolbarLook/);
});

test('main.jsx marks <html> before anything renders: the toolbar look always, the doc look from its switch', () => {
  const main = read('main.jsx');
  assert.match(main, /^  document\.documentElement\.dataset\.tb = 'a';$/m);
  assert.match(main, /if \(docLookAllowed\(\)\) document\.documentElement\.dataset\.docLook = 'a';/);
  assert.doesNotMatch(main, /toolbarLookAllowed/);
  assert.ok(main.indexOf("dataset.tb = 'a'") < main.indexOf('createRoot('), 'marked before the first render');
});

// The bars wear the toolbar look from styles/toolbarLook.css, a file of its
// own that main.jsx fetches as it starts: never in the entry's CSS, which
// every page waits for (the landing too, which has no bars).
test('main.jsx alone loads toolbarLook.css, and not in the entry', () => {
  const main = read('main.jsx');
  assert.match(main, /^  import\('\.\/styles\/toolbarLook\.css'\)\.catch\(\(\) => \{\}\);$/m);
  const statics = [];
  const walk = (dir) => {
    for (const e of readdirSync(path.join(here, '..', dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) walk(rel);
      else if (/\.(jsx?|mjs|css)$/.test(e.name) && /^\s*(import|@import)\s[^;]*toolbarLook\.css/m.test(read(rel))) statics.push(rel);
    }
  };
  walk('.');
  assert.deepEqual(statics, []);
});

test('only main.jsx asks the switches', () => {
  for (const f of ['App.jsx', 'components/CanvasSurface.jsx', 'components/ToolOptionsBar.jsx', 'components/DocToolbar.jsx', 'components/DocSurface.jsx']) {
    assert.doesNotMatch(read(f), /toolbarLookAllowed|docLookAllowed/, `${f} asks a switch; ask lib/looks.js`);
  }
});

test('with no document, the doc look is off', () => {
  assert.equal(docLook(), false);
});

// The bars before the toolbar look are gone: nothing asks which look they
// wear, and nothing can ask for the old one back.
test('the bars have one look: nothing asks which', () => {
  assert.equal(looks.toolbarLook, undefined);
  assert.equal(looks.tip, undefined);
  const askers = [];
  const walk = (dir) => {
    for (const e of readdirSync(path.join(here, '..', dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) walk(rel);
      else if (/\.(jsx?|mjs)$/.test(e.name) && !/\.test\.mjs$/.test(e.name)
        && /\btoolbarLook\(\)|soleil\.dev\.toolbarLook/.test(read(rel))) askers.push(rel);
    }
  };
  walk('.');
  assert.deepEqual(askers, []);
});

test('a shortcut as caps, a Mac\'s symbols or the words elsewhere', () => {
  assert.deepEqual(keyCaps('Mod+B', true), ['⌘', 'B']);
  assert.deepEqual(keyCaps('Mod+B', false), ['Ctrl', 'B']);
  assert.deepEqual(keyCaps('Mod+Shift+Z', true), ['⌘', '⇧', 'Z']);
  assert.deepEqual(keyCaps('Mod+Shift+Z', false), ['Ctrl', 'Shift', 'Z']);
  assert.deepEqual(keyCaps('Mod+Alt+M', true), ['⌘', '⌥', 'M']);
  assert.deepEqual(keyCaps('Mod+Alt+M', false), ['Ctrl', 'Alt', 'M']);
  assert.deepEqual(keyCaps('Mod+\\', true), ['⌘', '\\']);
  assert.deepEqual(keyCaps('d', true), ['D']);
  assert.deepEqual(keyCaps('Mod+=', true), ['⌘', '+']);
  assert.deepEqual(keyCaps('Mod+-', false), ['Ctrl', '−']);
  assert.deepEqual(keyCaps('Escape', true), ['Esc']);
  assert.deepEqual(keyCaps('Alt+F10', false), ['Alt', 'F10']);
  // Several shortcuts: the first is the one a tooltip shows.
  assert.deepEqual(keyCaps('Mod+Shift+Z Mod+Y', false), ['Ctrl', 'Shift', 'Z']);
  assert.deepEqual(keyCaps('', true), []);
  assert.deepEqual(keyCaps(null, true), []);
});

// The right-click menus write a row's shortcut for the eye, as the platform
// does ("⌘D", "Ctrl+D", "⌫"): in the look it's a cap per key, and the row's
// aria-keyshortcuts says it to a screen reader instead of its name.
test('a menu row\'s written shortcut as caps, one a key', () => {
  assert.deepEqual(shortcutCaps('⌘D'), ['⌘', 'D']);
  assert.deepEqual(shortcutCaps('⌘⇧D'), ['⌘', '⇧', 'D']);
  assert.deepEqual(shortcutCaps('Ctrl+D'), ['Ctrl', 'D']);
  assert.deepEqual(shortcutCaps('Ctrl+Shift+D'), ['Ctrl', 'Shift', 'D']);
  assert.deepEqual(shortcutCaps('⌘0'), ['⌘', '0']);
  assert.deepEqual(shortcutCaps('Ctrl++'), ['Ctrl', '+']);
  assert.deepEqual(shortcutCaps('⌘+'), ['⌘', '+']);
  assert.deepEqual(shortcutCaps('⌫'), ['⌫']);
  assert.deepEqual(shortcutCaps('F2'), ['F2']);
  assert.deepEqual(shortcutCaps('Space'), ['Space']);
  assert.deepEqual(shortcutCaps(''), []);
  assert.deepEqual(shortcutCaps(null), []);
});

test('…and in aria-keyshortcuts\' words', () => {
  assert.equal(shortcutAria('⌘D'), 'Meta+D');
  assert.equal(shortcutAria('⌘⇧D'), 'Meta+Shift+D');
  assert.equal(shortcutAria('⌥⌘M'), 'Alt+Meta+M');
  assert.equal(shortcutAria('Ctrl+D'), 'Control+D');
  assert.equal(shortcutAria('Ctrl+Shift+D'), 'Control+Shift+D');
  assert.equal(shortcutAria('⌘+'), 'Meta++');
  assert.equal(shortcutAria('⌫'), 'Backspace');
  assert.equal(shortcutAria('⌦'), 'Delete');
  assert.equal(shortcutAria('Del'), 'Delete');
  assert.equal(shortcutAria('Esc'), 'Escape');
  assert.equal(shortcutAria('↩'), 'Enter');
  assert.equal(shortcutAria('F2'), 'F2');
  assert.equal(shortcutAria('Space'), 'Space');
  assert.equal(shortcutAria(''), '');
});

test('a control\'s tooltip is the host\'s, words and keys', () => {
  assert.deepEqual(tlTip('Bold', 'Mod+B'), { 'data-tl-tip': 'Bold', 'data-tl-keys': 'Mod+B' });
  assert.deepEqual(tlTip('Pen'), { 'data-tl-tip': 'Pen' });
  assert.deepEqual(tlTip('Pen', null), { 'data-tl-tip': 'Pen' });
  assert.deepEqual(tlTip('Pen', 'p', 'right'), { 'data-tl-tip': 'Pen', 'data-tl-keys': 'p', 'data-tl-tip-side': 'right' });
});
