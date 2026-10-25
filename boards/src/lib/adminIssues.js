// adminIssues.js — the words and shapes behind Admin, Errors (the Issues view).
//
// Pure, so node can test it: the lenses and statuses the view offers (0582's
// admin_error_groups refuses any other), what each kind, source and failed
// action is called on screen, how a row's steps read, and one browser's trail
// merged into a single timeline.

// What admin_error_groups calls p_lens. adminIssues.test.mjs holds these to
// the lenses 0582's _error_lens_ok knows.
export const ISSUE_LENSES = Object.freeze([
  { id: 'problems', label: 'Everything', title: 'Every problem but the monitors' },
  { id: 'crashes', label: 'Crashes', title: 'Someone saw a crash screen' },
  { id: 'requests', label: 'Requests', title: 'A request to our servers failed' },
  { id: 'stuck', label: 'Stuck & slow', title: 'A load, a save or live sync that never finished, and slow requests' },
  { id: 'servers', label: 'Servers', title: 'Failures on the Worker, live sync, edge functions and the database' },
  { id: 'monitors', label: 'Monitors', title: 'CSP reports, slow frames and the SEO and AEO probes' },
]);

export const ISSUE_STATUSES = Object.freeze([
  { id: 'open', label: 'Open' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'muted', label: 'Muted' },
  { id: 'all', label: 'All' },
]);

export const ISSUE_ENVS = Object.freeze([
  { id: 'prod', label: 'Production' },
  { id: 'preview', label: 'Preview' },
  { id: 'all', label: 'All' },
]);

const KIND_LABELS = {
  window: 'Uncaught error',
  unhandledrejection: 'Unhandled rejection',
  react: 'Render error',
  render: 'Crash screen',
  surface: 'Panel crashed',
  http: 'Request failed',
  toast: 'Error shown',
  resource: "Didn't load",
  console: 'Console error',
  stuck: 'Stuck',
  sync: 'Live sync',
  save: 'Save failed',
  cron: 'Cron job',
  pg_net: 'Server call',
  error_watch: 'Error watch',
  csp_violation: 'CSP report',
  perf: 'Slow frames',
  seo_health: 'SEO probe',
  discovery_pipeline: 'Discovery',
  aeo_probe: 'AEO probe',
  'chunk-recover': 'Stale code',
  'dom-mutated': 'Page altered',
  'realtime-unavailable': 'Realtime down',
  warn: 'Warning',
  route: 'Route failed',
  api: 'API failed',
  job: 'Background job',
  degraded: 'Served without data',
  room_save: 'Live sync save',
  room_load: 'Live sync load',
  room: 'Live sync room',
  op_log: 'Change history',
  alert: 'Alert not raised',
  doc_room: 'Shared doc room',
  bridge: 'Shared doc mirror',
  access_check: 'Access check',
};

export function kindLabel(kind) {
  if (!kind) return 'Error';
  return KIND_LABELS[kind] || String(kind).replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

const SOURCE_LABELS = {
  client: 'Browser',
  worker: 'Worker',
  party: 'Live sync server',
  edge: 'Edge function',
  db: 'Database',
};

export function sourceLabel(source) {
  return SOURCE_LABELS[source] || source || 'Browser';
}

const SEVERITY_LABELS = { crash: 'Crash', error: 'Error', warning: 'Warning' };

export function severityLabel(severity) {
  return SEVERITY_LABELS[severity] || 'Error';
}

// 0581's rules, in its words.
const RULE_LABELS = {
  wont_open: "The app won't open",
  saves: 'Saves are failing',
  sign_in: 'Sign-in is failing',
  payments: 'Payments are failing',
  widespread: 'One problem is widespread',
  check_failed: 'The breaking check failed',
};

export function ruleLabel(rule) {
  return RULE_LABELS[rule] || rule || '';
}

// What 0581's dry run says it would do, said as what happens: the real check
// runs every five minutes, so "would email" is an email on its way.
export function breakingOutcome(outcome) {
  if (!outcome) return '';
  if (outcome === 'would email') return 'emails within 5 minutes';
  if (String(outcome).startsWith('would record')) return "recorded, not emailed: today's 6 emails are used";
  return outcome;
}

// Failed actions read as what the person was trying to do. Anything not named
// here still reads: "cards_move_fail" is "Cards move".
const FAILURE_LABELS = {
  otp_verify_error: 'Sign-in code',
  email_submit_error: 'Sign-in email',
  landing_callback_error: 'Sign-in link',
  oauth_authorize_error: 'Connect an app',
  checkout_error: 'Checkout',
  checkout_verify_result: 'Checkout confirmation',
  billing_portal_error: 'Billing portal',
  storage_addon_fail: 'Storage add-on',
  web_image_save: 'Save a dropped image',
  files_move: 'Move files',
  files_delete: 'Delete files',
  files_put: 'Put files on a cluster',
  folder_import: 'Import a folder',
  import_job: 'Bulk import',
  msg_send: 'Send a message',
  msg_action: 'Message action',
  file_share_fail: 'Share a file',
  shared_file_save: 'Save a shared file',
  shared_file_shortcut: 'Add a shared file',
  invite_link_claim_failed: 'Join by invite link',
  invite_link_claim_result: 'Join by invite link',
  workspace_link_claim_result: 'Join a workspace',
  workspace_link_landed: 'Open a workspace link',
  editor_limit_refused: 'Add an editor (limit)',
  editor_limit_make_room: 'Free an editor place',
  card_create_stuck: 'Create a card (stuck)',
  cluster_create_fail: 'Create a cluster',
  cards_move_fail: 'Move cards',
  mobile_lift_cancelled: 'Lift a card (phone)',
  export_error: 'Export',
  film_fail: 'Play a film',
  remix_failed: 'Remix a cluster',
  setup_error: 'Workspace setup',
  onboarding_seed_failed: 'First cluster',
  onboarding_first_source_failed: 'First source',
  onboarding_settings_persist_failed: 'Save onboarding answers',
  scout_signup_error: 'Scout sign-up',
  submit_socials_error: 'Waitlist links',
};

export function failureLabel(event) {
  if (!event) return '';
  if (FAILURE_LABELS[event]) return FAILURE_LABELS[event];
  const words = String(event).replace(/_(error|fail|failed|result)$/, '').replace(/_/g, ' ');
  return words.replace(/^./, (c) => c.toUpperCase());
}

// One breadcrumb (0580's _client_error_crumbs: {t, k, n}): t is ms before the
// error, k a fixed kind, n a name with no content in it.
const CRUMB_VERBS = {
  nav: 'Went to',
  ev: '',
  toast: 'Saw error',
  http: 'Request',
  net: 'Network',
  vis: 'Tab',
  err: 'Error',
};

export function crumbText(c) {
  if (!c || typeof c !== 'object') return '';
  const verb = CRUMB_VERBS[c.k];
  const name = String(c.n ?? '');
  return verb ? `${verb} ${name}` : name;
}

// "12.4s before", "3m 05s before"; 0 is "at the error".
export function beforeText(ms) {
  const n = Math.abs(Number(ms) || 0);
  if (n < 50) return 'at the error';
  if (n < 60000) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}s before`;
  const m = Math.floor(n / 60000);
  const s = Math.round((n % 60000) / 1000);
  return `${m}m ${String(s).padStart(2, '0')}s before`;
}

// A signed offset from the moment a trail is centred on: "−2m 10s", "+4s".
export function offsetText(ms) {
  const n = Number(ms) || 0;
  const a = Math.abs(n);
  const sign = n < 0 ? '−' : '+';
  if (a < 1000) return '0s';
  if (a < 60000) return `${sign}${Math.round(a / 1000)}s`;
  const m = Math.floor(a / 60000);
  const s = Math.round((a % 60000) / 1000);
  return `${sign}${m}m ${String(s).padStart(2, '0')}s`;
}

// The context worth a chip, in reading order, never the raw object.
export function contextChips(ctx) {
  if (!ctx || typeof ctx !== 'object') return [];
  const out = [];
  if (ctx.op) out.push(`op ${ctx.op}`);
  if (ctx.code) out.push(`code ${ctx.code}`);
  if (ctx.phase) out.push(`phase ${ctx.phase}`);
  if (ctx.surface) out.push(ctx.surface);
  const h = ctx.http;
  if (h && typeof h === 'object') {
    const route = [h.method, h.svc && h.route ? `${h.svc}/${h.route}` : (h.svc || h.route)].filter(Boolean).join(' ');
    if (route) out.push(route);
    if (h.status != null) out.push(String(h.status));
    if (h.pg) out.push(h.pg);
    if (h.ms != null) out.push(`${h.ms}ms`);
  } else if (ctx.ms != null) {
    out.push(`${ctx.ms}ms`);
  }
  if (ctx.attempt != null) out.push(`attempt ${ctx.attempt}`);
  if (ctx.online === false) out.push('offline');
  if (ctx.vis && ctx.vis !== 'visible') out.push(`tab ${ctx.vis}`);
  if (ctx.tag) out.push(ctx.tag);
  if (ctx.host) out.push(ctx.host);
  return out;
}

const TRACE_EVENTS = new Set(['app_trace', 'lp_trace', 'up_trace', 'ps_trace']);

// What an analytics event in a trail says in a line: its name and the few
// props that explain it. A trace row is its dead and rage clicks.
export function eventSummary(e) {
  if (!e) return '';
  const p = e.props && typeof e.props === 'object' ? e.props : {};
  if (TRACE_EVENTS.has(e.event)) {
    const recs = Array.isArray(p.ev) ? p.ev : [];
    const dead = recs.filter((r) => r?.k === 'dead').length;
    const rage = recs.filter((r) => r?.k === 'rage').length;
    const bits = [];
    if (dead) bits.push(`${dead} dead click${dead === 1 ? '' : 's'}`);
    if (rage) bits.push(`${rage} rage click${rage === 1 ? '' : 's'}`);
    return bits.length ? bits.join(', ') : 'trace';
  }
  const keys = ['ok', 'outcome', 'result', 'status', 'code', 'reason', 'phase', 'action', 'surface', 'source', 'kind', 'n'];
  const bits = [];
  for (const k of keys) {
    if (p[k] == null || typeof p[k] === 'object') continue;
    bits.push(`${k} ${String(p[k]).slice(0, 40)}`);
    if (bits.length >= 4) break;
  }
  return bits.join(' · ');
}

// admin_error_session_trail's three lists as one timeline, oldest first, each
// with its offset from the moment the trail is centred on. `is` says which list
// an item came from; the key isn't `type`, which errorToastContract.test.mjs
// reads as a toast's.
export function trailItems(trail) {
  if (!trail) return [];
  const at = Date.parse(trail.at) || 0;
  const items = [];
  for (const e of trail.errors || []) {
    items.push({ is: 'error', key: `e:${e.id}`, at: e.at, row: e });
  }
  for (const [i, e] of (trail.events || []).entries()) {
    items.push({ is: 'event', key: `v:${i}:${e.at}`, at: e.at, row: e });
  }
  for (const f of trail.feedback || []) {
    items.push({ is: 'feedback', key: `f:${f.id}`, at: f.at, row: f });
  }
  items.sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0) || a.is.localeCompare(b.is));
  return items.map((it) => ({ ...it, offset: (Date.parse(it.at) || 0) - at }));
}

// One problem as plain text, to paste into an issue or a debugging session.
export function issueText(g, detail) {
  if (!g) return '';
  const lines = [
    `problem: ${g.message || ''}`,
    `kind: ${g.kind || ''} · ${severityLabel(g.severity)} · ${sourceLabel(g.source)}`,
    `status: ${g.status || 'open'}`,
    `people: ${g.people ?? ''} · occurrences: ${g.n ?? ''} (all time ${g.all_time ?? ''})`,
    `first seen: ${g.first_seen || ''}${g.first_release ? ` (${g.first_release})` : ''}`,
    `last seen: ${g.last_at || ''}${g.last_release ? ` (${g.last_release})` : ''}`,
    `fingerprint: ${g.fingerprint || ''}`,
  ];
  if (g.path) lines.push(`path: ${g.path}`);
  const occ = detail?.occurrences?.[0];
  if (occ) {
    lines.push('', 'latest occurrence:');
    lines.push(`at: ${occ.at || ''} · ${occ.env || 'prod'} · ${occ.release || ''} · ${occ.ua || ''}`);
    const chips = contextChips(occ.context);
    if (chips.length) lines.push(`context: ${chips.join(' · ')}`);
    if (Array.isArray(occ.breadcrumbs) && occ.breadcrumbs.length) {
      lines.push('steps:');
      for (const c of occ.breadcrumbs) lines.push(`  ${beforeText(c.t)}: ${crumbText(c)}`);
    }
    if (occ.stack) lines.push('', 'stack:', occ.stack);
  }
  return lines.join('\n');
}
