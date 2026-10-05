// homeWorkspaceHeader.test.mjs — the workspace at the top of Home: switching
// from it stays on Home, a new workspace made from it opens on Home, the
// sidebar's switcher still takes you to work, and the menu stays on screen.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HOME_AFTER_SWITCH_KEY, markHomeAfterSwitch, homeAfterSwitchFor, clearHomeAfterSwitch,
} from './homeAfterSwitch.js';
import { workspaceMenuPlacement } from './projectsHome.js';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(resolve(SRC, rel), 'utf8');
const mem = () => {
  const m = new Map();
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

test('the note is for one workspace, survives being read twice, and is cleared once used', () => {
  const s = mem();
  assert.equal(markHomeAfterSwitch('ws-b', s), true);
  assert.equal(homeAfterSwitchFor('ws-b', s), true);
  assert.equal(homeAfterSwitchFor('ws-b', s), true, 'StrictMode runs initializers twice — a read must not consume it');
  assert.equal(homeAfterSwitchFor('ws-a', s), false, 'a mount of some other workspace is not sent to Home');
  clearHomeAfterSwitch(s);
  assert.equal(s.m.has(HOME_AFTER_SWITCH_KEY), false);
  assert.equal(homeAfterSwitchFor('ws-b', s), false);
  assert.equal(markHomeAfterSwitch(null, s), false);
  assert.equal(homeAfterSwitchFor(null, s), false);
  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } };
  assert.equal(markHomeAfterSwitch('ws-b', broken), false);
  assert.equal(homeAfterSwitchFor('ws-b', broken), false);
  assert.doesNotThrow(() => clearHomeAfterSwitch(broken));
});

test('the menu sits under the trigger and never runs off screen', () => {
  const desk = workspaceMenuPlacement({ left: 400, bottom: 120, width: 260 }, { width: 1440 });
  assert.deepEqual(desk, { top: 126, left: 400, width: 320 });
  const nearRight = workspaceMenuPlacement({ left: 1300, bottom: 80 }, { width: 1440 });
  assert.equal(nearRight.left + nearRight.width <= 1440 - 8, true);
  const phone = workspaceMenuPlacement({ left: 16, bottom: 90 }, { width: 375 });
  assert.equal(phone.width, 320);
  assert.equal(phone.left >= 8 && phone.left + phone.width <= 375 - 8, true);
  const tiny = workspaceMenuPlacement({ left: 16, bottom: 90 }, { width: 240 });
  assert.equal(tiny.width, 224);
  assert.equal(tiny.left, 8);
});

test('Home renders the workspace header in its panel, with its own trigger for the shared menu', () => {
  const home = read('components/ProjectsHome.jsx');
  const panel = home.slice(home.indexOf('<section className="ph-panel surface-frosted"'));
  assert.ok(panel.indexOf('<WorkspaceHeader') > 0 && panel.indexOf('<WorkspaceHeader') < panel.indexOf('Jump back in'),
    'the workspace comes first — above the projects it holds');
  assert.match(home, /createPortal\(\s*<div className="ph-ws-pop"/, 'portalled: the panel scrolls and would clip it');
  assert.match(home, /triggerSelector="\.ph-ws-trigger"/);
  assert.match(home, /onSelect=\{\(id\) => \{ if \(id !== workspace\.id\) onSwitch\?\.\(id\); \}\}/,
    'picking the workspace you are in only closes the menu');
  assert.match(home, /New workspace/);
  const menu = read('components/WorkspaceMenu.jsx');
  assert.match(menu, /triggerSelector = '\.sb-ws-trigger',/, 'the sidebar keeps its own guard by default');
  assert.match(menu, /if \(triggerSelector && e\.target\.closest\?\.\(triggerSelector\)\) return;/);
});

test('App: Home\'s switcher lands on Home; the sidebar\'s still goes to the canvas', () => {
  const app = read('App.jsx');
  const home = app.slice(app.indexOf('<ProjectsHome'), app.indexOf('graph={mobileShell ? null : ('));
  assert.match(home, /onSwitchWorkspace=\{\(id\) => \{\s*if \(!id \|\| id === workspace\.id\) return;[\s\S]*?markHomeAfterSwitch\(id\);\s*onSwitchWorkspace\(id\);/,
    'noted BEFORE the switch — the switch remounts everything');
  assert.match(home, /onNewWorkspace=\{\(\) => \{[\s\S]*?addNewWorkspace\(\{ thenHome: true \}\);/);
  assert.match(app, /useState\(\(\) => \(homeAfterSwitchFor\(workspace\.id\) \? 'home' : 'board'\)\);\s*useEffect\(\(\) => \{ clearHomeAfterSwitch\(\); \}, \[\]\);/);
  assert.match(app, /const addNewWorkspace = async \(\{ thenHome = false \} = \{\}\) => \{/);
  assert.match(app, /if \(thenHome === true\) markHomeAfterSwitch\(ws\.id\);\s*onSwitchWorkspace\?\.\(ws\.id\);/);
  assert.match(app, /onSelect=\{\(id\) => \{ onSwitchWorkspace\(id\); setCurrentSurface\('board'\); \}\}/,
    'the sidebar switcher is unchanged: it takes you to work');
});
