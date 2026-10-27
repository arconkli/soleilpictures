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
test('both pricing pages pass the Team card, open everywhere since the launch', () => {
  const pub = read('auth/PublicPricingPage.jsx');
  assert.ok(pub.includes('on: teamPricingAllowed(),'));
  assert.ok(pub.includes('teamCard={teamCard}'));
  assert.equal((pub.match(/teamCard=/g) || []).length, 1);
  const page = read('auth/PricingPage.jsx');
  assert.ok(page.includes('on: teamPricingAllowed() || (teamPreviewAvailable() && !!readTeamPreview()),'));
  assert.ok(page.includes('teamCard={teamCard}'));
  assert.equal((page.match(/teamCard=/g) || []).length, 1);
  // Lifted with the launch, as every lifted hold is: `return true;`.
  const host = read('lib/appHost.js');
  for (const fn of ['teamPricingAllowed', 'teamsAllowed', 'editorLimitAllowed']) {
    assert.match(host, new RegExp(`export function ${fn}\\(\\) \\{\\n  return true;\\n\\}`), fn);
  }
  // Each records what came of it (featureEvents.js, the presses in the hook).
  const hook = read('auth/useTeamPricingCard.js');
  assert.ok(hook.includes('logEventNow(EV.PRICING_TEAM_START, { surface, plan, seats }); onStart(seats);'));
  assert.ok(hook.includes('logEventNow(EV.PRICING_TEAM_TALK, { surface });'));
  assert.ok(pub.includes("surface: SURFACE,") && page.includes("surface: 'page',"));
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

test('the Team card stays lazy, and the team model stays a leaf', () => {
  // The answer paragraph names Team's price (pricingCrawlable), so the pricing
  // pages carry the model's money(); the card itself still loads on demand.
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

test('the crawlable pricing takes Team\'s price from the team model, never typed', () => {
  const crawl = read('lib/pricingCrawlable.js');
  assert.ok(crawl.includes("import { TEAM_SEAT_MIN, TEAM_SEAT_MAX, TEAM_SEAT_PRICE, money, teamHeroLine } from './teamModel.js';"));
  assert.ok(crawl.includes("import { teamCardCopy, teamBenefits, teamComparison } from './teamPricingCopy.js';"));
  // No price typed in either (the '$1' in emph's replacement is a regex group).
  for (const f of ['lib/pricingCrawlable.js', 'lib/teamPricingCopy.js']) {
    const code = read(f).replace(/\/\/[^\n]*/g, '').replace("'<b>$1</b>'", '');
    assert.doesNotMatch(code, /\$\d|\b(15|25|144|240)\b/, f);
  }
  // billingCopy is Creator's: Team's price lives in the team model alone.
  assert.doesNotMatch(read('lib/billingCopy.js'), /a seat/);
});

test('Talk to us is its own page: the card links it, the router serves it before AuthGate, the Worker titles it', () => {
  const copy = read('lib/teamPricingCopy.js');
  assert.ok(copy.includes("export const TEAM_TALK_PATH = '/pricing/talk-to-us';"));
  assert.ok(copy.includes('talkHref: TEAM_TALK_PATH,'));
  const card = read('components/team/TeamPlanCard.jsx');
  assert.ok(card.includes('<a className="pp-talk-link" href={c.talkHref} onClick={onTalk}>{c.talkLink}</a>'));
  assert.doesNotMatch(card, /pp-talk-note|Preview: this opens/);
  const main = read('main.jsx');
  assert.ok(main.includes("const talkToUsMatch = /^\\/pricing\\/talk-to-us\\/?$/i.test(window.location.pathname);"));
  // Before the signed-out pricing page and AuthGate, so a session never walls it.
  const at = (s) => main.indexOf(s);
  assert.ok(at(') : talkToUsMatch ? (') > 0 && at(') : talkToUsMatch ? (') < at(') : showPublicPricing ? ('));
  assert.ok(at(') : talkToUsMatch ? (') < at('<AuthGate signedOut='));
  assert.match(main, /darkPublicRoute = [^;]*talkToUsMatch/);
  // A literal ROUTE_META key, so the docs gate sees the route; the words are the copy module's.
  const worker = read('worker.js');
  assert.match(worker, /'\/pricing\/talk-to-us': \{\n    title: TEAM_TALK_META\.title,\n    description: TEAM_TALK_META\.description,\n  \},/);
  // The page sends through teamContact.js and logs no name, email or company.
  const page = read('auth/TalkToUsPage.jsx');
  assert.ok(page.includes('sendTeamContact(supabase, checked.request)'));
  for (const ev of page.match(/logEvent(?:Now|Once)?\([^)]*\)/g) || []) {
    assert.doesNotMatch(ev, /p_name|p_email|p_company|form\.(name|email|company)/, ev);
  }
});
