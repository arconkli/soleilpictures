// teamPreviewWiring.test.mjs — the Team page preview stays an admin-only,
// look-only door: App builds the test team only for admins, loads the page
// lazily, the workspace menu shows the team only from its prop, Settings ›
// Preview writes the choice, and nothing else makes a sample team.
//
//   node --test src/lib/teamPreviewWiring.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, '..');
const read = (p) => readFileSync(path.join(src, p), 'utf8');

test('App builds the test team only for admins, from a chunk of its own', () => {
  const app = read('App.jsx');
  assert.ok(app.includes("if (!captureAllowed || !teamAs) { setTeam(null); return undefined; }"));
  assert.ok(app.includes("import('./lib/teamSample.js').then((m) => { if (live) setTeam(m.sampleTeam(teamAs)); }, () => {});"));
  assert.doesNotMatch(app, /^import[^\n]*lib\/team(Sample|Model)\.js/m);
});

test('App lazy-loads the Team page and never imports it statically', () => {
  const app = read('App.jsx');
  assert.ok(app.includes("lazyWithReload(() => import('./components/team/TeamPage.jsx'))"));
  assert.doesNotMatch(app, /^import[^\n]*components\/team\/TeamPage/m);
});

test('the workspace menu renders the team section only from its team prop', () => {
  const menu = read('components/WorkspaceMenu.jsx');
  assert.match(menu, /team = null,/);
  assert.match(menu, /\{team && !q && \(/);
  assert.doesNotMatch(menu, /sampleTeam|teamPreview/);
});

test('Settings passes its close to Preview, and Preview writes the choice', () => {
  assert.ok(read('components/SettingsPanel.jsx').includes('<PreviewTab onClose={onClose} />'));
  assert.ok(read('components/settings/PreviewTab.jsx').includes('writeTeamPreview('));
});

test('only the sample, the model, App, the probe and the page mention sampleTeam(', () => {
  const allowed = (rel) => /^(lib\/teamSample(\.test\.mjs|\.js)|lib\/teamModel(\.test)?\.mjs|lib\/teamPreviewWiring\.test\.mjs|App\.jsx|local\/teamProbe\.js|components\/team\/.*)$/.test(rel);
  const bad = [];
  for (const rel of readdirSync(src, { recursive: true })) {
    const r = String(rel).split(path.sep).join('/');
    if (!/\.(jsx?|mjs)$/.test(r) || allowed(r)) continue;
    const full = path.join(src, r);
    if (!statSync(full).isFile()) continue;
    if (readFileSync(full, 'utf8').includes('sampleTeam(')) bad.push(r);
  }
  assert.deepEqual(bad, []);
});
