// Dev-only fixtures for Admin, Errors: the Issues view over 0582's RPCs.
// Layered over adminFixtures.js's shim, as the harness's AI channel fixtures
// are, so its per-RPC tally still counts them. Imported only by
// AdminPreviewHarness, which is DEV-gated and never ships.
//
// Every number is invented. Every timestamp is relative to now, so "New",
// "Returned" and "Breaking now" stay true of the fixture whatever day it is
// opened. Resolve, mute and reopen change the fixture in memory, so the
// buttons and their Undo can be tried.

const MIN = 60000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const dayStr = (back) => new Date(Date.now() - back * DAY).toISOString().slice(0, 10);
const sid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const MONITOR_KINDS = new Set(['csp_violation', 'perf', 'seo_health', 'discovery_pipeline', 'aeo_probe']);

// Oldest first, 14 days.
const spark = (...tail) => [...Array(14 - tail.length).fill(0), ...tail];

const GROUPS = [
  {
    fingerprint: 'fx-render-kind', kind: 'render', source: 'client', severity: 'crash',
    message: "TypeError: Cannot read properties of undefined (reading 'kind')", path: '/b/:id',
    first_seen: ago(3 * HOUR), first_release: 'c0ffee1', last_release: 'c0ffee1', last_at: ago(4 * MIN),
    status: 'open', status_at: null, returned_at: null,
    n: 9, people: 6, users: 4, all_time: 9, breaking: true, is_new: true, returned: false,
    spark: spark(9),
  },
  {
    fingerprint: 'fx-save-timeout', kind: 'save', source: 'client', severity: 'error',
    message: 'Board save failed: canceling statement due to statement timeout', path: '/b/:id',
    first_seen: ago(20 * HOUR), first_release: 'c0ffee1', last_release: 'c0ffee1', last_at: ago(35 * MIN),
    status: 'open', status_at: null, returned_at: null,
    n: 11, people: 4, users: 4, all_time: 11, breaking: false, is_new: true, returned: false,
    spark: spark(4, 7),
  },
  {
    fingerprint: 'fx-backlinks-400', kind: 'http', source: 'client', severity: 'error',
    message: 'POST rpc/doc_backlinks: 400 invalid input syntax for type uuid', path: '/b/:id',
    first_seen: ago(40 * DAY), first_release: 'a1b2c3d', last_release: 'c0ffee1', last_at: ago(2 * HOUR),
    status: 'open', status_at: ago(9 * DAY), returned_at: ago(2 * DAY),
    n: 27, people: 3, users: 3, all_time: 140, breaking: false, is_new: false, returned: true,
    spark: spark(3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 6, 9, 12),
  },
  {
    fingerprint: 'fx-img-thumb', kind: 'resource', source: 'client', severity: 'warning',
    message: "IMG didn't load: media.example.com/:id/thumb", path: '/b/:id',
    first_seen: ago(12 * DAY), first_release: 'a1b2c3d', last_release: 'c0ffee1', last_at: ago(50 * MIN),
    status: 'open', status_at: null, returned_at: null,
    n: 14, people: 5, users: 2, all_time: 31, breaking: false, is_new: false, returned: false,
    spark: spark(1, 2, 0, 1, 3, 2, 1, 0, 2, 2),
  },
  {
    fingerprint: 'fx-toast-move', kind: 'toast', source: 'client', severity: 'error',
    message: 'move_step_failed', path: '/b/:id',
    first_seen: ago(5 * DAY), first_release: 'b4d5e6f', last_release: 'c0ffee1', last_at: ago(7 * HOUR),
    status: 'open', status_at: null, returned_at: null,
    n: 3, people: 2, users: 2, all_time: 3, breaking: false, is_new: false, returned: false,
    spark: spark(1, 0, 0, 1, 1),
  },
  {
    fingerprint: 'fx-boot-stuck', kind: 'stuck', source: 'client', severity: 'error',
    message: 'Stuck: boot did not reach the shell in 45s', path: '/',
    first_seen: ago(26 * HOUR), first_release: 'c0ffee1', last_release: 'c0ffee1', last_at: ago(26 * HOUR),
    status: 'open', status_at: null, returned_at: null,
    n: 1, people: 1, users: 0, all_time: 1, breaking: false, is_new: true, returned: false,
    spark: spark(1, 0),
  },
  {
    fingerprint: 'fx-sync-connecting', kind: 'sync', source: 'client', severity: 'warning',
    message: 'Live sync stuck connecting for 20s', path: '/b/:id',
    first_seen: ago(6 * DAY), first_release: 'b4d5e6f', last_release: 'c0ffee1', last_at: ago(3 * HOUR),
    status: 'open', status_at: null, returned_at: null,
    n: 4, people: 2, users: 2, all_time: 4, breaking: false, is_new: false, returned: false,
    spark: spark(1, 0, 0, 2, 0, 1),
  },
  {
    fingerprint: 'fx-get-slow', kind: 'http', source: 'client', severity: 'warning',
    message: 'GET rest/boards: slow (9.2s)', path: '/',
    first_seen: ago(3 * DAY), first_release: 'b4d5e6f', last_release: 'c0ffee1', last_at: ago(5 * HOUR),
    status: 'open', status_at: null, returned_at: null,
    n: 5, people: 3, users: 3, all_time: 5, breaking: false, is_new: false, returned: false,
    spark: spark(2, 1, 2),
  },
  {
    fingerprint: 'fx-worker-route', kind: 'route', source: 'worker', severity: 'error',
    message: 'GET /c/:slug: TypeError: fetch failed', path: '/c/:slug',
    first_seen: ago(2 * DAY), first_release: null, last_release: null, last_at: ago(9 * HOUR),
    status: 'open', status_at: null, returned_at: null,
    n: 6, people: 0, users: 0, all_time: 6, breaking: false, is_new: false, returned: false,
    spark: spark(4, 2),
  },
  {
    fingerprint: 'fx-cron-seo', kind: 'cron', source: 'db', severity: 'error',
    message: 'seo-health: job failed: canceling statement due to statement timeout', path: null,
    first_seen: ago(4 * DAY), first_release: null, last_release: null, last_at: ago(30 * HOUR),
    status: 'open', status_at: null, returned_at: null,
    n: 2, people: 0, users: 0, all_time: 2, breaking: false, is_new: false, returned: false,
    spark: spark(1, 0, 0, 1, 0),
  },
  {
    fingerprint: 'fx-chunk', kind: 'window', source: 'client', severity: 'error',
    message: 'Failed to fetch dynamically imported module: /assets/<hex>.js', path: '/b/:id',
    first_seen: ago(30 * DAY), first_release: 'a1b2c3d', last_release: 'b4d5e6f', last_at: ago(6 * DAY),
    status: 'resolved', status_at: ago(5 * DAY), returned_at: null,
    n: 2, people: 1, users: 1, all_time: 22, breaking: false, is_new: false, returned: false,
    spark: spark(1, 1, 0, 0, 0, 0, 0),
  },
  {
    fingerprint: 'fx-resize-observer', kind: 'window', source: 'client', severity: 'error',
    message: 'ResizeObserver loop completed with undelivered notifications', path: '/b/:id',
    first_seen: ago(60 * DAY), first_release: 'a1b2c3d', last_release: 'c0ffee1', last_at: ago(1 * HOUR),
    status: 'muted', status_at: ago(20 * DAY), returned_at: null,
    n: 38, people: 9, users: 7, all_time: 410, breaking: false, is_new: false, returned: false,
    spark: spark(2, 3, 2, 4, 3, 2, 3, 2, 3, 4, 2, 3, 2, 3),
  },
  {
    fingerprint: 'fx-csp', kind: 'csp_violation', source: 'client', severity: 'warning',
    message: 'script-src blocked: chrome-extension', path: '/',
    first_seen: ago(90 * DAY), first_release: null, last_release: null, last_at: ago(20 * MIN),
    status: 'open', status_at: null, returned_at: null,
    n: 120, people: 30, users: 12, all_time: 2400, breaking: false, is_new: false, returned: false,
    spark: spark(8, 9, 7, 10, 8, 9, 8, 7, 9, 10, 8, 9, 8, 10),
  },
];

function lensOk(lens, g) {
  const monitor = MONITOR_KINDS.has(g.kind);
  if (lens === 'all') return true;
  if (lens === 'monitors') return monitor;
  if (monitor) return false;
  if (lens === 'crashes') return g.severity === 'crash';
  if (lens === 'requests') return g.kind === 'http';
  if (lens === 'stuck') return g.kind === 'stuck' || g.kind === 'sync' || (g.kind === 'http' && /: slow/.test(g.message));
  if (lens === 'servers') return g.source !== 'client';
  return true;
}

const BREAKING = [{
  rule: 'widespread', problem: 'fx-render-kind', people: 6, occurrences: 9,
  title: 'One problem reached 6 people in the last hour', outcome: 'emailed in the last 6 hours',
}];

const ALERTS = [
  { id: 9001, at: ago(40 * MIN), kind: 'something_is_breaking', title: 'One problem reached 6 people in the last hour', paged_at: ago(40 * MIN) },
  { id: 8990, at: ago(3 * DAY), kind: 'something_is_breaking', title: 'Board saves are failing for 3 people', paged_at: ago(3 * DAY) },
];

function errorGroups(params) {
  const days = Math.max(1, Math.min(Number(params?.p_days) || 7, 90));
  const lens = params?.p_lens || 'problems';
  const status = params?.p_status || 'open';
  const env = params?.p_env || 'prod';
  const kind = params?.p_kind || null;
  // As 0582: a problem is listed when it happened in the window. Every fixture
  // row is production's, so preview's list is the empty state.
  const seen = env === 'preview' ? [] : GROUPS.filter((g) => lensOk(lens, g) && g.n > 0);
  const pool = seen.filter((g) => status === 'all' || g.status === status);
  // As 0582: the kinds count every status, before the kind filter.
  const kinds = [...seen.reduce((m, g) => {
    const k = m.get(g.kind) || { kind: g.kind, n: 0, groups: 0 };
    k.n += g.n; k.groups += 1;
    return m.set(g.kind, k);
  }, new Map()).values()].sort((a, b) => b.n - a.n);
  const groups = pool.filter((g) => !kind || g.kind === kind)
    .slice().sort((a, b) => (b.breaking - a.breaking) || (b.people - a.people) || (b.n - a.n));
  return {
    days, since: ago(days * DAY),
    totals: {
      problems: groups.length,
      occurrences: groups.reduce((a, g) => a + g.n, 0),
      people: Math.max(0, groups.reduce((a, g) => a + g.people, 0) - 3),
      crash_people: groups.filter((g) => g.severity === 'crash').reduce((a, g) => a + g.people, 0),
      new: groups.filter((g) => g.is_new).length,
      returned: groups.filter((g) => g.returned).length,
    },
    kinds,
    breaking: BREAKING,
    alerts: ALERTS,
    groups,
  };
}

const UAS = ['Chrome · Mac', 'Safari · iOS', 'Chrome · Windows', 'Edge · Windows', 'In-app · iOS', 'Firefox · Linux'];
const CRUMBS = [
  [{ t: 61000, k: 'nav', n: '/' }, { t: 48000, k: 'ev', n: 'home_view' }, { t: 30500, k: 'nav', n: '/b/:id' },
    { t: 29000, k: 'ev', n: 'board_open' }, { t: 6200, k: 'ev', n: 'card_create' }, { t: 1400, k: 'http', n: 'rpc/save_board' }],
  [{ t: 125000, k: 'vis', n: 'hidden' }, { t: 9000, k: 'vis', n: 'visible' }, { t: 4100, k: 'net', n: 'online' },
    { t: 900, k: 'toast', n: 'move_step_failed' }],
  [],
];

function errorGroup(params) {
  const g = GROUPS.find((x) => x.fingerprint === params?.p_fingerprint) || GROUPS[0];
  const days = Math.max(1, Math.min(Number(params?.p_days) || 30, 90));
  const n = Math.max(g.n, 1);
  const trend = Array.from({ length: days + 1 }, (_, i) => {
    const back = days - i;
    const v = back < 14 ? g.spark[13 - back] : 0;
    return { day: dayStr(back), n: v, people: Math.min(v, g.people) };
  });
  const isHttp = g.kind === 'http';
  const occurrences = Array.from({ length: Math.min(n, 6) }, (_, i) => ({
    id: 70000 + i,
    at: ago(i * 47 * MIN + 4 * MIN),
    occurred_at: ago(i * 47 * MIN + 4 * MIN + 800),
    kind: g.kind, severity: g.severity, source: g.source, env: i === 4 ? 'preview' : 'prod',
    name: g.severity === 'crash' ? 'TypeError' : null,
    message: g.message, path: g.path, release: i < 3 ? g.last_release : g.first_release,
    ua: UAS[i % UAS.length],
    context: isHttp
      ? { http: { method: g.message.slice(0, 4).trim(), svc: 'rpc', route: 'doc_backlinks', status: 400, pg: '22P02', ms: 180 + i * 40 } }
      : g.kind === 'save' ? { op: 'save', attempt: 1 + (i % 3), board_id: null, ms: 8000 + i * 120 }
        : g.kind === 'stuck' ? { op: 'boot', phase: 'shell', ms: 45000 }
          : { surface: 'canvas' },
    breadcrumbs: g.source === 'client' ? CRUMBS[i % CRUMBS.length] : [],
    stack: g.source === 'client'
      ? `${g.message}\n    at Wc (https://clusters.example.com/assets/BoardCanvas-3f9a1c.js:1:48211)\n    at Ru (https://clusters.example.com/assets/AppShell-81b2aa.js:1:20033)`
      : null,
    component_stack: g.kind === 'render' ? '\n    at CardView\n    at BoardCanvas\n    at Workspace' : null,
    user_id: i % 3 === 2 ? null : sid(100 + i),
    email: i % 3 === 2 ? null : `person${i + 1}@example.com`,
    session_id: g.source === 'client' ? sid(500 + i) : null,
    app_session_id: g.source === 'client' ? sid(900 + i) : null,
  }));
  return {
    days,
    group: {
      fingerprint: g.fingerprint, kind: g.kind, source: g.source, severity: g.severity,
      sample_message: g.message, sample_path: g.path,
      first_seen: g.first_seen, first_release: g.first_release, last_seen: g.last_at, last_release: g.last_release,
      status: g.status, status_at: g.status_at, returned_at: g.returned_at,
      resolved_releases: g.status === 'resolved' ? [g.first_release, g.last_release].filter(Boolean) : null,
      status_by_email: g.status === 'open' ? null : 'owner@example.com',
    },
    totals: { n: g.n, people: g.people, users: g.users },
    trend,
    releases: [g.last_release, g.first_release].filter((r, i, a) => r && a.indexOf(r) === i)
      .map((r, i) => ({ release: r, n: i ? Math.ceil(n / 3) : n, people: Math.max(1, g.people - i), first_at: ago((i + 1) * 2 * DAY), last_at: ago(i * DAY + 4 * MIN) })),
    browsers: UAS.slice(0, 4).map((ua, i) => ({ ua, n: Math.max(1, Math.round(n / (i + 1.5))), people: Math.max(1, g.people - i) })),
    paths: [g.path || '', '/'].filter((p, i, a) => a.indexOf(p) === i)
      .map((p, i) => ({ path: p, n: i ? 1 : n, people: i ? 1 : g.people })),
    envs: { prod: n - 1, preview: 1 },
    context: isHttp
      ? { route: [{ v: 'rpc/doc_backlinks', n }], status: [{ v: '400', n }], pg: [{ v: '22P02', n }] }
      : g.kind === 'save' ? { op: [{ v: 'save', n }] } : {},
    occurrences,
  };
}

function sessionTrail(params) {
  const at = Date.parse(params?.p_at || '') || Date.now() - 2 * HOUR;
  const t = (ms) => new Date(at + ms).toISOString();
  const g = GROUPS[0];
  return {
    session_id: params?.p_session_id || sid(500),
    at: new Date(at).toISOString(), from: t(-15 * MIN), to: t(15 * MIN),
    user: { user_id: sid(100), email: 'person1@example.com' },
    device: { browser: 'Chrome', os: 'Mac', device_type: 'desktop', build: 'c0ffee1', tier: 'free' },
    errors: [
      { id: 71000, at: t(-95000), kind: 'http', severity: 'warning', source: 'client', name: null,
        message: 'GET rest/boards: slow (9.2s)', path: '/', release: 'c0ffee1', fingerprint: 'fx-get-slow',
        context: { http: { method: 'GET', svc: 'rest', route: 'boards', status: 200, ms: 9200 } } },
      { id: 70000, at: t(0), kind: g.kind, severity: g.severity, source: 'client', name: 'TypeError',
        message: g.message, path: '/b/:id', release: 'c0ffee1', fingerprint: g.fingerprint, context: { surface: 'canvas' } },
    ],
    events: [
      { at: t(-12 * MIN), event: 'app_open', path: '/', props: { surface: 'home' } },
      { at: t(-11 * MIN), event: 'home_view', path: '/', props: null },
      { at: t(-8 * MIN), event: 'board_open', path: '/b/:id', props: { source: 'home' } },
      { at: t(-6 * MIN), event: 'files_move', path: '/b/:id', props: { outcome: 'failed', code: 'P0001', n: 3 } },
      { at: t(-3 * MIN), event: 'app_trace', path: '/b/:id', props: { ev: [{ k: 'dead' }, { k: 'dead' }, { k: 'rage', n: 5 }] } },
      { at: t(-40000), event: 'card_create', path: '/b/:id', props: { kind: 'image' } },
      { at: t(3000), event: 'crash_screen_view', path: '/b/:id', props: null },
      { at: t(9000), event: 'crash_reload', path: '/b/:id', props: null },
      { at: t(20000), event: 'board_open', path: '/b/:id', props: { source: 'reload' } },
    ],
    feedback: [
      { id: 'fb-fixture-1', at: t(2 * MIN), kind: 'bug', choice: null, message: 'The board went blank when I dropped two images on it.' },
    ],
  };
}

const ACTIONS = [
  { event: 'otp_verify_error', n: 21, people: 9, last_at: ago(40 * MIN), reasons: [{ why: 'otp_expired', n: 12 }, { why: 'invalid', n: 9 }], spark: spark(1, 2, 0, 3, 1, 2, 4, 1, 2, 3, 2) },
  { event: 'files_move', n: 8, people: 3, last_at: ago(3 * HOUR), reasons: [{ why: 'P0001', n: 6 }, { why: 'network', n: 2 }], spark: spark(2, 0, 1, 3, 2) },
  { event: 'checkout_error', n: 3, people: 2, last_at: ago(2 * DAY), reasons: [{ why: 'card_declined', n: 2 }, { why: 'stripe_5xx', n: 1 }], spark: spark(1, 0, 2, 0, 0) },
  { event: 'import_job', n: 4, people: 1, last_at: ago(5 * DAY), reasons: [{ why: 'quota', n: 4 }], spark: spark(4, 0, 0, 0, 0, 0) },
  { event: 'editor_limit_refused', n: 2, people: 2, last_at: ago(6 * DAY), reasons: [], spark: spark(1, 1, 0, 0, 0, 0, 0) },
];

function failureEvents(params) {
  const days = Math.max(1, Math.min(Number(params?.p_days) || 7, 90));
  return {
    days,
    totals: { n: ACTIONS.reduce((a, r) => a + r.n, 0), people: 14, actions: ACTIONS.length },
    actions: ACTIONS,
  };
}

function clickFriction(params) {
  const days = Math.max(1, Math.min(Number(params?.p_days) || 7, 90));
  const targets = [
    { surface: 'app', k: 'rage', tgt: 'button.card-pop-more', n: 14, people: 4, last_at: ago(2 * HOUR) },
    { surface: 'app', k: 'dead', tgt: 'div.board-title', n: 31, people: 9, last_at: ago(25 * MIN) },
    { surface: 'landing', k: 'dead', tgt: 'img.hero-shot', n: 18, people: 11, last_at: ago(4 * HOUR) },
    { surface: 'pricing', k: 'dead', tgt: 'span.plan-price', n: 6, people: 4, last_at: ago(1 * DAY) },
    { surface: 'upsell', k: 'rage', tgt: 'button.upsell-close', n: 3, people: 2, last_at: ago(3 * DAY) },
  ].sort((a, b) => b.people - a.people);
  return {
    days,
    totals: {
      dead: targets.filter((x) => x.k === 'dead').reduce((a, x) => a + x.n, 0),
      rage: targets.filter((x) => x.k === 'rage').reduce((a, x) => a + x.n, 0),
      people: 21,
    },
    targets,
  };
}

function setStatus(params) {
  const g = GROUPS.find((x) => x.fingerprint === params?.p_fingerprint);
  if (!g) return { error: { message: 'no such problem', code: 'P0002' } };
  if (!['open', 'resolved', 'muted'].includes(params?.p_status)) {
    return { error: { message: 'status must be open, resolved or muted', code: '22023' } };
  }
  g.status = params.p_status;
  g.status_at = new Date().toISOString();
  g.returned = false;
  g.returned_at = null;
  return { data: { fingerprint: g.fingerprint, status: g.status, status_at: g.status_at } };
}

const ISSUE_FIXTURES = {
  admin_error_groups: (p) => ({ data: errorGroups(p) }),
  admin_error_group: (p) => ({ data: errorGroup(p) }),
  admin_error_session_trail: (p) => ({ data: sessionTrail(p) }),
  admin_failure_events: (p) => ({ data: failureEvents(p) }),
  admin_click_friction: (p) => ({ data: clickFriction(p) }),
  admin_set_error_group_status: setStatus,
};

export function installIssuesFixtures(client) {
  const base = client.rpc;
  client.rpc = (name, params) => {
    const r = base(name, params); // keeps the tally; answers null for these names
    if (!Object.prototype.hasOwnProperty.call(ISSUE_FIXTURES, name)) return r;
    return r.then(() => {
      const out = ISSUE_FIXTURES[name](params);
      return { data: out.data ?? null, error: out.error ?? null };
    });
  };
}
