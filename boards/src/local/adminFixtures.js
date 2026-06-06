// Dev-only fixtures + a mock Supabase shim for the admin preview harness
// (?adminpreview=1). Dynamically imported only by AdminPreviewHarness, which is
// itself gated behind import.meta.env.DEV — so none of this ships to prod.
//
// The data is intentionally RICH (hundreds of users, a real funnel, full
// tables) so the redesign is judged against a populated, premium-looking UI
// rather than empty states. Shapes match the real RPC/table return types
// (verified via pg_get_function_result / pg_get_functiondef).

const TODAY = new Date();
const dayISO = (back) => {
  const d = new Date(TODAY);
  d.setDate(d.getDate() - back);
  return d.toISOString().slice(0, 10);
};
const tsISO = (minsBack) => new Date(TODAY.getTime() - minsBack * 60000).toISOString();
// Deterministic gentle wave so screenshots are stable (no Math.random).
const wave = (i, base, amp, period = 7) => Math.round(base + amp * Math.sin(i / period) + (i * amp) / 40);

// ── series ──────────────────────────────────────────────────────────
const series = (n, fn) => Array.from({ length: n }, (_, i) => fn(n - 1 - i)); // oldest→newest

const signupsByDay = series(30, (back) => ({ day: dayISO(back), signups: Math.max(0, wave(30 - back, 9, 5)) }));
const cardsPerDay  = series(30, (back) => ({ day: dayISO(back), cards: Math.max(0, wave(30 - back, 58, 26)) }));
const waitlistFunnel = series(30, (back) => {
  const submitted = Math.max(0, wave(30 - back, 14, 6));
  return { day: dayISO(back), submitted, accepted: Math.round(submitted * 0.42) };
});
const metricsHistory = series(60, (back) => {
  const i = 60 - back;
  return {
    day: dayISO(back),
    mrr_cents: 120000 + i * 2800 + wave(i, 0, 6000),
    total_users: 700 + i * 10,
    paid_users: 70 + Math.round(i * 1.2),
    demo_users: 480 + i * 6,
    waitlist_users: 150 + i * 3,
    admin_users: 3,
    signups: Math.max(0, wave(i, 9, 5)),
    active_users: 180 + Math.round(i * 1.8) + wave(i, 0, 30),
  };
});

// ── tier / users ────────────────────────────────────────────────────
const TIERS = ['paid', 'demo', 'demo', 'waitlist', 'demo', 'paid', 'demo', 'waitlist'];
const NAMES = ['mara', 'devon', 'priya', 'liang', 'sofia', 'theo', 'amina', 'jonas', 'kira', 'ravi',
  'noa', 'elias', 'yuki', 'omar', 'greta', 'sam', 'ines', 'paolo', 'lena', 'cyrus'];
const listUsers = NAMES.map((name, i) => {
  const tier = TIERS[i % TIERS.length];
  const paid = tier === 'paid';
  const contacted = i % 5 === 0;   // sprinkle a few "reached out" users for the preview
  return {
    user_id: `u-${i}`,
    email: `${name}@${['studio.co', 'gmail.com', 'acme.io', 'proton.me'][i % 4]}`,
    tier,
    card_count: Math.max(0, wave(i, 70, 60)),
    seconds_in_app: Math.max(0, wave(i, 9000, 8000)) * 6,
    created_at: tsISO((i + 1) * 1440 * 3),
    last_sign_in_at: tsISO((i % 5) * 120 + 15),
    subscription_plan: paid ? (i % 2 ? 'annual' : 'monthly') : null,
    subscription_status: paid ? 'active' : null,
    current_period_end: paid ? tsISO(-1440 * 20) : null,
    subscription_amount_cents: paid ? (i % 2 ? 2000 : 2500) : null,
    subscription_discounted: paid && i % 3 === 0,
    banned: i === 13,
    joined_waitlist: tier === 'waitlist' || i % 4 === 0,
    outreach_count: contacted ? 1 + (i % 2) : 0,
    last_reached_out_at: contacted ? tsISO((i % 4) * 1440 + 60) : null,
  };
});

const topUsers = (tier) => listUsers
  .filter((u) => (tier ? u.tier === tier : true))
  .slice(0, 20)
  .map((u) => ({ user_id: u.user_id, email: u.email, tier: u.tier, card_count: u.card_count,
    board_count: Math.max(1, Math.round(u.card_count / 9)), created_at: u.created_at, last_sign_in_at: u.last_sign_in_at }));

// ── funnel ──────────────────────────────────────────────────────────
const signupFunnel = [
  { ord: 1,  step: 'landing_view',        label: 'Landing view',           branch: 'core',     sessions: 4280, users: 0 },
  { ord: 2,  step: 'email_submit',        label: 'Email submitted',        branch: 'core',     sessions: 1190, users: 0 },
  { ord: 3,  step: 'otp_verify',          label: 'OTP verified (account)', branch: 'core',     sessions: 1102, users: 1102 },
  { ord: 4,  step: 'welcome_view',        label: 'Welcome page',           branch: 'core',     sessions: 988,  users: 988 },
  { ord: 5,  step: 'submit_socials_open', label: 'Opened waitlist form',   branch: 'waitlist', sessions: 545,  users: 545 },
  { ord: 6,  step: 'submit_socials_done', label: 'Joined waitlist',        branch: 'waitlist', sessions: 412,  users: 412 },
  { ord: 7,  step: 'pricing_view',        label: 'Viewed pricing',         branch: 'pricing',  sessions: 612,  users: 612 },
  { ord: 8,  step: 'checkout_open',       label: 'Opened checkout',        branch: 'pricing',  sessions: 286,  users: 286 },
  { ord: 9,  step: 'checkout_success',    label: 'Completed payment',      branch: 'pricing',  sessions: 142,  users: 142 },
  { ord: 20, step: 'email_submit_error',  label: 'Email submit failed',    branch: 'leak',     sessions: 64,   users: 0 },
  { ord: 21, step: 'otp_verify_error',    label: 'OTP verify failed',      branch: 'leak',     sessions: 38,   users: 0 },
  { ord: 22, step: 'waitlist_abandon',    label: 'Abandoned waitlist form',branch: 'leak',     sessions: 121,  users: 121 },
  { ord: 23, step: 'pricing_abandon',     label: 'Abandoned pricing',      branch: 'leak',     sessions: 240,  users: 240 },
  { ord: 24, step: 'checkout_error',      label: 'Checkout failed',        branch: 'leak',     sessions: 31,   users: 31 },
];
const funnelSegments = [
  { dim: 'source', value: 'google',   sessions: 1840 },
  { dim: 'source', value: 'reddit',   sessions: 980 },
  { dim: 'source', value: 'twitter',  sessions: 612 },
  { dim: 'source', value: 'direct',   sessions: 520 },
  { dim: 'campaign', value: 'launch-q3', sessions: 1420 },
  { dim: 'campaign', value: 'creators',  sessions: 880 },
  { dim: 'content', value: 'hero-a',  sessions: 760 },
  { dim: 'content', value: 'hero-b',  sessions: 540 },
];

// ── kpi summary (rich; everything above the small-N floor so it reads "solid") ──
const kpi = {
  current:  { signups: 96, activated: 58, activation_rate: 0.604, demo_base: 812, converted: 142,
    demo_to_paid_rate: 0.175, checkout_open: 64, checkout_success: 41, checkout_success_rate: 0.641,
    wau: 287, cards_created: 1840 },
  previous: { signups: 81, activated: 44, activation_rate: 0.543, demo_base: 760, converted: 118,
    demo_to_paid_rate: 0.155, checkout_open: 58, checkout_success: 33, checkout_success_rate: 0.569,
    wau: 252, cards_created: 1610 },
};

const cohorts = [];
for (let w = 0; w < 6; w++) {
  const size = [42, 38, 51, 33, 47, 29][w];
  for (let d = 0; d <= Math.min(35, 7 * (6 - w)); d += 1) {
    const pct = Math.max(0.05, 0.95 * Math.exp(-d / 14) - w * 0.01);
    cohorts.push({ cohort_week: dayISO((6 - w) * 7), day_offset: d, cohort_size: size,
      active_n: Math.round(size * pct), active_pct: Number(pct.toFixed(4)) });
  }
}

// admin_retention_curve — pooled retention by day-since-signup, split all/demo/paid.
// Paid retains longest; eligibility stays trustworthy across the span so all three
// lines render in the preview (real prod data starts much sparser).
const retentionCurve = [];
for (let d = 0; d <= 21; d++) {
  const eligAll  = Math.max(24, Math.round(140 - d * 4));
  const eligDemo = Math.round(eligAll * 0.7);
  const eligPaid = Math.round(eligAll * 0.18);
  const pctAll  = d === 0 ? 1 : 0.62 * Math.exp(-d / 9)  + 0.06;
  const pctDemo = d === 0 ? 1 : 0.50 * Math.exp(-d / 8)  + 0.04;
  const pctPaid = d === 0 ? 1 : 0.80 * Math.exp(-d / 16) + 0.12;
  const mk = (segment, eligible, pct) => ({ segment, day_offset: d, eligible,
    active: Math.round(eligible * pct), active_pct: Number(pct.toFixed(4)) });
  retentionCurve.push(mk('all', eligAll, pctAll), mk('demo', eligDemo, pctDemo), mk('paid', eligPaid, pctPaid));
}

// admin_user_lifespan — active-days-per-user distribution + median stickiness.
const lifespan = {
  total_users: 420, median_active_days: 4, p90_active_days: 16, mean_active_days: 5.8,
  buckets: [
    { label: '0–1', ord: 1, users: 96 }, { label: '2', ord: 2, users: 70 },
    { label: '3–4', ord: 3, users: 88 }, { label: '5–7', ord: 4, users: 74 },
    { label: '8–14', ord: 5, users: 58 }, { label: '15+', ord: 6, users: 34 },
  ],
};

// ── tagging (small but enough for overview + a drill-down histogram) ──
const vec = (a) => `[${a.join(',')}]`;
const tagWorkspaces = [{ id: 'ws1', name: 'Acme Studio' }];
const tags = [
  { id: 't1', name: 'Hero shots',   slug: 'hero',  color: '#ffa500', description: 'Key art / hero images',  workspace_id: 'ws1' },
  { id: 't2', name: 'Storyboards',  slug: 'story', color: '#7da0dc', description: 'Sequence sketches',       workspace_id: 'ws1' },
  { id: 't3', name: 'Lighting refs',slug: 'light', color: '#50c878', description: 'No centroid yet',          workspace_id: 'ws1' },
];
const tagCentroids = [{ tag_id: 't1', centroid: vec([1, 0, 0, 0]) }, { tag_id: 't2', centroid: vec([0, 1, 0, 0]) }];
const cardEmbeddings = [];
const cardIndexRows = [];
const appliedLinks = [];
for (let i = 0; i < 16; i++) {
  const id = `c${i}`;
  // alternate clusters near t1, near t2, and ambiguous/far
  const mode = i % 4;
  const v = mode === 0 ? [0.96, 0.12, 0.05, 0] : mode === 1 ? [0.1, 0.95, 0.03, 0]
    : mode === 2 ? [0.62, 0.6, 0.1, 0.1] : [0.2, 0.2, 0.7, 0.5];
  cardEmbeddings.push({ card_id: id, workspace_id: 'ws1', board_id: 'b1', embedding: vec(v) });
  cardIndexRows.push({ card_id: id, board_id: 'b1', kind: i % 3 ? 'image' : 'note',
    title: `Card ${i}`, body: ['storyboard frame', 'hero composite', 'lighting test', 'mood ref'][i % 4] });
  if (mode === 0 && i < 12) appliedLinks.push({ target_id: 't1', source_kind: 'card', source_id: id });
  if (mode === 1 && i < 12) appliedLinks.push({ target_id: 't2', source_kind: 'card', source_id: id });
  if (mode === 3 && i < 8)  appliedLinks.push({ target_id: 't1', source_kind: 'card', source_id: id }); // a high-distance member (suspect)
}
const tagEvalLabels = [
  { tag_id: 't1', source_kind: 'card', source_id: 'c4',  label: 'should_apply',     workspace_id: 'ws1', created_at: tsISO(120) },
  { tag_id: 't1', source_kind: 'card', source_id: 'c12', label: 'should_not_apply', workspace_id: 'ws1', created_at: tsISO(90) },
  { tag_id: 't2', source_kind: 'card', source_id: 'c5',  label: 'should_apply',     workspace_id: 'ws1', created_at: tsISO(60) },
];

// ── RPC fixtures ────────────────────────────────────────────────────
const RPCS = {
  admin_capture_metrics_now: null,
  sweep_expired_paid_grants: null,
  get_my_tier: { tier: 'admin', banned: false },

  admin_stats: {
    total_users: 1284, new_users_7d: 96,
    tier_counts: { admin: 3, paid: 142, demo: 806, waitlist: 333 },
    sub_counts: { active: 138, trialing: 4, canceled: 18 },
    mrr_cents: 312400, comped_paid: 6, discounted_subs: 21,
    waitlist_pending: 211, waitlist_total: 333,
  },
  admin_avg_time_to_paid: { paid_users: 142, avg_seconds: 205200, median_seconds: 151200 },
  admin_signups_by_day: signupsByDay,
  admin_waitlist_funnel: waitlistFunnel,
  admin_metrics_history: metricsHistory,
  admin_cards_per_day: cardsPerDay,
  admin_kpi_summary: kpi,
  admin_signup_funnel: signupFunnel,
  // FB/IG instant-demo funnel (admin_fb_funnel) — fbclid ad traffic skips the
  // waitlist; ad_offer_view is the fork, demo|buy branch off it. demo+checkout
  // open ≈ saw-offer so the fork reads cleanly.
  admin_fb_funnel: [
    { ord: 1, step: 'landing_view',     label: 'Landing view',          branch: 'core', sessions: 420, users: 0 },
    { ord: 2, step: 'email_submit',     label: 'Email submitted',       branch: 'core', sessions: 168, users: 0 },
    { ord: 3, step: 'otp_verify',       label: 'Account created',       branch: 'core', sessions: 154, users: 154 },
    { ord: 4, step: 'ad_offer_view',    label: 'Saw the price offer',   branch: 'core', sessions: 150, users: 150 },
    { ord: 5, step: 'ad_offer_enter',   label: 'Stepped into the demo', branch: 'demo', sessions: 119, users: 119 },
    { ord: 6, step: 'checkout_open',    label: 'Opened checkout',       branch: 'buy',  sessions: 31,  users: 31 },
    { ord: 7, step: 'checkout_success', label: 'Completed payment',     branch: 'buy',  sessions: 22,  users: 22 },
  ],
  admin_funnel_segments: funnelSegments,
  admin_acquisition_breakdown: [
    { source: 'google',  signups: 412, converted: 79, conversion: 0.1917 },
    { source: 'reddit',  signups: 233, converted: 28, conversion: 0.1202 },
    { source: 'twitter', signups: 168, converted: 21, conversion: 0.125 },
    { source: 'direct',  signups: 121, converted: 14, conversion: 0.1157 },
    { source: 'product-hunt', signups: 64, converted: 11, conversion: 0.1719 },
  ],
  admin_activation_funnel: { signed_up: 96, first_board: 78, first_card: 58, first_share: 31, first_backlink: 19, first_paid: 17 },
  admin_retention_cohorts: cohorts,
  admin_retention_curve: retentionCurve,
  admin_user_lifespan: lifespan,
  admin_meta_capi_health: [
    { event_name: 'Purchase',             sends: 142, ok: 142, failed: 0, success_pct: 1,      last_sent: tsISO(11),  last_error: null },
    { event_name: 'InitiateCheckout',     sends: 210, ok: 208, failed: 2, success_pct: 0.9905, last_sent: tsISO(4),   last_error: 'graph timeout' },
    { event_name: 'CompleteRegistration', sends: 96,  ok: 95,  failed: 1, success_pct: 0.9896, last_sent: tsISO(2),   last_error: '400: Invalid parameter fbc' },
    { event_name: 'Lead',                 sends: 64,  ok: 64,  failed: 0, success_pct: 1,      last_sent: tsISO(26),  last_error: null },
  ],
  admin_card_stats: {
    total: 18420,
    by_kind: { image: 8210, note: 4120, link: 2890, palette: 1640, doc: 980, url: 580 },
    by_tier: { admin: 240, paid: 7600, demo: 9800, waitlist: 780 },
    kind_by_tier: {
      image: { admin: 90, paid: 3600, demo: 4200, waitlist: 320 },
      note:  { admin: 60, paid: 1800, demo: 2100, waitlist: 160 },
      link:  { admin: 40, paid: 1200, demo: 1500, waitlist: 150 },
      palette: { admin: 20, paid: 700, demo: 850, waitlist: 70 },
      doc:   { admin: 20, paid: 200, demo: 700, waitlist: 60 },
      url:   { admin: 10, paid: 100, demo: 450, waitlist: 20 },
    },
  },
  admin_tier_usage_compare: [
    { tier: 'admin',    users: 3,   avg_cards: 80.0, avg_boards: 9.1, total_cards: 240,  total_boards: 27 },
    { tier: 'paid',     users: 142, avg_cards: 53.5, avg_boards: 6.4, total_cards: 7600, total_boards: 909 },
    { tier: 'demo',     users: 806, avg_cards: 12.2, avg_boards: 2.1, total_cards: 9800, total_boards: 1690 },
    { tier: 'waitlist', users: 333, avg_cards: 2.3,  avg_boards: 0.6, total_cards: 780,  total_boards: 200 },
  ],
  admin_top_users_demo: topUsers('demo'),
  admin_top_users_paid: topUsers('paid'),
  admin_event_funnel: signupFunnel.filter((s) => s.branch !== 'leak').map((s) => ({ event: s.step, sessions: s.sessions, users: s.users, ord: s.ord })),
  admin_event_breakdown: [
    { event: 'pricing_abandon',  sessions: 240, users: 240, total: 311, ord: 13 },
    { event: 'waitlist_abandon', sessions: 121, users: 121, total: 140, ord: 7 },
    { event: 'email_submit_error', sessions: 64, users: 0,  total: 88,  ord: 1 },
    { event: 'otp_verify_error', sessions: 38, users: 0,    total: 51,  ord: 2 },
    { event: 'checkout_error',   sessions: 31, users: 31,   total: 37,  ord: 14 },
    { event: 'pricing_plan_toggle', sessions: 210, users: 198, total: 540, ord: 10 },
    { event: 'welcome_cta',      sessions: 880, users: 880,  total: 980, ord: 6 },
  ],
  admin_checkout_reliability: { success_views: 142, activated: 138, stalled: 9, verify_retry: 14, missing_session: 3, verify_failed: 4, support_clicks: 6 },
  admin_storage_stats: {
    totals: { r2_bytes: 48230000000, r2_unknown_rows: 0, db_bytes: 2140000000,
      db_breakdown: { board_state: 1480000000, board_snapshots: 520000000, board_ops: 140000000 },
      grand_total: 50370000000 },
    by_tier: {
      admin:    { r2_bytes: 1200000000, db_bytes: 90000000,  total_bytes: 1290000000, users: 3 },
      paid:     { r2_bytes: 31000000000, db_bytes: 1400000000, total_bytes: 32400000000, users: 142 },
      demo:     { r2_bytes: 14800000000, db_bytes: 600000000, total_bytes: 15400000000, users: 806 },
      waitlist: { r2_bytes: 1230000000, db_bytes: 50000000,  total_bytes: 1280000000, users: 333 },
    },
  },
  admin_storage_per_user: listUsers.slice(0, 20).map((u, i) => ({
    user_id: u.user_id, email: u.email, tier: u.tier,
    r2_bytes: Math.max(0, wave(i, 600000000, 500000000)),
    db_bytes: Math.max(0, wave(i, 30000000, 25000000)),
    total_bytes: 0, image_count: Math.max(0, wave(i, 80, 70)),
  })).map((r) => ({ ...r, total_bytes: r.r2_bytes + r.db_bytes })),
  admin_list_users: listUsers,
  admin_user_count: 1284,
  admin_paid_grants_count: 9,
  admin_list_paid_grants: Array.from({ length: 9 }, (_, i) => ({
    email: `${NAMES[i]}@studio.co`, user_id: i % 3 === 2 ? null : `u-${i}`,
    signed_up: i % 3 !== 2, current_tier: i % 3 === 2 ? null : 'paid',
    expires_at: i % 4 === 0 ? null : tsISO(-1440 * (i + 2)),
    status: ['active', 'active', 'pending', 'active', 'forever', 'expired', 'active', 'revoked', 'active'][i],
    granted_at: tsISO(1440 * (i + 1)), granted_by_email: 'andrew@andrewconklin.com',
    revoked_at: i === 7 ? tsISO(720) : null, note: i % 2 ? 'Beta partner' : 'Creator program',
  })),
  admin_list_feedback: [
    { id: 'f1', user_id: 'u-2', email: 'priya@acme.io', kind: 'bug', message: 'The funnel chart tooltip flickers when I hover near the fork divider — looks like a re-render loop. Repro: 90d range, hover the email→otp band quickly.', url: '/admin?tab=analytics', viewport: '1512x982', user_agent: 'Mac · Chrome 128', created_at: tsISO(40) },
    { id: 'f2', user_id: 'u-5', email: 'theo@gmail.com', kind: 'idea', message: 'Could the Users table let me bulk-grant paid access by pasting a column of emails?', url: '/admin?tab=users', viewport: '1728x1080', user_agent: 'Mac · Safari 17', created_at: tsISO(180) },
    { id: 'f3', user_id: null, email: null, kind: 'praise', message: 'New analytics tab is gorgeous 🔥', url: '/admin', viewport: '1440x900', user_agent: 'Win · Edge 128', created_at: tsISO(520) },
    { id: 'f4', user_id: 'u-9', email: 'ravi@proton.me', kind: 'other', message: 'Typo on the waitlist email: "you’re in in".', url: '/welcome', viewport: '390x844', user_agent: 'iPhone · Safari', created_at: tsISO(1300) },
    { id: 'f5', user_id: 'u-1', email: 'devon@gmail.com', kind: 'bug', message: 'Storage tab showed "—" for a sec on load then filled in.', url: '/admin?tab=analytics&view=system', viewport: '2560x1440', user_agent: 'Mac · Chrome 128', created_at: tsISO(2600) },
  ],
  admin_error_summary: [
    { message: "TypeError: Cannot read properties of undefined (reading 'map')", kind: 'window', occurrences: 142, sessions: 38, users: 21, first_seen: tsISO(8000), last_seen: tsISO(45), sample_stack: "TypeError: Cannot read properties of undefined (reading 'map')\n    at CanvasSurface (CanvasSurface-AOAhM.js:1:21733)\n    at renderWithHooks (vendor-react.js:1:88012)" },
    { message: 'AbortError: The operation was aborted.', kind: 'unhandledrejection', occurrences: 88, sessions: 52, users: 33, first_seen: tsISO(9000), last_seen: tsISO(120), sample_stack: 'AbortError: The operation was aborted.\n    at loadBoardSnapshot (supabase.js:1:4021)' },
    { message: 'NetworkError when attempting to fetch resource.', kind: 'window', occurrences: 41, sessions: 30, users: 24, first_seen: tsISO(6000), last_seen: tsISO(300), sample_stack: 'NetworkError when attempting to fetch resource.\n    at flushAnalytics (analytics.js:1:5532)' },
    { message: "ReferenceError: foo is not defined", kind: 'react', occurrences: 12, sessions: 8, users: 6, first_seen: tsISO(2000), last_seen: tsISO(900), sample_stack: 'ReferenceError: foo is not defined\n    at DocPageEditor (DocPageEditor.js:1:9921)' },
  ],
  admin_recent_errors: Array.from({ length: 12 }, (_, i) => ({
    id: `e${i}`, occurred_at: tsISO(15 + i * 37),
    kind: ['window', 'unhandledrejection', 'react'][i % 3],
    name: ['TypeError', 'AbortError', 'ReferenceError'][i % 3],
    message: ["Cannot read properties of undefined (reading 'map')", 'The operation was aborted.', 'foo is not defined'][i % 3],
    path: ['/admin?tab=analytics', '/b/abc', '/welcome'][i % 3], release: 'f387d50',
    user_id: i % 4 ? `u-${i % 20}` : null, session_id: `s-${i}`,
    stack: "TypeError: Cannot read properties of undefined (reading 'map')\n    at CanvasSurface (CanvasSurface.js:1:21733)\n    at renderWithHooks (vendor-react.js:1:88012)\n    at mountIndeterminateComponent (vendor-react.js:1:91002)",
    component_stack: '\n    at CanvasSurface\n    at App\n    at TierRouter',
  })),
};

// ── table fixtures (for supabase.from(...).select()...) ──────────────
const waitlistEntries = Array.from({ length: 24 }, (_, i) => {
  const status = ['pending', 'pending', 'accepted', 'pending', 'rejected', 'accepted'][i % 6];
  return {
    id: `w-${i}`, email: `${NAMES[i % NAMES.length]}${i}@waitlist.co`,
    links: [`https://instagram.com/${NAMES[i % NAMES.length]}`, `https://${NAMES[i % NAMES.length]}.com`],
    status,
    scheduled_accept_at: status === 'pending' && i % 3 === 0 ? tsISO(-1440 * (i % 5 + 1)) : null,
    accepted_at: status === 'accepted' ? tsISO(1440 * i) : null,
    rejected_at: status === 'rejected' ? tsISO(1440 * i) : null,
    created_at: tsISO(1440 * (i + 1) + 30),
  };
});

const TABLES = {
  waitlist_entries: waitlistEntries,
  tags, workspaces: tagWorkspaces, tag_centroids: tagCentroids,
  card_embeddings: cardEmbeddings, entity_links: appliedLinks,
  card_index: cardIndexRows, tag_eval_labels: tagEvalLabels,
};

// ── mock supabase shim ──────────────────────────────────────────────
// admin_top_users is called with { p_tier } — route to the right list.
function rpcResult(name, params) {
  if (name === 'admin_top_users') {
    const v = params?.p_tier === 'paid' ? RPCS.admin_top_users_paid
      : params?.p_tier === 'demo' ? RPCS.admin_top_users_demo
      : [...RPCS.admin_top_users_paid, ...RPCS.admin_top_users_demo].slice(0, params?.p_limit || 20);
    return v;
  }
  return Object.prototype.hasOwnProperty.call(RPCS, name) ? RPCS[name] : null;
}

function makeBuilder(table) {
  const rows = TABLES[table] || [];
  const st = { head: false, count: rows.length, from: null, to: null, limit: null };
  const b = {
    select(_cols, opts) { if (opts && opts.head) st.head = true; return b; },
    eq() { return b; }, neq() { return b; }, is() { return b; }, in() { return b; },
    ilike() { return b; }, like() { return b; }, gte() { return b; }, lte() { return b; }, not() { return b; },
    order() { return b; },
    range(f, t) { st.from = f; st.to = t; return b; },
    limit(n) { st.limit = n; return b; },
    maybeSingle() { return Promise.resolve({ data: rows[0] ?? null, error: null }); },
    single() { return Promise.resolve({ data: rows[0] ?? null, error: null }); },
    then(res, rej) {
      let data = rows;
      if (st.from != null) data = rows.slice(st.from, st.to + 1);
      else if (st.limit != null) data = rows.slice(0, st.limit);
      return Promise.resolve({ data: st.head ? null : data, error: null, count: st.count }).then(res, rej);
    },
    catch(rej) { return this.then(undefined, rej); },
    finally(fn) { return Promise.resolve().finally(fn); },
  };
  return b;
}

// Monkeypatch the shared supabase singleton's data methods. Non-invasive: the
// admin tabs import this same instance, so no tab / useAdminData / supabase.js
// edits are needed. Returns false if the client is null (env not configured).
export function installAdminPreviewMocks(supabase) {
  if (!supabase) return false;
  supabase.rpc = (name, params) =>
    Promise.resolve({ data: rpcResult(name, params), error: null });
  supabase.from = (table) => makeBuilder(table);
  return true;
}
