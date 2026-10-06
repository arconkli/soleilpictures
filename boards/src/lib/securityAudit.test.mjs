// The 2026-10-06 security audit, run after the 2026-09-20 invite blast.
//
// An adversarial pass traced every way one account can make us email someone,
// every way we could fail to notice, and every way a tenant boundary could be
// crossed. Each fix below is pinned at the source — the latest migration
// definition, the edge template, the Worker — so it cannot quietly come back.
// inviteAbuse.test.mjs pins the 0358/0359 half of the same story.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { latestDefinition, latestPolicy, latestMatch, migrationFiles, MIGRATIONS_DIR } from './migrationText.mjs';
import { safeLabel } from '../../../supabase/functions/_shared/email/safeLabel.mjs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const templates = read('../../../supabase/functions/_shared/email/templates.ts');
const URLISH = /https?:|www\.|\b[\p{L}\p{N}-]+\.(?:com|ru|google|ly|app|net|org|example)\b/iu;

function caseBlock(name) {
  const start = templates.indexOf(`case "${name}"`);
  assert.ok(start > 0, `templates.ts has no case "${name}"`);
  const next = templates.indexOf('case "', start + 10);
  return templates.slice(start, next > 0 ? next : undefined);
}

function constant(body, name) {
  const m = body.match(new RegExp(`${name}\\s+constant\\s+int\\s*:=\\s*(\\d+)`));
  assert.ok(m, `missing constant ${name}`);
  return Number(m[1]);
}

// ── 0364: the mention relay ──────────────────────────────────────────────────

test('a comment mention is capped, deduped, and filed under the board\'s own workspace', () => {
  const def = latestDefinition('notify_comment_mention').body;
  assert.ok(constant(def, 'c_max_recipients') <= 20, 'at most 20 people per call');
  assert.ok(constant(def, 'c_max_per_hour') <= 30, 'at most 30 notifications per sender per hour');
  assert.match(def, /pg_advisory_xact_lock\(hashtext\('mention_budget:'/, 'the hourly count is race-safe');
  assert.match(def, /public\._actor_active\(\)/, 'a suspended account notifies nobody');
  // The caller's p_workspace_id was taken on trust; the board's own is used now.
  assert.match(def, /select b\.workspace_id into v_ws/);
  assert.doesNotMatch(def, /select distinct t\.uid, null, p_workspace_id/);
  assert.match(def, /source_thread_id is not distinct from p_thread_id[\s\S]*interval '10 minutes'/,
    'the same person about the same thread at most once per 10 minutes');
});

test('a chat mention gets the same hourly cap and dedupe on top of 0360\'s filter', () => {
  const def = latestDefinition('messages_fire_mention_notifications').body;
  assert.ok(constant(def, 'c_max_per_hour') <= 30);
  assert.match(def, /cp\.left_at is null/, '0360: only active participants');
  assert.match(def, /public\.can_message\(t\.uid\)/, '0360: only people the sender can message');
  assert.match(def, /m\.conversation_id = new\.conversation_id[\s\S]*interval '10 minutes'/);
});

test('one person\'s mentions or replies reach one inbox at most 5 times a day', () => {
  for (const fn of ['_tg_mention_notification_email', '_tg_comment_reply_email']) {
    const def = latestDefinition(fn).body;
    assert.match(def, /interval '24 hours'\) >= 5 then\s+return new;/, `${fn} must cap per recipient and sender`);
  }
});

test('a preview someone typed is cleaned like a name, links and all', () => {
  assert.ok(caseBlock('mention_email').includes('safeLabel(data.messagePreview, 280)'));
  assert.ok(caseBlock('comment_reply_email').includes('safeLabel(data.replyPreview, 280)'));
  assert.doesNotMatch(templates, /String\(data\.(messagePreview|replyPreview)\b/,
    'a raw preview is the 0364 relay coming back');
  const lure = 'Your account is locked — verify now at https://secure-login.example/x or www.evil.example';
  const out = safeLabel(lure, 280);
  assert.doesNotMatch(out, URLISH, `kept a link: ${JSON.stringify(out)}`);
  assert.ok(out.startsWith('Your account is locked'), 'the words survive; only the link goes');
});

test('the invitation a stranger reads carries nothing anyone typed in its subject', () => {
  const start = templates.indexOf('function pendingInvite');
  const fn = templates.slice(start, templates.indexOf('\nfunction ', start + 10));
  const subject = fn.match(/subject:\s*([^\n]+)/)[1];
  assert.doesNotMatch(subject, /\$\{/, `pending_invite subject interpolates: ${subject}`);
});

// ── 0364: alerts nobody can silence ──────────────────────────────────────────

test('clients cannot write the rows an alert is deduped against', () => {
  const policy = latestPolicy('anyone insert client_errors').body;
  for (const kind of ['discovery_pipeline', 'aeo_probe', 'seo_health']) {
    assert.ok(policy.includes(`'${kind}'`), `client_errors must refuse kind ${kind} from clients`);
  }
  assert.doesNotMatch(policy, /with check\s*\(\s*true\s*\)/i);
  assert.ok(latestMatch(/create trigger client_errors_clamp_time\s+before insert on public\.client_errors/),
    'a future occurred_at must be clamped on insert');
  const alert = latestDefinition('_discovery_alert').body;
  assert.match(alert, /occurred_at <= now\(\) \+ interval '5 minutes'/,
    'a row from the future is never "already fired"');
});

// ── 0364: grants and the actor check ─────────────────────────────────────────

test('internal storage helpers are not client-callable', () => {
  for (const sig of [
    '_storage_usage_apply\\(uuid, bigint, bigint\\)',
    '_storage_used_bytes\\(uuid\\)',
    '_storage_quota_bytes\\(uuid\\)',
    '_image_owner\\(uuid\\)',
  ]) {
    assert.ok(latestMatch(new RegExp(`revoke execute on function public\\.${sig}\\s+from public, anon, authenticated`)),
      `${sig} must be revoked from public, anon and authenticated`);
  }
});

test('_actor_active fails closed for a signed-in caller and stays open for anon', () => {
  const def = latestDefinition('_actor_active').body;
  assert.match(def, /when auth\.uid\(\) is null then true/, 'public reads pass through it');
  assert.match(def, /where p\.user_id = auth\.uid\(\)\), false\)/, 'no profile row means not active');
});

// ── 0366 + Worker: tenant boundaries and the MCP scope gate ─────────────────

test('a card_index row must belong to its board\'s workspace', () => {
  const p = latestPolicy('card_index insert').body;
  assert.match(p, /_board_in_workspace\(board_id, workspace_id\)/);
});

test('comments keep their author and thread, and move only where the author may comment', () => {
  assert.match(latestPolicy('comments update self or editor').body, /can_comment_board\(board_id\)/);
  assert.match(latestDefinition('_tg_comments_immutable').body, /new\.author is distinct from old\.author/);
  assert.match(latestPolicy('comments insert').body, /comment_reply_on_board\(reply_to, board_id\)/);
});

test('a public image key must be an image of that card\'s own board', () => {
  const def = latestDefinition('get_public_board_content').body;
  assert.match(def, /img\.storage_path is not null/);
  assert.match(def, /img\.board_id = p\.board_id or img\.referenced_in_board_ids @> array\[p\.board_id\]/);
  assert.ok(latestMatch(/add constraint boards_thumb_key_own_thumbnail/));
});

test('every route into the API dispatcher meets the scope for its method (MCP included)', () => {
  const api = read('../worker-api.js');
  const start = api.indexOf('async function dispatch(');
  const head = api.slice(start, start + 1500);
  assert.match(head, /if \(!hasScope\(auth, need\)\)/, 'dispatch must re-check the scope MCP tools reach it with');
});

// ── Worker + client: what a visitor's browser is handed ─────────────────────

const worker = read('../worker.js');

test('navigable image routes never echo the uploader\'s content-type', () => {
  assert.doesNotMatch(worker, /'content-type': obj\.httpMetadata\?\.contentType \|\| imgContentType\(key\)/,
    'a stored content-type is the uploader\'s claim, and SVG/HTML from our origin runs script');
  for (const fn of ['handlePublicThumb', 'handlePublicImg', 'handleAdminPreviewImg', 'handleAdminPreviewThumb']) {
    const start = worker.indexOf(`async function ${fn}(`);
    const body = worker.slice(start, worker.indexOf('\n}\n', start));
    assert.match(body, /safeRasterType\(obj\.httpMetadata\?\.contentType, key\)/, `${fn} must force a raster type`);
    assert.match(body, /'content-security-policy': IMAGE_ONLY_CSP/, `${fn} must sandbox what it serves`);
  }
  const set = worker.match(/SAFE_RASTER_TYPES = new Set\(\[([^\]]+)\]\)/)[1];
  assert.doesNotMatch(set, /svg|html|xml/, 'SVG is a document that can carry script, not a raster');
});

test('our edge never hands a CSP nonce to anything under /api/', () => {
  assert.match(worker, /const isHtml = nonce && !String\(path\)\.startsWith\('\/api\/'\)/);
});

test('the anonymous link-preview fetch is rate limited per address', () => {
  assert.match(worker, /const ogAllow = makeRateLimiter\(\{ perMinute: \d+ \}\)/);
  assert.match(worker, /if \(!ogAllow\(request\.headers\.get\('cf-connecting-ip'\)/);
});

test('a typed link can never become a script URL in an href', async () => {
  const { safeExternalHref } = await import('./safeExternalHref.js');
  for (const bad of ['javascript:alert(1)', ' JAVASCRIPT:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<script>x</script>', 'vbscript:x']) {
    const out = safeExternalHref(bad);
    assert.match(out, /^https:\/\//, `${JSON.stringify(bad)} became ${JSON.stringify(out)}`);
  }
  assert.equal(safeExternalHref('https://example.com/a'), 'https://example.com/a');
  assert.equal(safeExternalHref('example.com'), 'https://example.com');
  assert.equal(safeExternalHref('mailto:ana@example.com'), 'mailto:ana@example.com');
  assert.equal(safeExternalHref(''), null);
  for (const [file, expr] of [
    ['../components/cards.jsx', 'safeExternalHref(link)'],
    ['../components/MessageBubble.jsx', 'safeExternalHref(att.href)'],
    ['../components/AdminBoardPreviewModal.jsx', 'safeExternalHref(c.href)'],
    ['../components/cards/ScheduleCard.jsx', 'safeExternalHref(cell.source || cell.link)'],
    ['../components/cards/gridCellShared.jsx', 'safeExternalHref(cell.source || cell.link)'],
  ]) {
    assert.ok(read(file).includes(`href={${expr}`), `${file} must bind ${expr}`);
  }
});

// ── 0369 + 0370: the outbound breaker ───────────────────────────────────────

const STRANGER = ['pending_invite', 'board_shared', 'workspace_invite'];
const MEMBER = ['mention_email', 'comment_reply_email', 'schedule_update', 'invite_accepted'];

// Functions whose live (latest, not since dropped) definition matches `re`,
// with what each match captured.
function liveFunctionsMatching(re) {
  const names = new Set();
  for (const f of migrationFiles()) {
    const sql = readFileSync(MIGRATIONS_DIR + f, 'utf8');
    for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?(\w+)\s*\(/gi)) names.add(m[1]);
  }
  const out = new Map();
  for (const name of names) {
    let alive = false;
    const create = new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?${name}\\s*\\(`, 'gi');
    const drop = new RegExp(`drop\\s+function\\s+(?:if\\s+exists\\s+)?(?:public\\.)?${name}\\s*\\(`, 'gi');
    for (const f of migrationFiles()) {
      const sql = readFileSync(MIGRATIONS_DIR + f, 'utf8');
      const events = [...sql.matchAll(create)].map((m) => [m.index, true])
        .concat([...sql.matchAll(drop)].map((m) => [m.index, false]))
        .sort((a, b) => a[0] - b[0]);
      for (const [, created] of events) alive = created;
    }
    if (!alive) continue;
    const hits = [...latestDefinition(name).body.matchAll(re)].map((m) => m[1]);
    if (hits.length) out.set(name, hits);
  }
  return out;
}

test('every database email asks the outbound gate first, and only the known triggers send', () => {
  const notify = latestDefinition('_notify_email').body;
  const gate = notify.indexOf('public._outbound_gate(');
  assert.ok(gate > 0 && notify.indexOf('public._notify_email_send(') > gate,
    '_notify_email must consult _outbound_gate before it sends');
  assert.match(notify, /<> 'send' then\s+return;/, 'anything but "send" stops the email');

  const senders = liveFunctionsMatching(/perform\s+(?:public\.)?_notify_email\(\s*'([a-z_]+)'/g);
  assert.deepEqual([...senders.keys()].sort(), [
    '_tg_comment_reply_email', '_tg_mention_notification_email', '_tg_pending_invite_email',
    '_tg_schedule_notification_email', '_tg_share_notification_email', '_tg_workspace_member_email',
  ], 'a new email path must be classified in _outbound_gate and added here on purpose');
  const gateBody = latestDefinition('_outbound_gate').body;
  for (const t of new Set([...senders.values()].flat())) {
    assert.ok(STRANGER.includes(t) || MEMBER.includes(t), `template ${t} is in neither risk class`);
    assert.ok(gateBody.includes(`'${t}'`), `_outbound_gate does not classify ${t}`);
  }
  // Around the gate: only _notify_email and an admin releasing held mail may
  // send directly, and only they and the alert dispatcher call the edge sender.
  assert.deepEqual([...liveFunctionsMatching(/perform\s+(?:public\.)?_notify_email_send\((\s*)/g).keys()].sort(),
    ['_notify_email', 'admin_outbound_release_held']);
  assert.deepEqual([...liveFunctionsMatching(/(send-transactional-email)/g).keys()].sort(),
    ['_notify_email_send', 'ops_alert_dispatch']);
});

test('an account on a sending hold invites nobody, mentions nobody, and its mail is held', () => {
  const budget = latestDefinition('_invite_budget_take').body;
  const hold = budget.indexOf('send_hold_at is not null');
  assert.ok(hold > 0 && hold < budget.indexOf('pg_advisory_xact_lock'), 'the hold is checked first');
  assert.match(budget, /raise exception 'invite limit reached: sharing is paused/,
    'the refusal starts with the phrase ShareModal stops its loop on');
  assert.match(latestDefinition('notify_comment_mention').body, /if not public\._actor_can_send\(\) then\s+return 0;/);
  assert.match(latestDefinition('messages_fire_mention_notifications').body,
    /p\.user_id = new\.sender_id and p\.send_hold_at is not null\) then\s+return new;/);
  const gate = latestDefinition('_outbound_gate').body;
  assert.match(gate, /p\.send_hold_at is not null\) then\s+v_state := 'hold'; v_reason := 'sender_on_hold';/);
  assert.match(gate, /exception when others then[\s\S]*return 'hold';\s*end;\s*\$\$;$/, 'an error inside the gate holds');
});

test('the breaker trips on volume, a release restarts its count, and alerts reach a person', () => {
  const gate = latestDefinition('_outbound_gate').body;
  assert.match(gate, /pg_advisory_xact_lock\(hashtext\('outbound_breaker:stranger'\)\)/, 'stranger counts are race-safe');
  assert.match(gate, /coalesce\(v_released, '-infinity'::timestamptz\)/, 'a release restarts the count');
  assert.match(gate, /perform public\._hold_new_senders\(c_new_h\);/, 'a trip holds the new accounts that were sending');
  assert.match(gate, /v_state := 'drop'; v_reason := 'recipient_never_opened_app';/,
    'member mail goes only to people who have opened the app');
  assert.match(latestDefinition('ops_alert_dispatch').body, /'template', 'ops_alert'/);
  assert.ok(latestMatch(/cron\.schedule\('ops-alert-dispatch',\s+'\* \* \* \* \*'/), 'alerts go out every minute');
  assert.ok(latestMatch(/cron\.schedule\('ops-heartbeat-weekly',/), 'a weekly heartbeat proves the alert path is alive');
  assert.ok(latestMatch(/cron\.schedule\('abuse-signals',/), 'signup spikes and undecided held mail page');
});

test('the breaker\'s tables and helpers are server-only, and its admin RPCs are gated', () => {
  for (const t of ['ops_alerts', 'outbound_ledger', 'outbound_breaker']) {
    assert.ok(latestMatch(new RegExp(`alter table public\\.${t} enable row level security`)), `${t} needs RLS`);
    assert.ok(latestMatch(new RegExp(`revoke all on table public\\.${t} from public, anon, authenticated`)), `${t} must be server-only`);
  }
  for (const sig of [
    '_outbound_gate\\(text, text, jsonb\\)', '_notify_email_send\\(text, text, jsonb, uuid\\)',
    '_hold_sending\\(uuid, text, text\\)', '_hold_new_senders\\(integer\\)', '_actor_can_send\\(\\)',
    'ops_alert_raise\\(text, text, text, boolean, text, interval, uuid\\)', 'ops_alert_dispatch\\(\\)',
  ]) {
    assert.ok(latestMatch(new RegExp(`revoke execute on function public\\.${sig} from public, anon, authenticated`)),
      `${sig} must not be client-callable`);
  }
  for (const fn of ['admin_security_overview', 'admin_outbound_release_breaker', 'admin_outbound_release_held',
    'admin_outbound_drop_held', 'admin_hold_sending', 'admin_release_sending', 'admin_ops_alert_ack', 'admin_ops_alert_test']) {
    assert.match(latestDefinition(fn).body, /perform public\._require_admin\(\);/, `${fn} must be admin-only`);
  }
});
