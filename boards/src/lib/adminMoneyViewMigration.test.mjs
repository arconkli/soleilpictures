// adminMoneyViewMigration.test.mjs — 0492 gives Analytics › Money its two
// reads. It was applied to the shared database the day it was written, so this
// pins what the Money view stands on.
//
//   node --test src/lib/adminMoneyViewMigration.test.mjs
//
// What this guards:
//   * the 0311 habit: both functions are admin-gated, closed to PUBLIC and
//     anon, open to authenticated and service_role, and the file proves it;
//   * the population: never a service account, never a banned one, the team
//     out under p_exclude_internal, code-entered accounts under p_verified_only;
//   * the nesting. Every step of the path requires every step before it, so a
//     step can never be larger than the one before it;
//   * the routes. A pricing_view without a header made the cap-wall flag NULL,
//     and everyone whose views were all like that fell out of every route;
//   * the events. Each name and prop the reads key on is one the client
//     emits, so a rename shows up here instead of as a quiet zero on the page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, latestDefinition } from './migrationText.mjs';

const FILE = '0492_admin_money_view.sql';
const PATH = join(MIGRATIONS_DIR, FILE);
const src = existsSync(PATH) ? readFileSync(PATH, 'utf8') : '';
const code = src.replace(/--.*$/gm, '');
const readSrc = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const FNS = ['admin_money_path', 'admin_money_people'];

const ownDefinition = (fn) => {
  const re = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${fn}\\s*\\(([\\s\\S]*?)\\)\\s*returns\\s+jsonb` +
    `[\\s\\S]*?as\\s*(\\$[a-z_]*\\$)([\\s\\S]*?)\\2\\s*;`, 'i');
  const m = code.match(re);
  assert.ok(m, `${FILE} defines ${fn} returning jsonb`);
  return { args: m[1], head: m[0].slice(0, m[0].indexOf(m[2])), body: m[3] };
};

test('0492 exists and runs in one transaction', () => {
  assert.ok(src, `${FILE} is in supabase/migrations`);
  assert.match(code, /^\s*begin;/m);
  assert.match(code, /set local lock_timeout = '3s';/);
  assert.match(code, /notify pgrst, 'reload schema';\s*commit;\s*$/);
});

test('both reads take the two toggles, defaulting to the team left out and every account', () => {
  for (const fn of FNS) {
    const { args, head, body } = ownDefinition(fn);
    assert.equal(
      args.replace(/\s+/g, ' ').trim(),
      'p_exclude_internal boolean default true, p_verified_only boolean default false',
      `${fn}'s parameters`,
    );
    assert.match(head, /stable security definer\s+set search_path to 'public'/, `${fn} is a stable definer on public`);
    assert.match(body, /^\s*declare[\s\S]*?begin\s+perform public\._require_admin\(\);/,
      `${fn} checks for an admin before it reads anything`);
  }
});

test('the 0311 habit: closed to PUBLIC and anon, open to authenticated and service_role, and proved', () => {
  for (const fn of FNS) {
    assert.match(code, new RegExp(`revoke execute on function public\\.${fn}\\(boolean, boolean\\) from public, anon;`));
    assert.match(code, new RegExp(`grant execute on function public\\.${fn}\\(boolean, boolean\\) to authenticated, service_role;`));
  }
  const proof = code.match(/do \$proof\$([\s\S]*?)\$proof\$;/)?.[1] || '';
  assert.match(proof, /has_function_privilege\('anon', v_sig, 'execute'\)/);
  assert.match(proof, /has_function_privilege\('authenticated', v_sig, 'execute'\)/);
  assert.match(proof, /has_function_privilege\('service_role', v_sig, 'execute'\)/);
  for (const fn of FNS) assert.ok(proof.includes(`'public.${fn}(boolean,boolean)'`), `the proof covers ${fn}`);
  assert.match(proof, /an overload sits beside the money reads/);
});

test('the same people in both reads: no service accounts, no banned ones, the toggles honoured', () => {
  for (const fn of FNS) {
    const ext = ownDefinition(fn).body.match(/with ext as \(([\s\S]*?)\n  \),/)?.[1] || '';
    assert.match(ext, /not coalesce\(p\.is_service, false\)/, `${fn} leaves service accounts out`);
    assert.match(ext, /p\.banned_at is null/, `${fn} leaves banned accounts out`);
    assert.match(ext, /not p_exclude_internal\s+or p\.user_id not in \(select iu\.user_id from public\._internal_user_ids\(\) iu\)/);
    assert.match(ext, /not p_verified_only\s+or p\.user_id in \(select ec\.entered_id from public\._admin_entered_code\(\) ec\)/);
  }
});

test('the path is nested: each step requires every step before it', () => {
  const { body } = ownDefinition('admin_money_path');
  const path = body.match(/path as \(([\s\S]*?)\n  \),/)?.[1] || '';
  // One parenthesised expression opening its own line, one level of nesting
  // inside it, so a flag never borrows the text of the flag above it.
  const flag = (name) => {
    const m = path.match(new RegExp(`\\n\\s*\\(([^()]*(?:\\([^()]*\\)[^()]*)*)\\)\\s+as ${name}\\b`));
    assert.ok(m, `the path defines ${name}`);
    return m[1].replace(/\s+/g, ' ');
  };
  const pressed = 'pr.pressed_at is not null';
  const checkout = 'pr.checkout_at is not null';
  const finished = 'pr.finished_at is not null';
  assert.ok(flag('s_pressed').includes(pressed));
  for (const need of [pressed, checkout]) assert.ok(flag('s_checkout').includes(need), `s_checkout needs ${need}`);
  for (const need of [pressed, checkout, finished]) {
    assert.ok(flag('s_finished').includes(need), `s_finished needs ${need}`);
    assert.ok(flag('s_started').includes(need), `s_started needs ${need}`);
    assert.ok(flag('s_paid').includes(need), `s_paid needs ${need}`);
  }
  assert.ok(flag('s_paid').includes('x.first_paid_at is not null'));
  assert.match(path, /where pr\.saw_at is not null/, 'everyone on the path saw a price first');
  // Every later count filters on its own step, so it is drawn from the same nested rows.
  for (const [key, f] of [['pressed', 's_pressed'], ['checkout', 's_checkout'], ['finished', 's_finished'], ['started', 's_started'], ['paid', 's_paid']]) {
    assert.match(body, new RegExp(`'${key}',\\s+\\(select count\\(\\*\\) from path where ${f}\\)::int`), `steps.${key} counts ${f}`);
  }
});

test('a route flag is never NULL, so "elsewhere" is everyone the other two routes are not', () => {
  const { body } = ownDefinition('admin_money_path');
  for (const name of ['via_wall', 'via_button', 'pressed_trial', 'checkout_error']) {
    assert.match(body, new RegExp(`coalesce\\(bool_or\\([\\s\\S]*?\\), false\\)\\s+as ${name}\\b`), `${name} is coalesced`);
  }
  assert.match(body, /'elsewhere', jsonb_build_object\('people',\s+\(select count\(\*\) from path where not via_wall and not via_button\)/);
});

test('near the cap means what admin_stats means by it', () => {
  const { body } = ownDefinition('admin_money_people');
  assert.match(body, /near as \(\s*select j\.user_id from j where j\.tier = 'demo' and j\.cards >= 0\.8 \* j\.cap/);
  assert.match(body, /coalesce\(p\.card_cap_base, 50\) \+ coalesce\(p\.bonus_card_credits, 0\) as cap/);
  const stats = latestDefinition('admin_stats');
  assert.ok(stats, 'admin_stats is defined');
  assert.match(stats.body, />= 0\.8 \* \(coalesce\(p\.card_cap_base, 50\) \+ coalesce\(p\.bonus_card_credits, 0\)\)/);
});

test('a cap hit is a card refused at the cap, or the cap wall opening', () => {
  const { body } = ownDefinition('admin_money_people');
  const reasons = ['server_cap', 'demo_cap', 'demo_cap_cell'];
  assert.match(body, new RegExp(`e\\.event = 'card_create_blocked' and e\\.props->>'reason' in \\(${reasons.map((r) => `'${r}'`).join(', ')}\\)`));
  assert.match(body, /e\.event = 'pricing_view' and e\.props->>'header' = 'cap-hit'/);
  // The reasons are the cap reasons the client sends, and no others.
  const ev = readSrc('./analyticsEvents.js');
  const declared = ev.match(/CARD_CREATE_BLOCKED:[^\n]*reason:([^ ]+)/)?.[1] || '';
  for (const r of reasons) assert.ok(declared.includes(`'${r}'`), `the client sends card_create_blocked reason ${r}`);
  const app = readSrc('../App.jsx');
  assert.match(app, /reason: 'server_cap',\s+board_id: rejectedBoardId,\s+n: e\?\.detail\?\.rejected \|\| 0,/,
    'server_cap carries how many cards were refused at once, which refused_most reads');
});

test('every event and prop the reads key on is one the client emits', () => {
  const ev = readSrc('./analyticsEvents.js');
  const line = (key) => ev.match(new RegExp(`${key}:[^\\n]*`))?.[0] || '';
  assert.match(line('PRICING_CREATOR_INTENT'), /'pricing_creator_intent'.*\{plan,surface,already_paid,trial\}/);
  assert.match(line('CHECKOUT_OPEN'), /'checkout_open'/);
  assert.match(line('CHECKOUT_SUCCESS'), /'checkout_success'/);
  const summary = line('UP_EXPOSURE_SUMMARY');
  assert.match(summary, /'up_exposure_summary'/);
  for (const prop of ['trial', 'outcome', 'dismiss_method']) assert.ok(summary.includes(prop), `up_exposure_summary carries ${prop}`);
  for (const o of ['cta', 'invite_alt', 'dismiss', 'hidden']) assert.ok(summary.includes(`'${o}'`), `outcome ${o}`);
  for (const m of ['x', 'backdrop', 'maybe_later', 'esc', 'nav']) assert.ok(summary.includes(`'${m}'`), `dismiss_method ${m}`);
  assert.match(line('UPGRADE_REASON_ANSWERED'), /'upgrade_reason_answered'.*\{choice,/);
  const { body } = ownDefinition('admin_money_path');
  assert.match(body, /ev\.props->>'choice'/);
  assert.match(body, /public\._upgrade_reason_label\(r\.choice\)/, 'answers are labelled the way the ask words them');
});

// 0493 restated the people read to add who is paying and who is past due.
test('0493 adds who is paying and who is past due to the people read, and nothing else', () => {
  const FILE_0493 = '0493_admin_money_counts_paying.sql';
  const later = existsSync(join(MIGRATIONS_DIR, FILE_0493)) ? readFileSync(join(MIGRATIONS_DIR, FILE_0493), 'utf8') : '';
  assert.ok(later, `${FILE_0493} is in supabase/migrations`);
  const latest = latestDefinition('admin_money_people');
  assert.equal(latest?.file, FILE_0493, 'the people read the Money view calls is 0493\'s');
  const bodyOf = (text) => {
    const start = text.indexOf('create or replace function public.admin_money_people(');
    return text.slice(start, text.indexOf('end $function$', start)).split('\n');
  };
  const before = bodyOf(src);
  const after = bodyOf(later);
  const added = after.filter((l) => !before.includes(l)).map((l) => l.trim());
  const dropped = before.filter((l) => !after.includes(l));
  assert.deepEqual(dropped, [], 'nothing of 0492\'s body is dropped');
  assert.deepEqual(added, [
    "-- People, not revenue: admin_stats' mrr_cents is what Stripe charges",
    '-- everyone, team included; these follow the toggles like every count here.',
    "'paying',    (select count(*) from j where j.sub_status = 'active')::int,",
    "'past_due',  (select count(*) from j where j.sub_status = 'past_due')::int,",
  ]);
  const laterCode = later.replace(/--.*$/gm, '');
  assert.match(laterCode, /revoke execute on function public\.admin_money_people\(boolean, boolean\) from public, anon;/);
  assert.match(laterCode, /grant execute on function public\.admin_money_people\(boolean, boolean\) to authenticated, service_role;/);
  assert.match(laterCode, /has_function_privilege\('anon', v_sig, 'execute'\)/);
  assert.match(laterCode, /notify pgrst, 'reload schema';\s*commit;\s*$/);
});
