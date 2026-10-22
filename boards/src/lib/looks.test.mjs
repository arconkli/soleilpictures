// looks.test.mjs — the toolbar look and the doc editor's look (the owner's
// picks of 2026-10-21) each have one switch, held to a dev opt-in while they
// are built; main.jsx alone reads the switches and marks <html>, and markup
// asks lib/looks.js, which reads the marks. Plus the two helpers every bar in
// the new look uses: a shortcut's keys as caps, and a control's tooltip.
//
//   node --test src/lib/looks.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { keyCaps, tip, tlTip, toolbarLook, docLook } from './looks.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(path.join(here, '..', p), 'utf8');
const holdBody = (name) => read('lib/appHost.js').match(new RegExp(`export function ${name}\\(\\)\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] || '';

for (const [fn, flag, key, preview] of [
  ['toolbarLookAllowed', 'TOOLBAR_LOOK_DEV_FLAG', 'toolbarLook', false],
  ['docLookAllowed', 'DOC_LOOK_DEV_FLAG', 'docLook', true],
]) {
  test(`${fn} is ${preview ? 'open on the preview, ' : ''}closed on production, and opt-in on dev`, () => {
    const body = holdBody(fn);
    assert.match(body, /if \(!import\.meta\.env\.DEV\) return false;/);
    assert.match(body, new RegExp(`localStorage\\.getItem\\(${flag}\\) === '1'`));
    // On the preview once the owner can try it, ahead of everything else.
    if (preview) assert.match(body, /^\s*if \(onPreviewHost\(\)\) return true;\n\s*if \(!import\.meta\.env\.DEV\) return false;/);
    else assert.doesNotMatch(body, /onPreviewHost/);
    assert.match(read('lib/appHost.js'), new RegExp(`^\\s*${key}: ${fn},$`, 'm'));
  });
}

test('main.jsx marks <html> from the switches, before anything renders', () => {
  const main = read('main.jsx');
  assert.match(main, /if \(toolbarLookAllowed\(\)\) document\.documentElement\.dataset\.tb = 'a';/);
  assert.match(main, /if \(docLookAllowed\(\)\) document\.documentElement\.dataset\.docLook = 'a';/);
  assert.ok(main.indexOf("dataset.tb = 'a'") < main.indexOf('createRoot('), 'marked before the first render');
});

// The bars the app already has wear the toolbar look from styles/toolbarLook.css,
// a file of its own that only the look loads: never in the entry's CSS, so the
// held look costs today's look nothing.
test('main.jsx alone loads toolbarLook.css, and only under the look', () => {
  const main = read('main.jsx');
  assert.match(main, /if \(toolbarLookAllowed\(\)\) import\('\.\/styles\/toolbarLook\.css'\)/);
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

test('with no document, neither look is on', () => {
  assert.equal(toolbarLook(), false);
  assert.equal(docLook(), false);
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

test('a tooltip in the new look is the host\'s, words and keys', () => {
  assert.deepEqual(tlTip('Bold', 'Mod+B'), { 'data-tl-tip': 'Bold', 'data-tl-keys': 'Mod+B' });
  assert.deepEqual(tlTip('Pen'), { 'data-tl-tip': 'Pen' });
  assert.deepEqual(tlTip('Pen', 'p', 'right'), { 'data-tl-tip': 'Pen', 'data-tl-keys': 'p', 'data-tl-tip-side': 'right' });
  assert.deepEqual(tip('Bold', 'Mod+B', 'Bold (⌘B)', true), { 'data-tl-tip': 'Bold', 'data-tl-keys': 'Mod+B' });
});

test('in the look before it, the control keeps the title it had', () => {
  assert.deepEqual(tip('Bold', 'Mod+B', 'Bold (⌘B)', false), { title: 'Bold (⌘B)' });
  assert.deepEqual(tip('Strike', null, undefined, false), { title: 'Strike' });
  assert.deepEqual(tip('Strike', null, null, false), {});
});
