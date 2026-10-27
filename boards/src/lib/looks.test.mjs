// looks.test.mjs — the bars and the doc editor have one look each: the
// toolbar look (the owner's pick of 2026-10-21, shipped 2026-10-25) and the
// doc look (shipped 2026-10-24). main.jsx marks <html data-tb="a"
// data-doc-look="a"> without asking, and nothing asks which look either
// wears. Plus the helpers every bar uses: a shortcut's keys as caps, and a
// control's tooltip.
//
//   node --test src/lib/looks.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as looks from './looks.js';
import { keyCaps, shortcutAria, shortcutCaps, tlTip } from './looks.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(path.join(here, '..', p), 'utf8');
const holdBody = (name) => read('lib/appHost.js').match(new RegExp(`export function ${name}\\(\\)\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] || '';

// The holds stay, as every lifted hold does, so session_context keeps saying
// which look a session had; there is no other to switch to.
test('the doc look\'s hold is lifted for good', () => {
  assert.equal(holdBody('docLookAllowed').trim(), 'return true;');
  assert.match(read('lib/appHost.js'), /^\s*docLook: docLookAllowed,$/m);
  assert.doesNotMatch(read('lib/appHost.js'), /DOC_LOOK_DEV_FLAG|soleil\.dev\.docLook/);
});

test('the toolbar look\'s hold is lifted for good', () => {
  assert.equal(holdBody('toolbarLookAllowed').trim(), 'return true;');
  assert.match(read('lib/appHost.js'), /^\s*toolbarLook: toolbarLookAllowed,$/m);
  assert.doesNotMatch(read('lib/appHost.js'), /TOOLBAR_LOOK_DEV_FLAG|soleil\.dev\.toolbarLook/);
});

test('main.jsx marks <html> with both looks before anything renders, asking nothing', () => {
  const main = read('main.jsx');
  assert.match(main, /^  document\.documentElement\.dataset\.tb = 'a';$/m);
  assert.match(main, /^  document\.documentElement\.dataset\.docLook = 'a';$/m);
  assert.doesNotMatch(main, /toolbarLookAllowed|docLookAllowed/);
  for (const mark of ["dataset.tb = 'a'", "dataset.docLook = 'a'"]) {
    assert.ok(main.indexOf(mark) < main.indexOf('createRoot('), `${mark}: marked before the first render`);
  }
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

// The bars before the toolbar look and the doc editor before the doc look are
// gone from the clusters: nothing asks which look they wear, and nothing can
// ask for the old one back.
test('the bars and the docs have one look each: nothing asks which', () => {
  assert.equal(looks.toolbarLook, undefined);
  assert.equal(looks.tip, undefined);
  assert.equal(looks.docLook, undefined);
  const askers = [];
  const walk = (dir) => {
    for (const e of readdirSync(path.join(here, '..', dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) walk(rel);
      else if (/\.(jsx?|mjs)$/.test(e.name) && !/\.test\.mjs$/.test(e.name)
        && /\btoolbarLook\(\)|soleil\.dev\.toolbarLook|\bdocLook\(\)|soleil\.dev\.docLook/.test(read(rel))) askers.push(rel);
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
