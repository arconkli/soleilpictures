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
  assert.ok(app.includes("import('./lib/teamSample.js').then((m) => { if (live) setTeam(m.sampleTeam(teamAs, undefined, { name: readTeamPreviewName() })); }, () => {});"));
  assert.doesNotMatch(app, /^import[^\n]*lib\/team(Sample|Model)\.js/m);
});

test('the setup opens the page once, after the boot has landed, and only a later move closes it', () => {
  const app = read('App.jsx');
  // Batched with the landing fallback's setStack, so the page opens on the cluster the boot settled on.
  assert.ok(app.includes('useEffect(() => { if (!boardsLoading && boardsReady) setTeamLanded(true); }, [boardsLoading, boardsReady]);'));
  assert.ok(app.includes('useEffect(() => { if (team && teamLanded && consumeTeamPageOnBoot()) openTeamPage(); }, [team, teamLanded]);'));
  assert.ok(app.includes("else if (teamOpenedAt.current !== place) closeTeamPage();"));
  // The old "close on any move" effect fired on the boot's own landing.
  assert.ok(!app.includes('useEffect(() => { closeTeamPage(); }, [currentId, currentSurface]);'));
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

// ── The buying walk-through (Team card on /pricing, /team/new) ───────────────
test('both pricing pages pass the Team card only while Team is open here', () => {
  const pub = read('auth/PublicPricingPage.jsx');
  assert.ok(pub.includes('on: teamPricingAllowed(),'));
  assert.ok(pub.includes('teamCard={teamCard}'));
  assert.equal((pub.match(/teamCard=/g) || []).length, 1);
  const page = read('auth/PricingPage.jsx');
  assert.ok(page.includes('on: teamPricingAllowed() || (teamPreviewAvailable() && !!readTeamPreview()),'));
  assert.ok(page.includes('teamCard={teamCard}'));
  assert.equal((page.match(/teamCard=/g) || []).length, 1);
  // Team's own hold off dev (the preview host now, production at launch).
  assert.match(read('lib/appHost.js'), /export function teamPricingAllowed\(\) \{\n  if \(!import\.meta\.env\.DEV\) return teamsAllowed\(\);/);
});

test('a signed-out Team start opens the setup after sign-in, only while Team is open', () => {
  const gate = read('auth/AuthGate.jsx');
  assert.equal((gate.match(/if \(consumeTeamStart\(\)\) return;/g) || []).length, 2);
  assert.match(gate, /function consumeTeamStart\(\) \{[\s\S]*?if \(!teamsAllowed\(\)\) return false;\n  window\.location\.replace\(teamStartHref\(start\)\);/);
  // AuthGate is in the entry: the stash module carries nothing else.
  assert.doesNotMatch(read('lib/teamStart.js'), /^import /m);
});

test('PricingPageView lazy-imports the card and renders it only when teamCard is set', () => {
  const view = read('auth/PricingPageView.jsx');
  assert.ok(view.includes("lazy(() => import('../components/team/TeamPlanCard.jsx'))"));
  assert.doesNotMatch(view, /^import[^\n]*components\/team\/TeamPlanCard/m);
  assert.match(view, /\{teamCard && \(\s*<Suspense fallback=\{null\}>\s*<TeamPlanCard/);
  assert.ok(view.includes("teamCard = null,"));
});

test('the pricing pages never import the team model; the card loads it only while it shows', () => {
  // PricingPageView is the signed-out page too: a static import would ship the
  // team model to every visitor for one sentence.
  const view = read('auth/PricingPageView.jsx');
  assert.doesNotMatch(view, /lib\/teamModel/);
  assert.ok(view.includes('{teamCard?.heroLine && ` ${teamCard.heroLine}`}'));
  for (const f of ['auth/PricingPage.jsx', 'auth/PublicPricingPage.jsx', 'auth/useTeamPricingCard.js']) {
    assert.doesNotMatch(read(f), /^import[^\n]*lib\/teamModel/m, f);
  }
  const hook = read('auth/useTeamPricingCard.js');
  assert.ok(hook.includes("if (!on) return undefined;"));
  assert.ok(hook.includes("import('../lib/teamModel.js').then((m) => { if (live) setHeroLine(m.teamHeroLine(EDITOR_LIMIT)); }, () => {});"));
  // The model stays a leaf: an app import there would split that module out of the app chunk.
  assert.doesNotMatch(read('lib/teamModel.js'), /^import /m);
});

test('/team/new opens where Team does and lazy-loads TeamSetup', () => {
  const router = read('auth/TierRouter.jsx');
  assert.ok(router.includes("lazyWithReload(() => import('../components/team/TeamSetup.jsx'))"));
  assert.match(router, /path === '\/team\/new' && teamsAllowed\(\)/);
  assert.doesNotMatch(router, /^import[^\n]*components\/team\/TeamSetup/m);
});

test('the crawlable pricing and the pricing copy carry no Team price', () => {
  for (const f of ['lib/pricingCrawlable.js', 'lib/billingCopy.js']) {
    assert.doesNotMatch(read(f), /a seat|\$15\b|\b144\b/, f);
  }
});
