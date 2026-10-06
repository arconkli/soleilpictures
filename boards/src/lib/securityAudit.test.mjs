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
import { latestDefinition, latestPolicy, latestMatch } from './migrationText.mjs';
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
