// adminEmailImpactMigration.test.mjs — 0494 gives Emails › Impact its one read.
// It was applied to the shared database the day it was written, so this pins
// what the Impact view stands on.
//
//   node --test src/lib/adminEmailImpactMigration.test.mjs
//
// What this guards:
//   * the 0311 habit: admin-gated, closed to PUBLIC and anon, open to
//     authenticated and service_role, and the file proves it;
//   * the people: never the team, a banned account or a service account, in
//     every series, including the first and last send of each email;
//   * the shape. Every key the page reads is one the read returns, so a rename
//     shows up here instead of as a quiet dash on the page;
//   * the events. "Made something" keys on three names the client emits;
//   * the emails. Every type the lifecycle cron sends is named on the page, and
//     every one sends from the same address, which is what lets the page say an
//     address alone does not explain a fall that only some of them took;
//   * the welcome's wait, which the welcome chart's "still filling" is built on;
//   * no address ever leaves the read, only the mailbox it belongs to.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, latestDefinition } from './migrationText.mjs';
import { EV } from './analyticsEvents.js';
import { EMAILS, WELCOME_WAIT_DAYS } from './emailImpact.js';
import { SPLIT_DAY } from './emailChanges.js';

const FILE = '0494_admin_email_impact.sql';
const PATH = join(MIGRATIONS_DIR, FILE);
const src = existsSync(PATH) ? readFileSync(PATH, 'utf8') : '';
const code = src.replace(/--.*$/gm, '');
const readSrc = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const body = () => {
  const m = code.match(/create or replace function public\.admin_email_impact\(([\s\S]*?)\)\s*returns jsonb([\s\S]*?)as \$function\$([\s\S]*?)\$function\$;/);
  assert.ok(m, `${FILE} defines admin_email_impact returning jsonb`);
  return { args: m[1], head: m[2], body: m[3] };
};

// The keys of the object a jsonb_build_object( ... ) starting at `from` builds:
// the quoted names at its own depth, never those of an object nested in it.
function objectKeys(text, from) {
  const keys = [];
  let depth = 0;
  for (let i = text.indexOf('(', from); i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') { depth -= 1; if (depth === 0) break; }
    else if (ch === "'" && depth === 1) {
      const end = text.indexOf("'", i + 1);
      const word = text.slice(i + 1, end);
      const after = text.slice(end + 1).match(/^\s*,/);
      if (after && /^[a-z_]+$/.test(word)) keys.push(word);
      i = end;
    }
  }
  return keys;
}

test('0494 exists and runs in one transaction', () => {
  assert.ok(src, `${FILE} is in supabase/migrations`);
  assert.match(code, /^\s*begin;/m);
  assert.match(code, /set local lock_timeout = '3s';/);
  assert.match(code, /notify pgrst, 'reload schema';\s*commit;\s*$/);
  assert.equal(latestDefinition('admin_email_impact')?.file, FILE, 'no later migration redefines the read');
});

test('weeks and a split day in, an admin-only stable definer', () => {
  const { args, head, body: b } = body();
  assert.equal(args.replace(/\s+/g, ' ').trim(), 'p_weeks integer default 18, p_split date default null');
  assert.match(head, /stable security definer\s+set search_path to 'public'/);
  assert.match(b, /^\s*declare[\s\S]*?begin\s+perform public\._require_admin\(\);/, 'checks for an admin before it reads anything');
  // UTC Monday weeks, between 4 and 104 of them, this week so far last.
  assert.match(b, /v_weeks\s+int\s+:= least\(greatest\(coalesce\(p_weeks, 18\), 4\), 104\);/);
  assert.match(b, /v_cur\s+date := date_trunc\('week', now\(\) at time zone 'utc'\)::date;/);
  assert.match(b, /generate_series\(v_first::timestamp, v_cur::timestamp, interval '7 days'\)/);
  assert.match(b, /date_trunc\('week', l\.sent_at at time zone 'utc'\)::date as wk/);
});

test('the 0311 habit: closed to PUBLIC and anon, open to authenticated and service_role, and proved', () => {
  assert.match(code, /revoke execute on function public\.admin_email_impact\(integer, date\) from public, anon;/);
  assert.match(code, /grant execute on function public\.admin_email_impact\(integer, date\) to authenticated, service_role;/);
  const proof = code.match(/do \$proof\$([\s\S]*?)\$proof\$;/)?.[1] || '';
  assert.match(proof, /v_sig constant text := 'public\.admin_email_impact\(integer,date\)';/);
  assert.match(proof, /has_function_privilege\('anon', v_sig, 'execute'\)/);
  assert.match(proof, /has_function_privilege\('authenticated', v_sig, 'execute'\)/);
  assert.match(proof, /has_function_privilege\('service_role', v_sig, 'execute'\)/);
  assert.match(proof, /an overload sits beside admin_email_impact/);
});

test('nobody from the team, no banned account and no service account, in any series', () => {
  const { body: b } = body();
  const excluded = b.match(/excluded as \(([\s\S]*?)\n  \),/)?.[1] || '';
  assert.match(excluded, /public\._internal_user_ids\(\)/);
  assert.match(excluded, /bp\.banned_at is not null or coalesce\(bp\.is_service, false\)/);
  const notExcluded = (alias) => new RegExp(`not exists \\(select 1 from excluded e where e\\.user_id = ${alias}\\.user_id\\)`);
  // The log every send series reads, the first and last send, and the sign-ups.
  assert.match(b.match(/lg as \(([\s\S]*?)\n  \),/)?.[1] || '', notExcluded('l'));
  assert.equal((b.match(new RegExp(notExcluded('l2').source, 'g')) || []).length, 2,
    'first_sent and last_sent leave the same people out');
  const people = b.match(/people as \(([\s\S]*?)\n  \),/)?.[1] || '';
  assert.match(people, /from public\._admin_people\(true, true\) ap/, 'sign-ups count the way Analytics does: once the code is entered');
  assert.match(people, notExcluded('ap'));
});

test('every key the page reads is a key the read returns', () => {
  const { body: b } = body();
  const top = objectKeys(b, b.indexOf('select jsonb_build_object(\n    \'weeks\''));
  assert.deepEqual(top.sort(), ['arms', 'lost', 'mailbox', 'months', 'signups', 'split', 'today', 'tracked_from', 'types', 'weeks', 'welcomed'].sort());
  const lib = readSrc('./emailImpact.js') + readSrc('../pages/admin/emails/EmailImpactView.jsx');
  const used = new Set([...lib.matchAll(/\braw\??\.([a-z_]+)/g)].map((m) => m[1]));
  assert.ok(used.has('weeks') && used.has('types') && used.has('mailbox'), 'the scan finds what the page reads');
  for (const k of used) assert.ok(top.includes(k), `the page reads raw.${k}, which the read returns`);

  const typeKeys = objectKeys(b, b.indexOf("jsonb_build_object(\n             'type',"));
  for (const k of ['type', 'sent', 'made', 'held', 'held_made', 'failed', 'delivered', 'opened', 'young', 'before', 'after', 'first_sent', 'last_sent']) {
    assert.ok(typeKeys.includes(k), `each email carries ${k}`);
  }
  const boxKeys = objectKeys(b, b.indexOf("jsonb_build_object(\n             'box',"));
  assert.deepEqual(boxKeys.sort(), ['after', 'before', 'box', 'delivered', 'opened']);
  for (const k of ['type', 'reason', 'n', 'by_week']) assert.match(b, new RegExp(`'${k}', lr\\.`), `a lost row carries ${k}`);
  for (const k of ['type', 'factor', 'arm', 'sends', 'delivered', 'opened', 'clicked', 'returned', 'made', 'first', 'last']) {
    assert.match(b, new RegExp(`'${k}',\\s+[(a]`), `a test line carries ${k}`);
  }
});

test('"made something" is a card placed or edited, or a doc edited, within 72 hours, never a synthetic row', () => {
  const { body: b } = body();
  const made = b.match(/g\.status in \('sent', 'held_out'\) and exists \(([\s\S]*?)\) as made,/)?.[1] || '';
  assert.match(made, /a\.occurred_at > g\.sent_at and a\.occurred_at <= g\.sent_at \+ interval '72 hours'/);
  assert.match(made, /a\.event in \('card_placed', 'card_edit', 'doc_edit'\)/);
  assert.match(made, /coalesce\(a\.props->>'synthetic', ''\) <> 'true'/);
  const emitted = new Set(Object.values(EV));
  for (const ev of ['card_placed', 'card_edit', 'doc_edit']) assert.ok(emitted.has(ev), `the client emits ${ev}`);
  // The page says the same window.
  const view = readSrc('../pages/admin/emails/EmailImpactView.jsx');
  assert.match(view, /\['MADE SOMETHING', 'within 3 days of the send'\]/);
});

test('the log statuses the read counts are the ones the cron and the claim write', () => {
  const { body: b } = body();
  for (const s of ['sent', 'held_out', 'failed']) assert.match(b, new RegExp(`i\\.status = '${s}'`), `the read counts '${s}'`);
  const cron = readSrc('../../../supabase/functions/lifecycle-email-cron/index.ts');
  assert.match(cron, /\.update\(\{ status: ok \? "sent" : "failed"/);
  assert.match(latestDefinition('lifecycle_claim_send')?.body || '', /'held_out'/, 'the claim writes a held_out row for the group held back');
});

test('every email the cron sends is named on the page, and the page names no other', () => {
  const cron = readSrc('../../../supabase/functions/lifecycle-email-cron/index.ts');
  const sent = [...cron.matchAll(/runType\("([a-z0-9_]+)"/g)].map((m) => m[1]);
  assert.ok(sent.length >= 7, 'the cron runs every lifecycle type through runType');
  assert.deepEqual([...new Set(sent)].sort(), EMAILS.map((e) => e.type).sort());
});

test('every lifecycle email sends from the one address the opens footnote relies on', () => {
  const send = readSrc('../../../supabase/functions/send-transactional-email/index.ts');
  const sw = send.match(/function fromAddress\(template: string\): string \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.ok(sw, 'send-transactional-email picks a sender in fromAddress');
  // The run of case labels that falls through to `return FROM_LIFECYCLE;`.
  const block = sw.match(/((?:\s*case "[a-z0-9_]+":)+)\s*return FROM_LIFECYCLE;/)?.[1] || '';
  const lifecycle = [...block.matchAll(/case "([a-z0-9_]+)":/g)].map((m) => m[1]);
  for (const e of EMAILS) assert.ok(lifecycle.includes(e.type), `${e.type} sends from FROM_LIFECYCLE`);
  assert.match(readSrc('./emailImpact.js'), /send-transactional-email's FROM_LIFECYCLE/);
});

test('the welcome can go out up to 3 days after sign-up, which is when a sign-up week settles', () => {
  const due = latestDefinition('lifecycle_due_welcome_board')?.body || '';
  assert.match(due, /p_max_hours int default 72/);
  assert.match(due, /u\.created_at >\s+now\(\) - make_interval\(hours => p_max_hours\)/);
  const cron = readSrc('../../../supabase/functions/lifecycle-email-cron/index.ts');
  assert.match(cron, /admin\.rpc\(rpcName, \{ p_hour: hour \}\)/, 'the cron leaves the window at its default');
  assert.equal(WELCOME_WAIT_DAYS * 24, 72);
});

test('no address leaves the read, only the mailbox it belongs to', () => {
  const { body: b } = body();
  assert.equal((b.match(/recipient_email/g) || []).length, 1, 'the address is read once');
  assert.match(b, /lower\(split_part\(l\.recipient_email, '@', 2\)\) as dom/, 'and only for its domain');
  assert.equal((b.match(/\bdom\b/g) || []).length, 1 + (b.match(/i\.dom/g) || []).length, 'the domain is used only to pick the mailbox');
  assert.doesNotMatch(b, /'dom'|'email'|'recipient/, 'neither the domain nor an address is a key of what comes back');
});

test('the page asks for the weeks it draws and the split day the record names', () => {
  const view = readSrc('../pages/admin/emails/EmailImpactView.jsx');
  assert.match(view, /supabase\.rpc\('admin_email_impact', \{ p_weeks: WEEKS, p_split: SPLIT_DAY \}\)/);
  assert.match(view, /const WEEKS = 18;/);
  assert.match(SPLIT_DAY, /^\d{4}-\d{2}-\d{2}$/);
});
