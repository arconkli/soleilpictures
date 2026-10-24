// Source pins for split view's button in the floating islands. The islands
// first put split view behind ⋯, which left the docs' "⧉ Pin alongside button
// in the topbar" (docs/clusters#side-by-side) pointing at nothing; with a mouse
// it is one press from the right island again, and under a finger it waits in
// ⋯ with the theme. Reads source text only (App imports JSX and CSS, which
// node --test cannot load).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const app = src('../App.jsx');

// The right island: from `right={(` to its menuItems; then the ⋯ items.
const at = app.indexOf('right={(\n              <>');
const island = app.slice(at, app.indexOf('menuItems={[', at));
const menu = app.slice(app.indexOf('menuItems={[', at), app.indexOf("{ id: 'help', label: 'Help & feedback'", at));

test('with a mouse, split view is a button in the right island, before the theme switch', () => {
  assert.ok(at > 0, 'the right island is found');
  assert.match(island, /\{!isTouch \? \(\s*<>\s*<button className=\{`tb-icon tb-icon-split\$\{splitId \? ' is-pressed' : ''\}`\}/);
  assert.match(island, /aria-label="Split view" aria-pressed=\{!!splitId\}/);
  assert.match(island, /<Icon as=\{Columns2\} size=\{16\} \/>\s*<\/button>\s*<button className="tb-icon tb-icon-theme"/);
});

test('it pins a cluster alongside, or closes the split that is open', () => {
  // Its tip is lib/looks.js's: today's title, or the toolbar look's glass one.
  assert.match(island, /\{\.\.\.lookTip\(splitId \? 'Close split view' : 'Pin alongside…'\)\}/);
  assert.match(island, /onClick=\{\(\) => \(splitId \? setSplitId\(null\) : setSplitPickerOpen\(true\)\)\}/);
});

test('⋯ carries split view only under a finger', () => {
  assert.equal((menu.match(/id: 'split'/g) || []).length, 2);
  assert.match(menu, /\.\.\.\(isTouch \? \[\s*splitId\s*\? \{ id: 'split', label: 'Close split view'[\s\S]*?: \{ id: 'split', label: 'Pin a cluster alongside…'/);
});

test('pressed, it wears the bell\'s chip: ink, never gold', () => {
  const css = src('../components/chrome/floatingChrome.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = css.split('}').filter((r) => r.includes('tb-icon-split.is-pressed'));
  assert.equal(rules.length, 2);
  for (const r of rules) assert.doesNotMatch(r, /--soleil/);
});
