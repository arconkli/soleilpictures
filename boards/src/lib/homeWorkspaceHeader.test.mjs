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
  SETTINGS_AFTER_SWITCH_KEY, markSettingsAfterSwitch, settingsAfterSwitchFor, clearSettingsAfterSwitch,
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
  assert.match(home, /createPortal\(\s*<div ref=\{popRef\} className="ph-ws-pop"/, 'portalled: the panel scrolls and would clip it');
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
  assert.match(app, /const \[arrivedOnHome\] = useState\(\(\) => homeAfterSwitchFor\(workspace\.id\)\);/);
  assert.match(app, /useState\(\(\) => \(arrivedOnHome \? 'home' : 'board'\)\);\s*useEffect\(\(\) => \{ clearHomeAfterSwitch\(\); clearSettingsAfterSwitch\(\); \}, \[\]\);/);
  assert.match(app, /const addNewWorkspace = async \(\{ thenHome = false \} = \{\}\) => \{/);
  assert.match(app, /if \(thenHome === true\) markHomeAfterSwitch\(ws\.id\);\s*onSwitchWorkspace\?\.\(ws\.id\);/);
  assert.match(app, /onSelect=\{\(id\) => \{ onSwitchWorkspace\(id\); setCurrentSurface\('board'\); \}\}/,
    'the sidebar switcher is unchanged: it takes you to work');
});

test('a Settings note opens Settings in the workspace switched to, on its tab, and only there', () => {
  const s = mem();
  assert.equal(markSettingsAfterSwitch('ws-b', 'general', s), true);
  assert.equal(settingsAfterSwitchFor('ws-b', s), 'general');
  assert.equal(settingsAfterSwitchFor('ws-b', s), 'general', 'reads only — StrictMode-safe');
  assert.equal(settingsAfterSwitchFor('ws-a', s), null);
  clearSettingsAfterSwitch(s);
  assert.equal(s.m.has(SETTINGS_AFTER_SWITCH_KEY), false);
  s.m.set(SETTINGS_AFTER_SWITCH_KEY, '{not json');
  assert.equal(settingsAfterSwitchFor('ws-b', s), null);
});

test('App: Rename & icon on another workspace opens Settings in the NEW mount; removing yours from Home stays on Home', () => {
  const app = read('App.jsx');
  assert.match(app, /const \[settingsOpen, setSettingsOpen\] = useState\(\(\) => !!settingsAfterSwitchFor\(workspace\.id\)\);/);
  assert.match(app, /const \[settingsTab, setSettingsTab\] = useState\(\(\) => settingsAfterSwitchFor\(workspace\.id\)\);/);
  const ows = app.slice(app.indexOf('const openWorkspaceSettings = (ws, { thenHome = false } = {}) => {'));
  assert.match(ows.slice(0, 500), /if \(ws\?\.id && ws\.id !== workspace\?\.id\) \{\s*markSettingsAfterSwitch\(ws\.id, 'general'\);\s*if \(thenHome === true\) markHomeAfterSwitch\(ws\.id\);\s*onSwitchWorkspace\?\.\(ws\.id\);\s*return;\s*\}\s*openSettings\('general'\);/,
    'never openSettings on the instance the switch is about to throw away');
  const rw = app.slice(app.indexOf('const removeWorkspace = async (ws, kind'));
  const okAt = rw.indexOf('if (!ok) return;');
  const markAt = rw.indexOf('if (thenHome === true) markHomeAfterSwitch(personalWorkspaceId);');
  assert.ok(okAt > 0 && markAt > okAt && markAt < rw.indexOf('onSwitchWorkspace?.(personalWorkspaceId);'),
    'noted only after the confirm and a removal that succeeded');
  assert.match(app, /onRemoveWorkspace=\{\(ws, action\) => removeWorkspace\(ws, action, \{ thenHome: true \}\)\}/);
  assert.match(app, /onOpenWorkspaceSettings=\{\(ws\) => openWorkspaceSettings\(ws, \{ thenHome: true \}\)\}/);
  // The sidebar keeps its own behaviour (to the canvas), now with Settings that actually open.
  assert.match(app, /onOpenSettings=\{\(ws\) => openWorkspaceSettings\(ws\)\}/);
});

test('App: a Home arrival is not a canvas landing, and HOME_VIEW waits for the projects it counts', () => {
  const app = read('App.jsx');
  const landing = app.slice(app.indexOf('const landingFallbackRef = useRef(false);'));
  assert.match(landing.slice(0, 900), /landingFallbackRef\.current = true;[\s\S]*?if \(arrivedOnHome\) return;/);
  assert.match(app, /if \(currentSurface !== 'home' \|\| boardsLoading\) return;/);
  assert.match(app, /\}, \[currentSurface, boardsLoading\]\);/);
  assert.match(app, /\.\.\.\(viaSwitch \? \{ via: 'switch' \} : \{\}\),/);
});

test('the menu: focus goes in and comes back, it follows its trigger, and the ⋯ shows on touch', () => {
  const home = read('components/ProjectsHome.jsx');
  assert.match(home, /\(pop\.querySelector\('\.ws-menu-row\.is-active'\) \|\| pop\.querySelector\('\.ws-menu-row'\)\)\?\.focus\(/);
  assert.match(home, /const inside = !!popRef\.current\?\.contains\(document\.activeElement\);\s*setPlace\(null\);\s*if \(inside\) triggerRef\.current\?\.focus\(/);
  assert.match(home, /onClose=\{closeMenu\}/);
  assert.match(home, /window\.addEventListener\('resize', follow\);/, 'a resize (the native keyboard) re-places, never closes');
  assert.doesNotMatch(home, /addEventListener\('resize', close\)/);
  assert.match(home, /setPlace\(\(p\) => \(p \? workspaceMenuPlacement\(rect, \{ width: window\.innerWidth \}\) : p\)\)/,
    'a late callback can never reopen a closed menu');
  assert.match(home, /new ResizeObserver\(follow\)/);
  assert.match(read('styles.css'), /@media \(hover: none\) \{ \.ws-menu-row-more \{ opacity: 1; \} \}/);
});
