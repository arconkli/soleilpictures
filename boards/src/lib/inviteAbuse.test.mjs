// The 2026-09-20 invite abuse, and getting our mail back out of spam
// (migrations 0358 and 0359, supabase/functions/_shared/email/safeLabel.mjs).
//
// Two accounts named a cluster with a phishing lure and a link, then invited a
// pasted list of strangers to it. share_board had no limit, and the invite
// email put the cluster's name in its subject line, from the sending domain
// that also carries sign-in codes and lifecycle mail. What closed it, and what
// these tests pin:
//   - every name someone typed is cleaned before it reaches an email
//   - both invite RPCs spend a daily budget and check for a ban first
//   - nobody can forge a notification row (and through it, an email)
//   - lifecycle mail stops going to people who never open it
//   - the picture win-back is back, retimed, and measured against a holdout
//
// Behavioural where the code can run under node (safeLabel.mjs is plain JS for
// exactly this reason), source-level for SQL and the Deno templates.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { latestDefinition, migrationFiles, MIGRATIONS_DIR } from './migrationText.mjs';
import { safeLabel, safePerson } from '../../../supabase/functions/_shared/email/safeLabel.mjs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const templates = read('../../../supabase/functions/_shared/email/templates.ts');
const URLISH = /https?:|www\.|\b[\p{L}\p{N}-]+\.(?:com|ru|google|ly|app|net|org|рф)\b/iu;

// ── The sanitizer ───────────────────────────────────────────────────────────

test('safeLabel takes the link out, whatever it is wearing', () => {
  const cases = [
    'Approved for a payout. Log in- https://calendar.app.google/am9NAGPQx3hQwC2s9',
    'visit calendar.app.google/xyz now',
    'ｗｗｗ．ｓｃａｍ．ｃｏｍ big prize', // full-width www.scam.com
    'prize at scam。com today',                                                        // ideographic full stop
    'prize at scam․com today',                                                        // one-dot leader
    'win at bit.ly/abc',
    'яндекс.рф деньги',
    'HTTP://SHOUTING.EXAMPLE/x',
  ];
  for (const c of cases) {
    const out = safeLabel(c, 60, 'a cluster');
    assert.doesNotMatch(out, URLISH, `${JSON.stringify(c)} kept a link: ${JSON.stringify(out)}`);
    assert.doesNotMatch(out, /\.(?:com|ru|ly|google)\b/i, `${JSON.stringify(c)} kept a domain: ${JSON.stringify(out)}`);
  }
  // The lead-in a removed link leaves behind goes too.
  assert.equal(safeLabel('Approved for a payout. Log in- https://x.example/y'), 'Approved for a payout. Log in');
});

test('safeLabel keeps ordinary names, strips newlines, caps the length', () => {
  assert.equal(safeLabel('Storyboard v2.0'), 'Storyboard v2.0');
  assert.equal(safeLabel("Mr. Smith's lookbook"), "Mr. Smith's lookbook");
  assert.equal(safeLabel('Spring shoot — day 2'), 'Spring shoot — day 2');
  // CR/LF in a subject line is a header-injection primitive.
  assert.doesNotMatch(safeLabel('Line one\r\nBcc: someone'), /[\r\n]/);
  const long = safeLabel('x'.repeat(200), 60);
  assert.equal([...long].length, 60);
  assert.ok(long.endsWith('…'), 'a capped name says it was capped');
  // Nothing usable left → the caller's fallback.
  assert.equal(safeLabel('https://only-a-link.example/path', 60, 'a cluster'), 'a cluster');
  assert.equal(safeLabel(null, 60, 'a workspace'), 'a workspace');
});

test('safePerson keeps an account email and cleans a display name', () => {
  assert.equal(safePerson('someone@example.com'), 'someone@example.com');
  assert.equal(safePerson('Free money http://x.example'), 'Free money');
  assert.equal(safePerson(''), 'Someone');
  assert.doesNotMatch(safePerson('Name\nInjected: header'), /\n/);
});

// ── The templates use it ────────────────────────────────────────────────────

function caseBlock(name) {
  const start = templates.indexOf(`case "${name}":`);
  assert.ok(start > 0, `renderTemplate has no case "${name}"`);
  const next = templates.indexOf('case "', start + 10);
  return templates.slice(start, next > 0 ? next : undefined);
}

test('every person-to-person template cleans the names it is handed', () => {
  assert.match(templates, /import \{ safeLabel, safePerson \} from "\.\/safeLabel\.mjs";/);
  const expect = {
    workspace_invite:    ['safeLabel(data.workspaceName', 'safePerson(data.inviterName)'],
    board_shared:        ['safeLabel(data.boardName', 'safePerson(data.sharerName)'],
    invite_accepted:     ['safeLabel(data.boardName', 'safePerson(data.joinerName)'],
    pending_invite:      ['safeLabel(data.boardName', 'safeLabel(data.workspaceName', 'safePerson(data.inviterName)'],
    mention_email:       ['safeLabel(data.surfaceContext', 'safePerson(data.mentionerName)'],
    comment_reply_email: ['safeLabel(data.boardName', 'safeLabel(data.workspaceName', 'safePerson(data.replierName)'],
  };
  for (const [name, needles] of Object.entries(expect)) {
    const block = caseBlock(name);
    for (const n of needles) assert.ok(block.includes(n), `${name} must use ${n}`);
    // A raw String(data.<name>) for any of these fields is the bug coming back.
    assert.doesNotMatch(block, /String\(data\.(boardName|workspaceName|inviterName|sharerName|joinerName|mentionerName|replierName|surfaceContext)\b/,
      `${name} passes a typed name through raw`);
  }
});

// ── 0358: the invite budget, the ban check, forged notifications ────────────

test('both invite RPCs check the ban, then spend the budget before an email can fire', () => {
  for (const fn of ['share_board', 'invite_workspace_member']) {
    const def = latestDefinition(fn);
    assert.ok(def, `${fn} must exist`);
    assert.match(def.body, /if not public\._actor_active\(\) then/, `${fn}: a banned account must stop at once`);
    const take = def.body.indexOf('_invite_budget_take()');
    const pendingInsert = def.body.indexOf('insert into pending_invites');
    assert.ok(take > 0 && pendingInsert > 0 && take < pendingInsert,
      `${fn}: the budget must be spent before the pending invite (whose trigger emails) is written`);
  }
  // share_board's existing-account branch emails on every call; it spends too.
  const share = latestDefinition('share_board').body;
  const shareNotif = share.indexOf('insert into share_notifications');
  assert.ok(share.lastIndexOf('_invite_budget_take()', shareNotif) > share.indexOf('return \'pending\''),
    'share_board must spend budget before the share_notifications row that sends board_shared');
});

test('the budget is enforced server-side, internal, and race-safe', () => {
  const def = latestDefinition('_invite_budget_take');
  assert.ok(def, '_invite_budget_take must exist');
  assert.match(def.body, /c_invite_daily_limit\s+constant\s+integer\s*:=\s*\d+/);
  assert.match(def.body, /c_invite_first_day_limit\s+constant\s+integer\s*:=\s*\d+/);
  assert.match(def.body, /pg_advisory_xact_lock/, 'two concurrent invites must not both read the old count');
  assert.match(def.body, /invite limit reached/, 'ShareModal stops its loop on this phrase');
  const file = readFileSync(MIGRATIONS_DIR + def.file, 'utf8');
  assert.match(file, /revoke execute on function public\._invite_budget_take\(\) from public, anon, authenticated/,
    'an internal helper must not be callable by a client (the 0311 habit)');
});

test('no client can insert a notification row (and so trigger an email)', () => {
  // The LAST migration to mention each open policy must be the one dropping it.
  for (const policy of ['share_notifications insert authed', 'mention_notifications insert authed']) {
    const files = migrationFiles().filter((f) => readFileSync(MIGRATIONS_DIR + f, 'utf8').includes(`"${policy}"`));
    const last = readFileSync(MIGRATIONS_DIR + files.at(-1), 'utf8');
    assert.match(last, new RegExp(`drop policy if exists "${policy}"`), `"${policy}" is live again in ${files.at(-1)}`);
  }
});

test('the invitation names the inviter by account email, not a typed name', () => {
  const def = latestDefinition('_tg_pending_invite_email');
  assert.ok(def);
  assert.match(def.body, /select u\.email into v_inviter_name/);
  assert.doesNotMatch(def.body, /display_name/, 'a display name is whatever its owner typed');
});

test('the share panel stops at the first refusal and keeps what was not sent', () => {
  const modal = read('../components/ShareModal.jsx');
  assert.match(modal, /if \(\/invite limit reached\/i\.test\(msg\)\) \{ limitMsg = msg; limitAt = email; break; \}/);
  assert.match(modal, /setInviteEmail\(unsent\.join\(', '\)\)/);
});

test('the sharing docs state the limits the server enforces', () => {
  // Typed as placeholders (never as numbers) in the source, and resolved by
  // gen-docs to the migration's own constants in the generated mirror.
  const doc = read('../../content/docs/collaborate/sharing.md');
  assert.match(doc, /\{\{fact:inviteDailyLimit\}\}/);
  assert.match(doc, /\{\{fact:inviteFirstDayLimit\}\}/);
  const def = latestDefinition('_invite_budget_take').body;
  const daily = def.match(/c_invite_daily_limit\s+constant\s+integer\s*:=\s*(\d+)/)[1];
  const firstDay = def.match(/c_invite_first_day_limit\s+constant\s+integer\s*:=\s*(\d+)/)[1];
  const mirror = read('../../public/docs/collaborate/sharing.md').replace(/\s+/g, ' ');
  assert.ok(mirror.includes(`can send ${daily} invitations a day, or ${firstDay} on its first day`),
    'the published sharing page must carry the limits _invite_budget_take enforces (run npm run docs:build)');
});

// ── 0359: the sunset gate and the holdout ───────────────────────────────────

test('lifecycle mail skips people who never open, and holds back a share for measurement', () => {
  const claim = latestDefinition('lifecycle_claim_send');
  assert.ok(claim);
  for (const gate of ['_email_pref_enabled', 'lifecycle_type_enabled', '_email_deliverable', '_email_engaged']) {
    assert.ok(claim.body.includes(`public.${gate}(`), `lifecycle_claim_send lost the ${gate} gate`);
  }
  assert.match(claim.body, /'held_out'/, 'a held-out person gets a held_out row');
  assert.match(claim.body, /if v_held then\s+return null;/, 'and no email');
  // abs() of hashtext's minimum overflows int4; the draw must not use it.
  assert.doesNotMatch(claim.body, /abs\(hashtext/);

  const engaged = latestDefinition('_email_engaged');
  assert.ok(engaged);
  assert.match(engaged.body, /limit 3/);
  assert.match(engaged.body, /count\(\*\) < 3 or bool_or\(x\.opened_at is not null\)/,
    'fewer than three sends passes; three unopened in a row does not');

  assert.ok(migrationFiles().some((f) => /check \(status in \('claimed','sent','failed','held_out'\)\)/
    .test(readFileSync(MIGRATIONS_DIR + f, 'utf8'))), 'lifecycle_email_log must accept held_out');
});

test('the picture win-back fires at the re-read point, once per idle spell', () => {
  const def = latestDefinition('lifecycle_due_board_waiting');
  assert.ok(def);
  assert.match(def.body, /p_dormant_days int default 10/, 'from 10 idle days');
  assert.match(def.body, /> now\(\) - interval '30 days'/, 'and not past 30, or it mails a gone account every 45 days for ever');
  assert.match(def.body, /p_cooldown_days int default 45/);
});
