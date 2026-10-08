// The 2026-10-06 security audit, run after the 2026-09-20 invite blast.
//
// An adversarial pass traced every way one account can make us email someone,
// every way we could fail to notice, and every way a tenant boundary could be
// crossed. Each fix below is pinned at the source — the latest migration
// definition, the edge template, the Worker — so it cannot quietly come back.
// inviteAbuse.test.mjs pins the 0358/0359 half of the same story.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
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

test('alerts go only to the owner, from the alerts address, and the sender checks its secret in constant time', () => {
  const sender = read('../../../supabase/functions/send-transactional-email/index.ts');
  assert.match(sender, /const to = body\.template === "ops_alert" \? OPS_ALERT_TO : body\.to;/,
    'a request must not be able to redirect a security alert');
  assert.match(sender, /const FROM_ALERTS\s+= "Clusters Alerts <alerts@clusters\.soleilpictures\.com>";/);
  assert.match(sender, /case "ops_alert":\s+return FROM_ALERTS;/, 'never the bulk updates. domain');
  assert.match(sender, /if \(!secretMatches\(token, SEND_EMAIL_SECRET\)\)/);
  assert.doesNotMatch(sender, /token !== SEND_EMAIL_SECRET/);
  assert.match(sender, /if \(await overHourlyCeiling\(body\.template\)\)/, 'the backstop ceiling runs before sending');
  assert.match(sender, /from\("ops_alerts"\)\.update\(\{ paged_at:/, 'a delivered alert is stamped, so it is not resent');
  assert.match(sender, /actor_id:\s+opts\.actorId \?\? null/, 'who caused an email is logged with it');
  assert.ok(caseBlock('ops_alert').includes('replace(/[\\r\\n\\t]+/g, " ")'), 'an alert title is one line');
});

test('one-click unsubscribe covers mentions and replies, and its three allowlists agree', () => {
  const sender = read('../../../supabase/functions/send-transactional-email/index.ts');
  const keyMap = Object.fromEntries([...sender.matchAll(/^\s+(\w+):\s+"(email_\w+)",$/gm)].map((m) => [m[1], m[2]]));
  assert.equal(keyMap.mention_email, 'email_mentions');
  assert.equal(keyMap.comment_reply_email, 'email_comment_replies');
  const listed = sender.match(/const LIST_UNSUB_TEMPLATES = new Set\(\[([^\]]+)\]\)/)[1];
  for (const t of ['mention_email', 'comment_reply_email']) assert.ok(listed.includes(`"${t}"`), `${t} needs the header`);
  assert.ok(caseBlock('mention_email').includes('unsubscribeToken: unsubTokenOf(data.unsubscribeToken)'));
  assert.ok(caseBlock('comment_reply_email').includes('unsubscribeToken: unsubTokenOf(data.unsubscribeToken)'));

  const rpcKeys = latestDefinition('email_unsubscribe').body.match(/p_key not in \(([^)]+)\)/)[1]
    .match(/'(\w+)'/g).map((s) => s.slice(1, -1)).sort();
  const workerKeys = Object.keys(Object.fromEntries(
    [...worker.match(/const UNSUB_LABELS = \{([\s\S]*?)\};/)[1].matchAll(/^\s+(\w+):/gm)].map((m) => [m[1], 1]))).sort();
  assert.deepEqual(workerKeys, rpcKeys, 'the Worker and email_unsubscribe() must accept the same keys');
  for (const k of new Set(Object.values(keyMap))) assert.ok(rpcKeys.includes(k), `${k} is sent but cannot be unsubscribed`);
  for (const fn of ['_tg_mention_notification_email', '_tg_comment_reply_email']) {
    assert.match(latestDefinition(fn).body, /'unsubscribeToken', \(select t\.token from public\.email_unsub_tokens t/,
      `${fn} must pass the recipient's own token`);
  }
});

test('the Security tab is admin-only, its alert link opens it, and it calls only admin-gated RPCs', () => {
  const panel = read('../components/SettingsPanel.jsx');
  const adminTabs = panel.slice(panel.indexOf('const ADMIN_TABS = ['), panel.indexOf('];', panel.indexOf('const ADMIN_TABS = [')));
  assert.match(adminTabs, /\{ id: 'security', label: 'Security', group: 'admin' \}/, 'Security belongs in the admin rail');
  const publicTabs = panel.slice(panel.indexOf('const TABS = ['), panel.indexOf('];', panel.indexOf('const TABS = [')));
  assert.doesNotMatch(publicTabs, /'security'/, 'a tab no non-admin can render stays out of TABS');
  assert.match(panel, /\{tab === 'security' && isAdmin && \(/, 'the pane re-checks isAdmin');

  const app = read('../App.jsx');
  assert.match(app, /get\('settings'\) === 'security'[\s\S]{0,120}if \(!wanted \|\| myTier\.loading\) return;\s+if \(captureAllowed\) openSettings\('security'\);/,
    'the alert email\'s ?settings=security waits for the tier and opens only for an admin');

  const api = read('./securityAdminApi.js');
  const rpcs = [...api.matchAll(/call\('(\w+)'/g)].map((m) => m[1]);
  assert.ok(rpcs.length >= 7);
  for (const fn of rpcs) {
    assert.match(fn, /^admin_/, `${fn} is not an admin RPC`);
    assert.match(latestDefinition(fn).body, /perform public\._require_admin\(\);/, `${fn} must be admin-gated`);
  }
  assert.doesNotMatch(api, /\.catch\(/, 'never .catch() a supabase.rpc() builder');
});

// ── 0371 + 0373: a ban takes things down; a suspended account acts on nothing ─

test('a banned account\'s shares and published clusters stop serving, and its invitations do nothing', () => {
  assert.match(latestDefinition('_resolve_share_target').body,
    /if public\._sharer_suspended\(v_creator\)\s+or exists \(select 1 from boards b join workspaces w on w\.id = b\.workspace_id\s+where b\.id = v_root and public\._user_banned\(w\.created_by\)\) then/);
  for (const fn of ['_resolve_published_board', 'list_public_boards', 'list_public_board_images', 'get_related_public_boards']) {
    const body = latestDefinition(fn).body;
    assert.match(body, /not public\._user_banned\(w\.created_by\)/, `${fn} must drop a banned owner's clusters`);
    assert.match(body, /not public\._user_banned\(pb\.submitted_by\)/, `${fn} must drop a banned submitter's clusters`);
  }
  for (const fn of ['_resolve_published_grid_layout', 'list_public_grid_layouts']) {
    assert.match(latestDefinition(fn).body, /not public\._user_banned\(g\.created_by\)/, fn);
  }
  assert.match(latestDefinition('get_grid_layout_by_token').body, /not public\._sharer_suspended\(g\.created_by\)/);
  assert.match(latestDefinition('claim_pending_invite').body,
    /if v_row\.held_at is not null or public\._sharer_suspended\(v_row\.invited_by\) then/);
  for (const fn of ['_claim_pending_invites_for_user', 'peek_pending_invite_email']) {
    assert.match(latestDefinition(fn).body, /and held_at is null\s+and not public\._sharer_suspended\(invited_by\)/, fn);
  }
  const collab = latestDefinition('claim_collab_link').body;
  assert.match(collab, /if public\._sharer_suspended\(v_link\.created_by\) then/);
  assert.match(collab, /if public\._user_banned\(v_owner\) then/);
});

test('a suspended account acts on nothing: links, workspaces, keys, OAuth, self-delete', () => {
  for (const fn of ['create_public_link', 'create_collab_link']) {
    assert.match(latestDefinition(fn).body, /if not public\._actor_can_send\(\) then/, `${fn}: a held or banned account makes no link`);
  }
  for (const fn of ['set_public_link_indexing', 'set_public_link_subboards', 'transfer_workspace_ownership',
    'delete_workspace', 'create_workspace_with_root', 'claim_pending_invite', 'claim_collab_link']) {
    assert.match(latestDefinition(fn).body, /if not public\._actor_active\(\) then/, `${fn} must check the caller`);
  }
  assert.match(latestDefinition('api_token_resolve').body,
    /if public\._user_banned\(t\.user_id\) then\s+return query select null::uuid, null::uuid, null::text\[\], 'revoked'::text/);
  assert.match(latestDefinition('oauth_code_redeem').body, /if public\._user_banned\(c\.user_id\) then/);
  assert.match(latestDefinition('oauth_refresh_rotate').body, /if public\._user_banned\(g\.user_id\) then/);
  assert.match(latestDefinition('prepare_account_deletion').body, /if public\._user_banned\(p_user_id\) then/);
  assert.match(latestDefinition('can_read_board').body, /or \(chain\.deleted_at is null and exists \(/,
    'a share on a cluster in the trash grants nothing');
});

test('every ban and sharing hold is recorded with evidence, and a ban ends every session', () => {
  const trg = latestDefinition('_tg_profiles_account_action').body;
  assert.match(trg, /delete from auth\.sessions s where s\.user_id = new\.user_id;/);
  assert.match(trg, /delete from public\.api_sessions a where a\.user_id = new\.user_id;/);
  assert.match(trg, /public\._account_evidence\(new\.user_id\)/);
  assert.ok(latestMatch(/create trigger profiles_account_action\s+after update of banned_at, send_hold_at on public\.profiles/));
  assert.ok(latestMatch(/user_id\s+uuid not null,\s+-- deliberately no foreign key/), 'the record must outlive the account');
  for (const sig of ['_user_banned\\(uuid\\)', '_sharer_suspended\\(uuid\\)', '_account_evidence\\(uuid\\)',
    '_tg_profiles_account_action\\(\\)', 'reconcile_storage_usage\\(\\)', 'purge_old_deleted_tags\\(\\)',
    'purge_old_deleted_vote_cards\\(\\)']) {
    assert.ok(latestMatch(new RegExp(`revoke execute on function public\\.${sig} from public, anon, authenticated`)),
      `${sig} must not be client-callable`);
  }
  const api = read('./securityAdminApi.js');
  assert.match(api, /banAccount = \(userId, reason\) => adminAccountAction\(\{ userId, action: 'ban', reason \}\)/,
    'Ban goes through admin-account-action, which also does the native auth ban');
});

// ── 0374: the live database re-checks all of this every day ─────────────────

test('the live database re-checks the audit\'s invariants daily and pages on a slip', () => {
  const def = latestDefinition('check_security_invariants').body;
  for (const key of ['http_post', 'notify_email', 'gate', 'helpers', 'open_insert', 'rls', 'alert_path']) {
    assert.ok(def.includes(`'invariant:${key}'`), `check_security_invariants lost its ${key} check`);
  }
  // Its sender allowlist is the same six triggers the repo says send email.
  const senders = liveFunctionsMatching(/perform\s+(?:public\.)?_notify_email\(\s*'([a-z_]+)'/g);
  for (const name of senders.keys()) assert.ok(def.includes(`'${name}'`), `${name} sends email but is not in the live allowlist`);
  assert.ok(latestMatch(/cron\.schedule\('security-invariants',/), 'the check must be scheduled');
  assert.ok(latestMatch(/revoke execute on function public\.check_security_invariants\(\) from public, anon, authenticated/));
});

test('every new internal helper is born server-only (the 0311 rule, linted from 0369 on)', () => {
  const seen = new Set();
  for (const f of migrationFiles()) {
    const sql = readFileSync(MIGRATIONS_DIR + f, 'utf8');
    const num = Number(f.slice(0, 4));
    for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?(_\w+)\s*\([^)]*\)\s*returns\s+(\w+)/gi)) {
      const [, name, ret] = m;
      const isNew = !seen.has(name);
      seen.add(name);
      if (num < 369 || !isNew || /^trigger$/i.test(ret)) continue;
      assert.match(sql, new RegExp(`revoke (?:execute|all) on function public\\.${name}\\(`),
        `${f}: new helper ${name} must revoke execute from public, anon, authenticated`);
    }
  }
});

// ── Phase 3: a captcha in front of the sign-in code ──────────────────────────

test('the sign-in code request carries a Turnstile token once a site key is built in', async () => {
  const ts = read('../auth/turnstile.js');
  assert.match(ts, /const SITE_KEY = import\.meta\.env\?\.VITE_TURNSTILE_SITE_KEY \|\| '';/);
  assert.doesNotMatch(ts, /^import /m, 'AuthGate stays import-light: turnstile.js imports nothing');
  // The script is fetched only inside loadTurnstile, i.e. when a code is requested.
  assert.equal((ts.match(/document\.createElement\('script'\)/g) || []).length, 1);
  assert.ok(ts.indexOf("document.createElement('script')") > ts.indexOf('function loadTurnstile'));
  const gate = read('../auth/AuthGate.jsx');
  assert.match(gate, /const challenge = captchaEnabled\(\) \? await captchaToken\(captchaRef\.current\) : '';/);
  assert.match(gate, /\.\.\.\(challenge \? \{ captchaToken: challenge \} : \{\}\)/);
  assert.match(gate, /<div ref=\{captchaRef\} className="auth-captcha" \/>/);
  const { classifyAuthError } = await import('./analyticsEvents.js');
  assert.equal(classifyAuthError(new Error('captcha protection: request disallowed (timeout-or-duplicate)')), 'captcha');
});

// ── 0375: an account's first days, and an invite budget per inbox ────────────

test('a brand-new account gets no keys, webhooks, connected apps, service accounts or indexable links', () => {
  const isNew = latestDefinition('_account_is_new').body;
  const hours = Number(isNew.match(/interval '(\d+) hours'/)[1]);
  const refuse = latestDefinition('_refuse_if_new').body;
  assert.match(refuse, /opens up once an account is three days old/);
  assert.equal(hours, 72, 'the refusal says three days, so the window must be 72 hours');
  for (const [fn, what] of [
    ['api_token_mint', 'Creating an API key'], ['api_token_mint_for', 'Creating a service token'],
    ['oauth_authorize_consent', 'Connecting an app'], ['webhook_create', 'Adding a webhook'],
    ['webhook_update', 'Pointing a webhook at a new address'], ['service_account_register', 'Adding a service account'],
    ['submit_board_to_explore', 'Submitting to Explore'], ['set_public_link_indexing', 'Letting search engines index a link'],
  ]) {
    assert.ok(latestDefinition(fn).body.includes(`_refuse_if_new('${what}')`), `${fn} must refuse a new account`);
  }
  for (const fn of ['api_token_mint', 'oauth_authorize_consent']) {
    assert.match(latestDefinition(fn).body, /if not public\._actor_active\(\) then/, `${fn} must refuse a suspended account`);
  }
  const ws = latestDefinition('create_workspace_with_root').body;
  assert.match(ws, /c_new_account_workspaces constant integer := \d+;/);
  assert.match(ws, /if public\._account_is_new\(\)\s+and \(select count\(\*\) from workspaces w where w\.created_by = uid\) >= c_new_account_workspaces then/);
  for (const sig of ['_account_is_new\\(\\)', '_refuse_if_new\\(text\\)']) {
    assert.ok(latestMatch(new RegExp(`revoke execute on function public\\.${sig} from public, anon, authenticated`)), sig);
  }
});

test('the invite budget belongs to the inbox, so plus-addressed accounts share it', () => {
  const def = latestDefinition('_invite_budget_take').body;
  assert.match(def, /public\._outbound_recipient_key\(u\.email\) into v_created, v_key/);
  assert.match(def, /where \(l\.inviter = v_uid or l\.identity_key = v_key\)/);
  assert.match(def, /insert into public\.invite_send_ledger \(inviter, identity_key\) values \(v_uid, v_key\);/);
  assert.match(def, /pg_advisory_xact_lock\(hashtext\('invite_budget:' \|\| coalesce\(v_key, v_uid::text\)\)\)/,
    'the lock is per inbox too, or two accounts on one inbox race the count');
});

// ── 0377: a referral pays once the friend is real, a few at a time ──────────

test('a referral pays the referrer only for an aged friend who opened the app, a few a month', () => {
  const pay = latestDefinition('_pay_referral_rewards').body;
  const num = (name) => Number(pay.match(new RegExp(`${name}\\s+constant\\s+integer\\s*:=\\s*(\\d+)`))[1]);
  const hours = num('c_mature_hours'), per30 = num('c_per_30_days'), cards = num('c_reward_cards');
  assert.ok(hours >= 72, 'the friend\'s account must be at least three days old');
  assert.ok(per30 <= 4, 'at most four rewards in 30 days');
  assert.match(pay, /u\.created_at <= now\(\) - make_interval\(hours => c_mature_hours\)/);
  assert.match(pay, /exists \(select 1 from public\.user_presence pr where pr\.user_id = rf\.referee_id\)/,
    'the friend has opened the app');
  assert.match(pay, /not public\._user_banned\(rf\.referee_id\)\s+and not public\._user_banned\(rf\.referrer_id\)/);
  assert.match(pay, /pg_advisory_xact_lock\(hashtext\('referral_rewards:' \|\| r\.referrer_id::text\)\)/,
    'the 30-day count is race-safe');
  assert.match(pay, /x\.reward_granted_at > now\(\) - interval '30 days'\) >= c_per_30_days then\s+continue;/);
  assert.ok(latestMatch(/cron\.schedule\('referral-rewards', '[^']+', \$\$select public\._pay_referral_rewards\(\)\$\$\)/),
    'waiting rewards are paid by a schedule');

  // Activation no longer pays on its own; it asks the payer, and a payout
  // failure must not undo it (_stamp_first_card fires once per account).
  const grant = latestDefinition('grant_referral_reward').body;
  assert.doesNotMatch(grant, /bonus_card_credits/, 'grant_referral_reward must not credit cards itself');
  assert.doesNotMatch(grant, /reward_granted_at\s*=\s*now\(\)/);
  assert.match(grant, /begin\s+perform public\._pay_referral_rewards\(p_referee\);\s+exception when others then/);

  // Every count shown to people is cards credited, at the payer's rate.
  for (const fn of ['get_my_referral_stats', 'admin_referral_stats']) {
    const body = latestDefinition(fn).body;
    assert.doesNotMatch(body, /filter \(where (?:r\.)?status = 'activated'\) \* \d+/, `${fn} must count credited cards`);
    const rates = [...body.matchAll(/\*\s*(\d+)/g)].map((m) => Number(m[1]));
    assert.ok(rates.length > 0 && rates.every((r) => r === cards), `${fn} must multiply by ${cards}`);
  }
  assert.match(latestDefinition('get_my_referral_stats').body,
    /count\(\*\) filter \(where status = 'activated' and reward_granted_at is null\)::integer\s+from public\.referrals/,
    'rewards_waiting is the last column, as boardsApi reads it');

  for (const sig of ['_pay_referral_rewards\\(uuid\\)', 'grant_referral_reward\\(uuid\\)']) {
    assert.ok(latestMatch(new RegExp(`revoke execute on function public\\.${sig} from public, anon, authenticated`)), sig);
  }
  assert.ok(latestMatch(/revoke execute on function public\.get_my_referral_stats\(\) from public, anon;/));

  // The Invite tab says the same numbers the payer enforces.
  const WORDS = { 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven' };
  assert.equal(hours % 24, 0);
  const tab = read('../components/settings/InviteTab.jsx');
  assert.ok(tab.includes(`You earn ${cards} cards for each friend who gets started`));
  assert.equal(tab.split(`${WORDS[hours / 24]} days old`).length - 1, 2, 'both hints name the waiting period');
  assert.ok(tab.includes(`for up to ${WORDS[per30]} friends a month`));
  assert.match(read('./boardsApi.js'), /rewardsWaiting:\s+Number\(row\?\.rewards_waiting \?\? 0\)/);

  // The public page states the rules from code, and no longer says invitations
  // never make referrals (emailed invitations and edit links do).
  const doc = read('../../content/docs/account/referrals.md');
  for (const fact of ['referralRewardCards', 'referralMatureHours', 'referralRewardsPer30Days', 'referralLinkJoinDays']) {
    assert.ok(doc.includes(`{{fact:${fact}}}`), `referrals.md must use {{fact:${fact}}}`);
  }
  assert.doesNotMatch(doc, /does not consume or produce referral/);
});

// ── 0378: where an abusive account came from outlives it ─────────────────────

test('request origins are salted hashes of a browser\'s own network, server-only, kept at most a year', () => {
  const origin = latestDefinition('_request_origin').body;
  // Supabase's own API edge is a Worker, so every request says cf-worker:
  // supabase.co (0379). A Worker acting for someone is recognised by
  // Cloudflare's Workers egress range instead, a server runtime by its headers.
  assert.doesNotMatch(origin, /\? 'cf-worker'/, 'every request through Supabase\'s edge carries cf-worker');
  assert.match(origin, /if v_ip <<= '2a06:98c0::\/29'::inet then/, 'a Worker acting for someone carries the Worker\'s address');
  assert.match(origin, /coalesce\(v_h->>'x-client-info', ''\) ~\* '\(deno\|node\)'/, 'so does a server runtime');
  assert.match(origin, /coalesce\(v_h->>'user-agent', ''\) ~\* '\^\(deno\|node\)'/);
  assert.match(origin, /v_h->>'cf-connecting-ip'/);
  assert.doesNotMatch(origin, /->>'x-forwarded-for'/, 'its first entry is whatever the client sent');
  assert.match(origin, /network\(set_masklen\(v_ip, 64\)\)/, 'an IPv6 network is its /64');
  assert.match(origin, /vault\.decrypted_secrets s where s\.name = 'forensic_origin_salt'/);
  assert.match(origin, /ip_hash := encode\(hmac\(v_net, v_salt, 'sha256'\), 'hex'\);/);
  assert.match(origin, /ua_hash := encode\(hmac\(left\(coalesce\(v_h->>'user-agent', ''\), 512\), v_salt, 'sha256'\), 'hex'\);/);

  const table = latestMatch(/create table if not exists public\.request_origins \(([\s\S]*?)\n\);/);
  assert.ok(table, 'request_origins is defined');
  assert.doesNotMatch(table.match[1], /\binet\b|ip_address|\bip\s+text/, 'no column holds a raw address');
  assert.match(table.match[1], /user_id\s+uuid not null references auth\.users\(id\) on delete cascade/, 'deleted with the account');
  assert.ok(latestMatch(/revoke all on table public\.request_origins from public, anon, authenticated;/));

  const note = latestDefinition('_note_origin').body;
  assert.match(note, /v_uid uuid := auth\.uid\(\);/, 'only the signed-in caller\'s own request is noted');
  assert.match(note, /exception when others then\s+null;/, 'noting never fails what they were doing');
  assert.match(latestDefinition('touch_presence').body, /perform public\._note_origin\('session'\);/);
  for (const [tbl, kind] of [['pending_invites', 'invite'], ['public_share_links', 'share_link'], ['outbound_ledger', 'email']]) {
    assert.ok(latestMatch(new RegExp(`create trigger ${tbl}_note_origin after insert on public\\.${tbl}\\s+` +
      `for each statement execute function public\\._tg_note_origin\\('${kind}'\\);`)), `${tbl} notes where it was made from`);
  }
  for (const sig of ['_request_origin\\(\\)', '_note_origin\\(text\\)', '_tg_note_origin\\(\\)', 'purge_old_request_origins\\(integer\\)']) {
    assert.ok(latestMatch(new RegExp(`revoke execute on function public\\.${sig} from public, anon, authenticated`)), sig);
  }
  const retention = latestMatch(/cron\.schedule\('purge-request-origins', '[^']+', \$\$select public\.purge_old_request_origins\((\d+)\)\$\$\)/);
  assert.ok(retention && Number(retention.match[1]) <= 365, 'kept at most a year');

  // What it is for: an account action's evidence names the accounts sharing its
  // networks, and a burst of new accounts on one network pages.
  const ev = latestDefinition('_account_evidence').body;
  assert.match(ev, /'networks',/);
  assert.match(ev, /'related_accounts',/);
  assert.match(ev, /'net', left\(x\.ip_hash, 10\)/, 'evidence shows a short prefix, not the whole hash');
  const abuse = latestDefinition('check_abuse_signals').body;
  assert.match(abuse, /c_fleet_accounts constant integer := \d+;/);
  assert.match(abuse, /having count\(distinct o\.user_id\) >= c_fleet_accounts/);
  assert.match(abuse, /ops_alert_raise\('signup_network',/);

  const doc = read('../../content/docs/account/data-and-privacy.md');
  assert.ok(doc.includes('{{fact:requestOriginRetentionDays}}'), 'the privacy page states the retention from code');
  assert.match(doc, /never as the address itself/);
});

// ── Scout, before it ever launches (OM-7, AC-11) ─────────────────────────────

test('a Scout shell account adopts an address only by confirming it, and the route names nobody', () => {
  const src = read('../worker-scout.js');
  const claim = src.slice(src.indexOf('export async function handleScoutClaim'),
    src.indexOf('export async function handleScoutSessionMint'));
  // The USER endpoint holds the change until the new address confirms it; the
  // admin endpoint applied it at once.
  assert.match(claim, /fetch\(`\$\{env\.SUPABASE_URL\}\/auth\/v1\/user`, \{\s+method: 'PUT',/);
  assert.match(claim, /apikey: env\.SUPABASE_ANON_KEY,\s+authorization: request\.headers\.get\('authorization'\)/);
  assert.doesNotMatch(claim, /\/auth\/v1\/admin\/users/, 'the admin endpoint sets an address unconfirmed and says who is registered');
  assert.doesNotMatch(claim, /conflict: true/);
  assert.match(claim, /return jsonRes\(\{ status: 'confirm_sent' \}, 200\);/);
  assert.doesNotMatch(read('../components/ScoutClaimBanner.jsx'), /'conflict'/);
});

test('the Scout waitlist needs a hashed connection, a bot check once configured, and has a ceiling', () => {
  const src = read('../worker-scout.js');
  assert.match(src, /if \(!hashed\) return jsonRes\(/, 'no hash, no signup');
  assert.match(src, /if \(!await turnstileOk\(env, body\.turnstileToken, request\.headers\.get\('cf-connecting-ip'\)\)\)/);
  assert.match(src, /if \(!env\.TURNSTILE_SECRET_KEY\) return true;/, 'dormant until the secret is set');
  assert.match(src, /if \(row\.status === 'full'\)/);
  assert.match(read('../components/ScoutSignupBox.jsx'),
    /challenge = captchaEnabled\(\) \? await captchaToken\(captchaRef\.current\) : '';/);

  const fn = latestDefinition('scout_request_invite').body;
  assert.match(fn, /if p_ip_hash is null or length\(p_ip_hash\) < 16 then/);
  assert.match(fn, /pg_advisory_xact_lock\(hashtext\('scout_waitlist'\)\)/, 'caps are not raced');
  for (const c of ['c_ip_hour', 'c_ip_day', 'c_pending_max']) {
    assert.match(fn, new RegExp(`${c}\\s+constant int := \\d+;`), c);
  }
  assert.match(fn, /if v_ip_hour >= c_ip_hour or v_ip_day >= c_ip_day then/);
  assert.match(fn, /ops_alert_raise\('scout_waitlist_full',/);
  assert.match(fn, /return query select 'full'::text, false, null::int;/);
});

// ── 0381: the embedding route spends against a budget ───────────────────────

test('every embedding call asks the daily budget first, and spends only on a yes', () => {
  const src = read('../worker-tags.js');
  const handler = src.slice(src.indexOf('async function handleEmbed'), src.indexOf('// ───', src.indexOf('async function handleEmbed')));
  const ask = handler.indexOf('if (!await embedBudgetOk(env, request, chars))');
  assert.ok(ask > 0 && ask < handler.indexOf('api.openai.com/v1/embeddings'), 'the budget is asked before OpenAI is called');
  assert.match(src, /if \(!r\.ok\) return false;\s+return \(await r\.json\(\)\.catch\(\(\) => false\)\) === true;/, 'anything but a yes is a no');

  const fn = latestDefinition('tags_embed_budget_take').body;
  assert.match(fn, /c_user_day\s+constant bigint := \d+;/);
  assert.match(fn, /c_global_day constant bigint := \d+;/);
  assert.match(fn, /if not public\._actor_active\(\) then/);
  assert.match(fn, /pg_advisory_xact_lock\(hashtext\('embed_budget'\)\)/);
  assert.match(fn, /ops_alert_raise\('embed_budget',/);
  assert.ok(latestMatch(/revoke execute on function public\.tags_embed_budget_take\(integer\) from public, anon;/));
  assert.ok(latestMatch(/revoke all on table public\.embed_usage from public, anon, authenticated;/));
  assert.match(read('../../content/docs/organize/tags.md'), /\{\{fact:embedCharsPerDay\}\}/);
});

// ── 0382: a co-member sees a name, a colour and a picture ───────────────────

test('workspace mates read member_profiles, never the whole profiles row', () => {
  const create = latestMatch(/create table if not exists public\.member_profiles \(([\s\S]*?)\n\);/);
  assert.ok(create, 'member_profiles is defined');
  const cols = [...create.match[1].matchAll(/^\s+(\w+)\s/gm)].map((m) => m[1]);
  assert.deepEqual(cols, ['user_id', 'display_name', 'color', 'avatar_url', 'updated_at'],
    'only presentational columns — anything added here is readable by every workspace mate');
  assert.ok(latestMatch(/revoke all on table public\.member_profiles from public, anon, authenticated;\s+grant select on table public\.member_profiles to authenticated;/));
  assert.ok(latestMatch(/create trigger profiles_member_profile_sync\s+after insert or update of display_name, color, avatar_url on public\.profiles/));

  // The client reads peers from member_profiles, and listens to it.
  const api = read('./boardsApi.js');
  const byIds = api.slice(api.indexOf('export async function getProfilesByIds'), api.indexOf('export async function listWorkspaceMembers'));
  assert.match(byIds, /\.from\('member_profiles'\)/);
  assert.doesNotMatch(byIds, /\.from\('profiles'\)/);
  assert.match(read('./userProfiles.js'), /table: 'member_profiles'/);
  assert.doesNotMatch(read('./userProfiles.js'), /table: 'profiles'/);
  // 0383: and the policy that let workspace mates read whole rows is gone.
  assert.ok(latestMatch(/drop policy if exists "ws-mate read profile" on public\.profiles;/));
  const later = latestPolicy('ws-mate read profile');
  assert.ok(!later || Number(later.file.slice(0, 4)) < 383, `${later?.file} re-creates the ws-mate policy on profiles`);
});

// ── 0384: joining one cluster does not hand you everyone's address ──────────

test('Messages shows an email address only to someone who shares a workspace with its owner', () => {
  const fn = latestDefinition('list_messageable_users').body;
  assert.match(fn, /case when mt\.user_id is not null then u\.email::text end\s+as email,/);
  assert.match(fn, /case when mt\.user_id is not null then u\.email::text end\)::text\s+as name,/,
    'the name fallback must not be an address either');
  assert.match(fn, /or \(mt\.user_id is not null and coalesce\(u\.email, ''\)\s+ilike/, 'nor may the search match one');
  assert.doesNotMatch(fn, /^\s+u\.email::text\s+as email,/m);
});

// ── 0385: an analytics row a client writes is about the client ──────────────

test('a client analytics row names its own sender and a sane time, or is quarantined', () => {
  const guard = latestDefinition('_tg_event_caller_guard').body;
  assert.doesNotMatch(guard, /security definer/i, 'it must run as the caller, or current_user tells it nothing');
  assert.match(guard, /if current_user not in \('anon', 'authenticated'\) then\s+return new;/,
    'server-fired events legitimately name someone else');
  assert.match(guard, /new\.user_id is distinct from auth\.uid\(\)/);
  assert.match(guard, /new\.occurred_at > now\(\) \+ interval '5 minutes' then\s+new\.occurred_at := now\(\);/);
  assert.ok(latestMatch(/create trigger analytics_events_a_caller_guard\s+before insert on public\.analytics_events/));
  assert.ok('analytics_events_a_caller_guard' < 'analytics_events_divert_synthetic', 'the guard fires before the divert');
  assert.match(latestDefinition('_tg_divert_synthetic_events').body,
    /new\.props->>'synthetic_reason' in \('uid_mismatch', 'stale'\)/);
});

// ── 0386: the cron secret lives in Vault ────────────────────────────────────

test('no cron job carries its secret inline; one definer helper reads it from Vault', () => {
  for (const f of migrationFiles().filter((f) => Number(f.slice(0, 4)) >= 386)) {
    const sql = readFileSync(MIGRATIONS_DIR + f, 'utf8');
    assert.doesNotMatch(sql, /'x-cron-secret'\s*,\s*'[A-Za-z0-9_\-+/=]{16,}'/, `${f} writes a cron secret inline`);
  }
  const helper = latestDefinition('_cron_edge_post').body;
  assert.match(helper, /from vault\.decrypted_secrets where name = 'cron_edge_secret'/);
  assert.match(helper, /if p_function is null or p_function !~ '\^\[a-z0-9-\]\+\$' then/);
  assert.ok(latestMatch(/revoke execute on function public\._cron_edge_post\(text, jsonb\) from public, anon, authenticated;/));
  for (const job of ['billing-reconcile-daily', 'gsc-sync-daily', 'lifecycle-email-hourly', 'seo-health-every-6h', 'waitlist-accept-every-10-min']) {
    assert.ok(latestMatch(new RegExp(`cron\\.schedule\\('${job}',\\s+'[^']+',\\s+\\$\\$select public\\._cron_edge_post\\(`)), job);
  }
  assert.match(latestDefinition('check_security_invariants').body,
    /p\.proname not in \('_notify_email_send', 'ops_alert_dispatch', '_cron_edge_post', 'check_security_invariants'\)/);
});

// ── 0387: storage counts what was actually stored ───────────────────────────

test('an upload URL carries its size, and the images row takes that size, not the client\'s', () => {
  const party = read('../../party/upload.ts');
  const presign = party.slice(party.indexOf('async handlePresignPut'), party.indexOf('// POST /sign-reads'));
  assert.match(presign, /new Request\(r2Url, \{ method: "PUT", headers: \{ "Content-Length": String\(declared\) \} \}\),\s+\{ aws: \{ signQuery: true, allHeaders: true \} \}/,
    'the length is signed — R2 refuses a body of any other size');
  assert.match(presign, /if \(!\/X-Amz-SignedHeaders=\[\^&\]\*content-length\/i\.test\(signed\.url\)\)/,
    'a URL whose signature does not cover the length is never handed out');
  const intentAt = presign.indexOf('"record_upload_intent"');
  assert.ok(intentAt > 0 && intentAt < presign.indexOf('return Response.json({ uploadUrl'), 'the intent is recorded before the key leaves');
  assert.match(party, /const DERIVED_MAX_BYTES = /);
  assert.match(party, /"finalize_upload_intent", \{ p_key: key, p_bytes: result\.bytes \}/, 'a multipart object is held to its declaration');

  const up = read('./uploads.js');
  assert.match(up, /presignPreview\(\{ workspaceId, boardId, previewKey: requestedKey, bytes: dn\.blob\.size \}\)/);
  assert.match(up, /presignPreview\(\{ workspaceId, boardId, previewKey: requestedSmKey, bytes: dnSm\.blob\.size \}\)/);
  assert.match(up, /presignThumb\(\{ workspaceId, boardId, thumbKey: key, contentType: 'image\/webp', bytes: blob\.size \}\)/);

  assert.match(latestDefinition('_tg_image_size_from_intent').body, /new\.size_bytes := v_bytes;/);
  assert.ok(latestMatch(/create trigger images_size_from_intent\s+before insert on public\.images/));
  for (const fn of ['authorize_upload', 'authorize_image_upload']) {
    assert.match(latestDefinition(fn).body, /_storage_used_bytes\(v_owner\) \+ public\._storage_pending_bytes\(v_owner\)/,
      `${fn} counts uploads in flight`);
  }
  assert.match(latestDefinition('_storage_quota_bytes').body, /else public\._storage_quota_free_bytes\(\)/, 'a free owner gets the free drive');
  assert.ok(latestMatch(/add constraint images_size_bytes_nonnegative check \(size_bytes is null or size_bytes >= 0\)/));
  for (const sig of ['_storage_quota_free_bytes\\(\\)', '_storage_pending_bytes\\(uuid\\)', 'purge_old_upload_intents\\(integer\\)']) {
    assert.ok(latestMatch(new RegExp(`revoke execute on function public\\.${sig} from public, anon, authenticated`)), sig);
  }
});

// ── A ban reaches the open board sockets (AC-2) ─────────────────────────────

test('a banned account is refused at connect and dropped from open boards within a minute', () => {
  const auth = read('../../party/auth.ts');
  assert.match(auth, /export async function bannedAmong\(serviceKey: string \| undefined, userIds: string\[\]\)/);
  assert.match(auth, /profiles\?user_id=in\.\(\$\{ids\.join\(","\)\}\)&banned_at=not\.is\.null&select=user_id/,
    'read with the service role — the banned token itself still passes PostgREST for up to an hour');
  const board = read('../../party/board.ts');
  assert.match(board, /static async onBeforeConnect\(req: Party\.Request, lobby: Party\.Lobby\)/);
  assert.match(board, /if \(auth\.userId && banned\.has\(auth\.userId\)\) return new Response\("Account suspended", \{ status: 403 \}\);/);
  assert.match(board, /conn\.setState\(\{ userId: ctx\.request\.headers\.get\("x-user-id"\) \|\| "" \}\);/);
  assert.match(board, /await this\.armBanCheck\(\);/);
  assert.match(board, /async onAlarm\(\) \{[\s\S]*?c\.close\(4403, "account suspended"\)/);
  assert.match(board, /const BAN_CHECK_MS = 60_000;/);
});

// ── 0388: a deleted account's workspace goes to someone who can edit it ──────

test('a deleted account\'s shared workspace passes to an editor, who becomes its owner', () => {
  const heir = latestDefinition('_deletion_heir').body;
  assert.match(heir, /m\.role in \('owner', 'admin', 'editor'\)/, 'never a viewer or a service account');
  assert.match(heir, /not public\._user_banned\(m\.user_id\)/);
  assert.match(heir, /order by m\.created_at asc, m\.user_id asc\s+limit 1/, 'one deterministic heir');
  const prep = latestDefinition('prepare_account_deletion').body;
  assert.match(prep, /public\._deletion_heir\(w\.id, p_user_id\)/);
  assert.match(prep, /update workspace_members set role = 'owner' where workspace_id = r\.id and user_id = r\.to_user;/);
  assert.match(prep, /if public\._user_banned\(p_user_id\) then/, '0371\'s refusal survives');
  assert.match(latestDefinition('my_deletion_impact').body, /public\._deletion_heir\(w\.id, \(select uid from me\)\)/,
    'the confirmation screen names the same heir');
  assert.match(read('../../content/docs/account/data-and-privacy.md'), /A viewer never\s+inherits a workspace\./);
});

// ── Phase 5: the CSP dry run reports somewhere ──────────────────────────────

test('the Report-Only policy reports to an endpoint that keeps origins and paths only', async () => {
  const src = read('../worker.js');
  assert.match(src, /'report-uri \/api\/csp-report',/);
  assert.match(src, /if \(url\.pathname === '\/api\/csp-report'\) \{/);
  const { cspReportRows } = await import('../worker.js');
  const rows = cspReportRows({ 'csp-report': {
    'effective-directive': 'script-src-elem',
    'blocked-uri': 'https://evil.example/x.js?token=secret',
    'document-uri': 'https://clusters.soleilpictures.com/docs/api?session=abc',
    'source-file': 'https://clusters.soleilpictures.com/assets/a.js?v=1', 'line-number': 12,
  } }, 'UA', 1_000_000);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'csp_violation');
  assert.equal(rows[0].path, '/docs/api', 'never a query string');
  assert.doesNotMatch(JSON.stringify(rows[0]), /secret|session=|v=1/);
  // The same violation on the same page is recorded once per ten minutes.
  assert.equal(cspReportRows({ 'csp-report': { 'effective-directive': 'script-src-elem', 'blocked-uri': 'https://evil.example/x.js', 'document-uri': 'https://clusters.soleilpictures.com/docs/api' } }, 'UA', 1_000_000 + 60_000).length, 0);
  // Reporting API batches are read too.
  assert.equal(cspReportRows([{ type: 'csp-violation', body: { effectiveDirective: 'img-src', blockedURL: 'https://x.example/i.png', documentURL: 'https://clusters.soleilpictures.com/pricing' } }], '', 2_000_000).length, 1);
});

// ── DEP-7: edge functions pin exact dependency versions ─────────────────────

test('every npm: import in an edge function names an exact version', () => {
  const root = new URL('../../../supabase/functions/', import.meta.url).pathname;
  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(d + e.name + '/');
      else if (/\.(ts|mjs|js)$/.test(e.name)) files.push(d + e.name);
    }
  };
  walk(root);
  const floating = [];
  for (const f of files) {
    for (const m of readFileSync(f, 'utf8').matchAll(/['"]npm:((?:@[^/'"]+\/)?[^@'"]+)@([^'"/]+)/g)) {
      if (!/^\d+\.\d+\.\d+$/.test(m[2])) floating.push(`${f.slice(root.length)}: ${m[1]}@${m[2]}`);
    }
  }
  assert.deepEqual(floating, [], 'a floating range pulls whatever was published last into a runtime holding the service-role key');
});

// ── 0389: a card's weight follows its kind ──────────────────────────────────

test('the server weighs a card the way cardWeight does, except the grid it cannot see', async () => {
  const fn = latestDefinition('_tg_card_weight_by_kind').body;
  assert.match(fn, /if coalesce\(new\.kind, 'note'\) = 'grid' then\s+return new;/);
  assert.match(fn, /elsif new\.kind = 'schedule' then\s+new\.weight := greatest\(1, coalesce\(new\.weight, 1\)\);/);
  assert.match(fn, /else\s+new\.weight := 1;/);
  assert.ok(latestMatch(/create trigger card_index_weight_by_kind\s+before insert or update of weight, kind on public\.card_index/));
  // The rule the trigger mirrors: anything but a grid or a schedule weighs 1.
  const { cardWeight } = await import('./gridCount.js');
  for (const kind of ['note', 'image', 'video', 'link', 'board', 'doc']) assert.equal(cardWeight(kind, []), 1, kind);
  assert.equal(cardWeight('schedule', []), 1);
});
