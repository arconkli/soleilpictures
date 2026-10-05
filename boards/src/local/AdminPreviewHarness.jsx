// Dev-only admin preview harness (?adminpreview=1 in a DEV build — see
// isAdminPreviewMode() in ../lib/localMode.js). Renders the REAL admin tab
// components with fixture data and no auth, inside a faithful replica of the
// admin chrome (same .admin-* classes the real AdminPage uses), so the admin UI
// can be screenshotted and iterated on visually. Dynamically imported only when
// the gate is on, so it never ships to production.
//
// Universe renders the REAL <UniverseGraph> over a synthetic corpus
// (see universeQaData.js) — no realtime, no auth, any node count via
// ?n=. This is the scale test bench: ?adminpreview=1&tab=universe&
// n=200000 drives the exact production pipeline (snapshot paging,
// worker layout, disc/halo/sphere rendering) at sizes the live
// corpus hasn't reached yet.

import { useState } from 'react';
// The harness renders the tab components directly rather than through
// AdminPage, so it has to pull the admin stylesheet in itself.
import '../pages/admin/admin.css';
import { supabase } from '../lib/supabase.js';
import { installAdminPreviewMocks } from './adminFixtures.js';
import { UniverseView } from '../pages/admin/AdminUniverseTab.jsx';
import { AdminCommandCenter } from '../pages/admin/AdminCommandCenter.jsx';
import { makeSyntheticDataSource } from './universeQaData.js';
import { SoleilWordmark } from '../components/SoleilWordmark.jsx';
import { AdminAnalyticsTab } from '../pages/admin/AdminAnalyticsTab.jsx';
import { AdminUsersTab } from '../pages/admin/AdminUsersTab.jsx';
import { AdminGrantsTab } from '../pages/admin/AdminGrantsTab.jsx';
import { AdminWaitlistTab } from '../pages/admin/AdminWaitlistTab.jsx';
import { AdminFeedbackTab } from '../pages/admin/AdminFeedbackTab.jsx';
import { AdminErrorsTab } from '../pages/admin/AdminErrorsTab.jsx';
import { AdminApiTab } from '../pages/admin/AdminApiTab.jsx';
import { AdminTaggingTab } from '../pages/admin/AdminTaggingTab.jsx';
import { AdminDiscoverTab } from '../pages/admin/AdminDiscoverTab.jsx';
import { FeedbackProvider } from '../components/AppFeedback.jsx';

// Install the fixture shim before any tab mounts + fetches.
const MOCKS_OK = installAdminPreviewMocks(supabase);

// ── AI channel fixtures (Discover tab) ───────────────────────────────
// Layered over the shared shim rather than added to adminFixtures.js, so the
// per-RPC call tally it keeps still counts these. Timestamps are RELATIVE to
// now on purpose: the probe banner judges the newest run's age (past 8 days =
// the weekly probe is not running), so a fixed date would silently flip this
// fixture from "every question failed" to "stale" a week after it was written.
// The state modelled is the one the panel exists to expose — a newest run
// where the provider refused every question and stored why.
const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();
const dayStr = (d) => daysAgo(d).slice(0, 10);
const AEO_QUESTIONS = [
  'best free moodboard app for filmmakers',
  'pureref alternative that works in the browser',
  'how to organise a shot list with a moodboard',
  'milanote vs pureref for film pre-production',
  'shared moodboard for a film crew',
  'moodboard tool with a script editor',
  'lookbook maker for a short film pitch',
  'visual references board for a director',
];
const AEO_CITED = [2, 1, 1, 1, 0, 0, 0, 0]; // over three runs; the newest cited nothing
const AEO_ERROR = 'insufficient_quota: You exceeded your current quota, please check your plan and billing details.';
const AEO_RUNS = [
  { run_at: daysAgo(2),  provider: 'openai', model: 'gpt-4o-search-preview', asked: 8, cited: 0, failed: 8 },
  { run_at: daysAgo(9),  provider: 'openai', model: 'gpt-4o-search-preview', asked: 8, cited: 3, failed: 0 },
  { run_at: daysAgo(16), provider: 'openai', model: 'gpt-4o-search-preview', asked: 8, cited: 2, failed: 0 },
];
const CRAWLER_BOTS = [
  { bot: 'GPTBot',        kind: 'ai',     hits: 212, paths: 38, last_seen: daysAgo(0.3) },
  { bot: 'Googlebot',     kind: 'search', hits: 184, paths: 61, last_seen: daysAgo(0.1) },
  { bot: 'ClaudeBot',     kind: 'ai',     hits: 97,  paths: 24, last_seen: daysAgo(1.2) },
  { bot: 'PerplexityBot', kind: 'ai',     hits: 41,  paths: 12, last_seen: daysAgo(2.5) },
  { bot: 'bingbot',       kind: 'search', hits: 36,  paths: 29, last_seen: daysAgo(0.8) },
  { bot: 'AhrefsBot',     kind: 'other',  hits: 19,  paths: 19, last_seen: daysAgo(4) },
];
const AI_CHANNEL_FIXTURES = {
  admin_ai_referrals: () => [
    { ref_host: 'chatgpt.com',           landing_path: '/',                       signups: 9, activated: 5 },
    { ref_host: 'utm:chatgpt.com',       landing_path: '/',                       signups: 7, activated: 3 },
    { ref_host: 'www.perplexity.ai',     landing_path: '/vs/pureref',             signups: 4, activated: 2 },
    { ref_host: 'gemini.google.com',     landing_path: '/best/mood-board-apps',    signups: 3, activated: 1 },
    { ref_host: 'chatgpt.com',           landing_path: '/vs/milanote',            signups: 2, activated: 1 },
    { ref_host: 'copilot.microsoft.com', landing_path: '/',                       signups: 1, activated: 0 },
  ],
  admin_aeo_retrieval: (params) => {
    const days = Number(params?.p_days) || 60;
    const from = daysAgo(days);
    const runs = AEO_RUNS.filter((r) => r.run_at >= from);
    const asked = runs.length;
    return {
      from,
      latest: AEO_QUESTIONS.map((question) => ({
        question, cited: false, position: null, sources: [], excerpt: null,
        error: AEO_ERROR, provider: 'openai', run_at: AEO_RUNS[0].run_at,
      })),
      by_question: AEO_QUESTIONS.map((question, i) => {
        // Only runs inside the window count, and the newest one cited nothing.
        const cited = Math.min(AEO_CITED[i], Math.max(0, asked - 1));
        return { question, provider: 'openai', asked, cited, cite_rate: asked ? Math.round((1000 * cited) / asked) / 10 : null };
      }),
      runs,
    };
  },
  admin_crawler_hits: (params) => {
    const days = Math.max(1, Math.min(Number(params?.p_days) || 30, 90));
    return {
      from: dayStr(days),
      by_bot: CRAWLER_BOTS,
      by_day: Array.from({ length: days }, (_, i) => {
        const back = days - 1 - i;
        return { day: dayStr(back), ai: 6 + ((i * 7) % 11), search: 4 + ((i * 5) % 7), other: i % 3 };
      }),
      top_ai_paths: [
        { path: '/vs/pureref',              hits: 64, bots: 3 },
        { path: '/',                        hits: 51, bots: 3 },
        { path: '/best/mood-board-apps',     hits: 38, bots: 2 },
        { path: '/docs/api',                hits: 27, bots: 2 },
        { path: '/vs/milanote',             hits: 22, bots: 3 },
        { path: '/llms.txt',                hits: 19, bots: 3 },
        { path: '/docs/cards',              hits: 14, bots: 1 },
        { path: '/changelog',               hits: 9,  bots: 2 },
      ],
    };
  },
};
function installAiChannelFixtures(client) {
  const base = client.rpc;
  client.rpc = (name, params) => {
    const r = base(name, params); // keeps the tally; answers null for these names
    if (!Object.prototype.hasOwnProperty.call(AI_CHANNEL_FIXTURES, name)) return r;
    return r.then(() => ({ data: AI_CHANNEL_FIXTURES[name](params), error: null }));
  };
}
if (MOCKS_OK) installAiChannelFixtures(supabase);

function readQaNodeTarget() {
  try {
    const n = parseInt(new URLSearchParams(window.location.search).get('n'), 10);
    if (Number.isFinite(n)) return Math.max(100, Math.min(n, 2_000_000));
  } catch (_) { /* ignore */ }
  return 20000;
}

// Optional ?w= pins the workspace count. The galaxy's whole structure
// lives at the workspace layer, so the default one-per-80-nodes ratio
// renders a corpus shaped nothing like production, where workspaces
// are far denser relative to cards. Misleading to judge the look on.
function readQaWsTarget() {
  try {
    const w = parseInt(new URLSearchParams(window.location.search).get('w'), 10);
    if (Number.isFinite(w)) return Math.max(3, Math.min(w, 100_000));
  } catch (_) { /* ignore */ }
  return 0;
}

// Synthetic counters shaped like admin_universe_stats. The real numbers arrive
// over SSE from PartyKit, which the harness has no server for — without this
// the HUD would render zeros and the ticker couldn't be reviewed at all.
const FIXTURE_UNIVERSE_STATS = {
  total_users: 1284, total_workspaces: 640, total_boards: 1810, total_cards: 18420,
  total_links: 2140, nodes_created_24h: 96, total_seconds_in_app: 40_000_000,
  today: { users: 7, workspaces: 4, boards: 12, cards: 138, tags: 22, links: 0 },
};

// The REAL <UniverseView>, over the synthetic corpus.
//
// This used to be a hand-copied replica of that view — its own ticker, graph,
// legend and reset button. Every feature added to the real one then had to be
// added here as well, and the first time that was missed the harness stopped
// being the faithful preview it advertises itself as while still looking
// plausible. Rendering the real component is the only version of this that
// cannot drift.
function UniverseQaTab() {
  const [ds] = useState(() => {
    const source = makeSyntheticDataSource({ nodeTarget: readQaNodeTarget(), wsTarget: readQaWsTarget() });
    window.__universeQaExpected = source.totals;
    return source;
  });
  const [picked, setPicked] = useState(null);
  return (
    <div className="universe-tab">
      <UniverseView dataSource={ds} statsOverride={FIXTURE_UNIVERSE_STATS} onPick={setPicked} />
      {picked && (
        <div className="universe-qa-picked" data-testid="universe-qa-picked">
          {picked.kind} · {picked.id}
        </div>
      )}
    </div>
  );
}

// The real Command Center over fixture RPCs. Its universe backdrop is the
// synthetic corpus; the SSE-fed bottom cells stay 0 (no party server), which
// is a useful check of the null path — the renderer-fed Nodes/Connections
// cells beside them still fill in.
function CommandCenterQaTab() {
  const [ds] = useState(() => makeSyntheticDataSource({ nodeTarget: readQaNodeTarget(), wsTarget: readQaWsTarget() }));
  return (
    <div className="universe-tab">
      <AdminCommandCenter dataSource={ds} />
    </div>
  );
}

// The REAL Discover tab — SEO section, AI channel panel, discoverable boards —
// over the fixtures above (its other RPCs answer null and render empty). It
// calls useFeedback() for its publish toasts; AdminPage gets that provider
// from the app shell, so the harness supplies one here.
function DiscoverQaTab() {
  return (
    <FeedbackProvider>
      <AdminDiscoverTab />
    </FeedbackProvider>
  );
}

const TABS = [
  // One dashboard tab now — its four views live behind ?view= inside it.
  { id: 'overview',  label: 'Overview',  Component: AdminAnalyticsTab },
  { id: 'users',     label: 'Users',     Component: AdminUsersTab },
  { id: 'grants',    label: 'Grants',    Component: AdminGrantsTab },
  { id: 'waitlist',  label: 'Waitlist',  Component: AdminWaitlistTab },
  { id: 'feedback',  label: 'Feedback',  Component: AdminFeedbackTab },
  { id: 'errors',    label: 'Errors',    Component: AdminErrorsTab },
  { id: 'api',       label: 'API',       Component: AdminApiTab },
  { id: 'tagging',   label: 'Tagging',   Component: AdminTaggingTab },
  { id: 'discover',  label: 'Discover',  Component: DiscoverQaTab },
  { id: 'universe',  label: 'Universe',  Component: UniverseQaTab },
  { id: 'command',   label: 'Command',   Component: CommandCenterQaTab },
];

function initialTab() {
  try {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t && TABS.some((x) => x.id === t)) return t;
  } catch (_) { /* ignore */ }
  return 'overview';
}

export function AdminPreviewHarness() {
  const [tab, setTab] = useState(initialTab);
  const [light, setLight] = useState(false);

  const toggleTheme = () => {
    setLight((v) => {
      const next = !v;
      try { document.documentElement.dataset.theme = next ? 'light' : ''; } catch (_) {}
      return next;
    });
  };

  const active = TABS.find((t) => t.id === tab);
  const Component = active?.Component;

  if (!MOCKS_OK) {
    return (
      <div style={{ padding: 40, font: '500 14px/1.6 system-ui', color: '#ddd', background: '#0a0a0c', minHeight: '100vh' }}>
        <strong style={{ color: '#ffa500' }}>Admin preview unavailable.</strong>
        <p>The Supabase client is null — set <code>VITE_SUPABASE_URL</code> + a publishable/anon key in <code>boards/.env</code> so the harness has a client instance to mock, then reload <code>?adminpreview=1</code>.</p>
      </div>
    );
  }

  return (
    <div className="admin-screen">
      <header className="admin-header">
        <SoleilWordmark size="block" />
        <div className="admin-tabs" role="tablist" aria-label="Admin sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`admin-tab ${tab === t.id ? 'is-active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="admin-header-right">
          <span className="t-meta" style={{ color: 'var(--ink-3)' }}>preview · fixtures</span>
          <button className="auth-link" onClick={toggleTheme}>{light ? 'Dark' : 'Light'}</button>
        </div>
      </header>

      <main className={`admin-body ${tab === 'universe' || tab === 'command' ? 'admin-body-flush' : ''}`}>
        {Component ? <Component /> : null}
      </main>
    </div>
  );
}
