// adminMoneyReferralsMigration.test.mjs — 0490 makes the Funnel's money and
// referral figures count real people. It was applied to the shared database
// the day it was written, so this pins what the shipped client stands on.
//
//   node --test src/lib/adminMoneyReferralsMigration.test.mjs
//
// What this guards:
//   * the retired signatures. Three functions gained p_verified_only; each old
//     identity is renamed out of PostgREST's way and closed to every client
//     role, as in 0410 and 0460;
//   * the defaults. p_verified_only defaults to false, the old behaviour, so a
//     bundle that never sends it reads what it read;
//   * the bans. What a banned account did is left out of every referral and
//     invite figure and reported in banned_left_out, and banned accounts are
//     out of both money populations;
//   * the rewrites. Each body is its previous definition plus those filters:
//     the lines it drops and adds are listed here, so a "while I was in
//     there" edit fails;
//   * the client. The Funnel passes the toggle to all three, and the referral
//     panel says what it left out instead of dropping silently;
//   * 0491's "Invite → signup": answered emailed invites over emailed invites,
//     both from the same rows, so it can no longer pass 100%.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, migrationFiles, latestDefinition } from './migrationText.mjs';

const FILE = '0490_admin_money_and_referrals_count_real_people.sql';
const PATH = join(MIGRATIONS_DIR, FILE);
const src = existsSync(PATH) ? readFileSync(PATH, 'utf8') : '';
// 0491 restated admin_referral_stats to add one figure; the others are 0490's.
const FILE_0491 = '0491_invite_to_signup_counts_answered_invites.sql';
const PATH_0491 = join(MIGRATIONS_DIR, FILE_0491);
const src0491 = existsSync(PATH_0491) ? readFileSync(PATH_0491, 'utf8') : '';
const LATER = { admin_referral_stats: FILE_0491 };
const code = src.replace(/--.*$/gm, '');
const readSrc = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

// The same shape latestDefinition matches.
const definitionRe = (fn) => new RegExp(
  `create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?${fn}\\s*\\(` +
  `[\\s\\S]*?as\\s*(\\$[a-z_]*\\$)[\\s\\S]*?\\1\\s*;`, 'i');

const ownDefinition = (fn) => {
  const body = src.match(definitionRe(fn))?.[0];
  assert.ok(body, `${FILE} defines ${fn}`);
  return body;
};

function previousDefinition(fn) {
  let found = null;
  for (const f of migrationFiles()) {
    if (f === FILE) break;
    const m = readFileSync(join(MIGRATIONS_DIR, f), 'utf8').match(definitionRe(fn));
    if (m) found = { file: f, body: m[0] };
  }
  assert.ok(found, `${fn} was defined before ${FILE}`);
  return found;
}

// A body's code lines: comments stripped (never inside a quoted string),
// whitespace collapsed, blank lines dropped.
function bodyLines(def) {
  const m = def.match(/as\s*(\$[a-z_]*\$)([\s\S]*?)\1/i);
  assert.ok(m, 'a dollar-quoted body');
  return m[2].split('\n').map((line) => {
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      if (line[i] === "'") quoted = !quoted;
      else if (!quoted && line[i] === '-' && line[i + 1] === '-') return line.slice(0, i);
    }
    return line;
  }).map((l) => l.trim().replace(/\s+/g, ' ')).filter(Boolean);
}

// The lines one body adds and drops relative to another, as multisets.
function lineDiff(before, after) {
  const tally = (lines) => lines.reduce((m, l) => m.set(l, (m.get(l) || 0) + 1), new Map());
  const a = tally(before), b = tally(after);
  const added = [], removed = [];
  for (const [l, n] of b) for (let i = (a.get(l) || 0); i < n; i += 1) added.push(l);
  for (const [l, n] of a) for (let i = (b.get(l) || 0); i < n; i += 1) removed.push(l);
  return { added: added.sort(), removed: removed.sort() };
}

const FNS = {
  admin_referral_stats: { old: 'admin_referral_stats(integer, boolean)', renamed: 'admin_referral_stats_0377',
    sig: 'public.admin_referral_stats(integer,boolean,boolean)' },
  admin_paid_reach: { old: 'admin_paid_reach(date, boolean)', renamed: 'admin_paid_reach_0333',
    sig: 'public.admin_paid_reach(date,boolean,boolean)' },
  admin_trial_funnel: { old: 'admin_trial_funnel(boolean)', renamed: 'admin_trial_funnel_0332',
    sig: 'public.admin_trial_funnel(boolean,boolean)' },
};

const ENTERED = 'in (select ec.entered_id from public._admin_entered_code() ec))';

test('the migration exists, is one transaction, and waits at most 3s for a lock', () => {
  assert.ok(src, `${FILE} exists`);
  assert.match(src, /^begin;$/m);
  assert.match(src, /^set local lock_timeout = '3s';$/m);
  assert.ok(src.trimEnd().endsWith('commit;'), 'commits last');
  assert.match(src, /^notify pgrst, 'reload schema';$/m, 'PostgREST sees the new signatures at once');
});

test('the three retired signatures are renamed out of the way, closed, and proven gone', () => {
  const esc = (s) => s.replace(/[()[\].*+?^$|\\]/g, '\\$&');
  const proof = src.match(/do \$proof\$[\s\S]*?\$proof\$;/)?.[0] ?? '';
  for (const { old, renamed } of Object.values(FNS)) {
    const args = old.slice(old.indexOf('('));
    assert.match(src, new RegExp(`alter function public\\.${esc(old)} rename to ${renamed};`), `${old} is renamed`);
    assert.match(src, new RegExp(`revoke execute on function public\\.${renamed}${esc(args)} from public, anon, authenticated;`),
      `${renamed} is closed to every client role`);
    assert.ok(proof.includes(`('public.${old.replace(/, /g, ',')}')`), `the proof names ${old}`);
    assert.ok(proof.includes(`('public.${renamed}${args.replace(/, /g, ',')}')`), `the proof names ${renamed}`);
  }
  assert.match(proof, /if to_regprocedure\(r\.sig\) is not null then/, 'the old identities are proven gone');
  assert.match(proof, /p\.proname in \('admin_referral_stats', 'admin_paid_reach', 'admin_trial_funnel'\);\s+if v_n <> 3 then/,
    'and no overload is left beside a replacement');
  assert.doesNotMatch(code, /\bdrop\s+function\b/i, 'nothing is dropped');
});

test('p_verified_only comes last and defaults to the old behaviour', () => {
  assert.match(ownDefinition('admin_referral_stats'),
    /admin_referral_stats\(\s*p_days integer default 30,\s*p_exclude_internal boolean default true,\s*p_verified_only boolean default false\s*\)/);
  assert.match(ownDefinition('admin_paid_reach'),
    /admin_paid_reach\(\s*p_since date default '2026-06-16'::date,\s*p_exclude_internal boolean default true,\s*p_verified_only boolean default false\s*\)/);
  assert.match(ownDefinition('admin_trial_funnel'),
    /admin_trial_funnel\(\s*p_exclude_internal boolean default true,\s*p_verified_only boolean default false\s*\)/);
  for (const fn of Object.keys(FNS)) {
    assert.equal(latestDefinition(fn).file, LATER[fn] ?? FILE, `the live ${fn} is ${LATER[fn] ?? 'this one'}`);
  }
});

test('the admin reads are for signed-in callers, and the proof checks every role and rule', () => {
  const proof = src.match(/do \$proof\$[\s\S]*?\$proof\$;/)?.[0] ?? '';
  for (const { sig } of Object.values(FNS)) {
    const decl = sig.replace('public.', '').replace(/,/g, ', ');
    assert.ok(src.includes(`revoke execute on function public.${decl} from public, anon;`), `${sig}: no anon`);
    assert.ok(src.includes(`grant execute on function public.${decl} to authenticated, service_role;`), `${sig}: granted`);
    assert.ok(proof.includes(`('${sig}')`), `the proof names ${sig}`);
    assert.match(ownDefinition(sig.slice(7, sig.indexOf('('))), /begin\s+perform public\._require_admin\(\);/,
      `${sig} checks the caller before reading anything`);
  }
  assert.match(proof, /has_function_privilege\('anon', r\.sig, 'execute'\)/);
  assert.match(proof, /not has_function_privilege\('authenticated', r\.sig, 'execute'\)/);
  assert.match(proof, /not has_function_privilege\('service_role', r\.sig, 'execute'\)/);
  for (const rule of ["'%perform public._require_admin();%'", "'%public._admin_entered_code()%'", "'%banned_at is %'"]) {
    assert.ok(proof.includes(`v_def not like ${rule}`), `the proof checks ${rule}`);
  }
});

test('the money reads add the ban and the code-entry filter, and nothing else', () => {
  const reach = previousDefinition('admin_paid_reach');
  assert.equal(reach.file, '0333_deleted_clusters_stop_consuming_the_cap.sql');
  assert.deepEqual(lineDiff(bodyLines(reach.body), bodyLines(ownDefinition('admin_paid_reach'))), {
    added: [
      'and (not p_verified_only',
      'and p.banned_at is null',
      `or p.user_id ${ENTERED}`,
    ].sort(),
    removed: [],
  });

  const trial = previousDefinition('admin_trial_funnel');
  assert.equal(trial.file, '0332_money_counters_read_true.sql');
  assert.deepEqual(lineDiff(bodyLines(trial.body), bodyLines(ownDefinition('admin_trial_funnel'))), {
    added: [
      'and (not p_verified_only',
      'and a.user_id in (select e.user_id from ext e))::bigint,',
      'and p.banned_at is null',
      `or p.user_id ${ENTERED}`,
    ].sort(),
    // "Asked for it" counted anyone with the event; it counts ext now, which
    // already carries the Internal filter.
    removed: [
      'and (not p_exclude_internal or a.user_id is null',
      'or a.user_id not in (select _internal_user_ids())))::bigint,',
    ].sort(),
  });
});

test('every referral and invite figure leaves out what a banned account did, and says how much', () => {
  const prev = previousDefinition('admin_referral_stats');
  assert.equal(prev.file, '0377_audit_referral_rewards_mature.sql');
  const body = ownDefinition('admin_referral_stats');
  const { added, removed } = lineDiff(bodyLines(prev.body), bodyLines(body));

  // Every old line survives except the five the new filters had to reshape.
  assert.deepEqual(removed, [
    'with r as (',
    'or l.created_by not in (select iu.user_id from public._internal_user_ids() iu)))::int as created,',
    'or bs.invited_by not in (select iu.user_id from public._internal_user_ids() iu)))::int as claimed,',
    'and (l.expires_at is null or l.expires_at > now()))::int as active_links',
    'from agg a, inv i, links l, seats s;',
  ].sort());

  // And every new line is the ban, the toggle, the left-out tally, or the
  // plumbing those need.
  const allowed = [
    /\bbanned\b|\bbn\b|banned_at|left_out|\blr\.|\blo\./,
    /p_verified_only|_admin_entered_code/,
    /^(\),|r as \(|select|union all)$/,
    /^(where|and) \(p_days is null or p_days <= 0 or (ref|pi|bs|l)\.created_at >= now\(\) - \(p_days \|\| ' days'\)::interval\)$/,
    /^from public\.(referrals ref|pending_invites pi|board_shares bs|public_share_links l)$/,
    /^where l\.kind = 'invite'$/,
    /^and \(not p_exclude_internal or l\.created_by is null$/,
    /^or (l\.created_by|bs\.invited_by) not in \(select iu\.user_id from public\._internal_user_ids\(\) iu\)\)$/,
    /^and \(l\.expires_at is null or l\.expires_at > now\(\)\)$/,
    /^select '(invite|link|referral)'/,
    /^else ref\.referee_id end$/,
  ];
  for (const line of added) {
    assert.ok(allowed.some((re) => re.test(line)), `an unexpected new line: ${line}`);
  }

  const cte = (name) => body.match(new RegExp(`\\n  ${name} as \\(([\\s\\S]*?)\\n  \\)`))?.[1] ?? '';
  assert.match(cte('with banned') || body, /select bp\.user_id from public\.profiles bp where bp\.banned_at is not null/);
  assert.match(cte('r'), /ref\.referrer_id not in \(select bn\.user_id from banned bn\)/, 'a banned referrer');
  assert.match(cte('r'), /ref\.referee_id not in \(select bn\.user_id from banned bn\)/, 'a banned friend');
  assert.match(cte('r'), new RegExp(`not p_verified_only\\s+or ref\\.referee_id ${ENTERED.replace(/[()[\].*+?^$|\\]/g, '\\$&')}`),
    'the toggle filters the friend who joined');
  assert.match(cte('inv_pending'), /pi\.invited_by not in \(select bn\.user_id from banned bn\)/);
  assert.match(cte('inv_grants'), /bs\.invited_by not in \(select bn\.user_id from banned bn\)/);
  assert.equal((cte('links').match(/from banned bn/g) || []).length, 4, 'created, claimed (both sides) and live links');
  assert.equal((cte('links').match(/_internal_user_ids\(\)/g) || []).length, 3, 'live links honour the Internal toggle too');
  assert.match(cte('seats'), /w\.created_by not in \(select bn\.user_id from banned bn\)/);
  assert.match(cte('seats'), /bs\.user_id not in \(select bn\.user_id from banned bn\)/);
  assert.match(body, /'banned_left_out', jsonb_build_object\(\s*'accounts',\s+lo\.accounts,\s*'invites',\s+lo\.invites,\s*'links',\s+lo\.links,\s*'referrals', lo\.referrals\s*\)/);
  assert.match(body, /from agg a, inv i, links l, seats s, left_out lo;/);
});

test('the Funnel passes the toggle to all three, and the referral panel names what it left out', () => {
  const view = readSrc('../pages/admin/analytics/views/FunnelView.jsx');
  for (const fn of Object.keys(FNS)) {
    assert.match(view, new RegExp(`supabase\\.rpc\\('${fn}', \\{[^}]*p_exclude_internal: f\\.excludeInternal, p_verified_only: f\\.verifiedOnly \\}\\)`),
      `${fn} follows the deck's code-entry toggle`);
  }
  assert.match(view, /referrals: val\(rf\), multiplayer: val\(mp\) \};\s+\}, \[days, f\.excludeInternal, f\.verifiedOnly\]\);/,
    'and the referral read refetches when it flips');

  const panel = readSrc('../pages/admin/analytics/widgets/AdminReferralsSection.jsx');
  assert.match(panel, /bannedNote\(d\?\.banned_left_out\)/);
  assert.equal((panel.match(/\{leftOut && <div className="admin-panel-note">\{leftOut\}<\/div>\}/g) || []).length, 2,
    'in the empty state and under the figures');
});

test('0491: "Invite → signup" is answered emailed invites over emailed invites, and nothing else moved', () => {
  assert.ok(src0491, `${FILE_0491} exists`);
  assert.match(src0491, /^begin;$/m);
  assert.match(src0491, /^set local lock_timeout = '3s';$/m);
  assert.ok(src0491.trimEnd().endsWith('commit;'));
  assert.match(src0491, /^notify pgrst, 'reload schema';$/m);
  // Same signature, so create or replace keeps the grants and the comment, and
  // the proof checks both rather than restating them.
  assert.doesNotMatch(src0491, /^\s*(?:(?:drop|alter) function|grant|revoke)\b/im);
  const proof = src0491.match(/do \$proof\$[\s\S]*?\$proof\$;/)?.[0] ?? '';
  assert.match(proof, /v_sig constant text := 'public\.admin_referral_stats\(integer,boolean,boolean\)';/);
  assert.match(proof, /has_function_privilege\('anon', v_sig, 'execute'\)/);
  assert.match(proof, /not has_function_privilege\('authenticated', v_sig, 'execute'\)/);
  assert.match(proof, /obj_description\(v_sig::regprocedure, 'pg_proc'\) not like '%banned_left_out%'/);
  assert.match(proof, /p\.proname = 'admin_referral_stats'\) <> 1 then/);

  const body = src0491.match(definitionRe('admin_referral_stats'))?.[0];
  assert.ok(body, `${FILE_0491} defines admin_referral_stats`);
  const { added, removed } = lineDiff(bodyLines(ownDefinition('admin_referral_stats')), bodyLines(body));
  assert.deepEqual(removed, ['select pi.invited_by']);
  assert.deepEqual(added, [
    "'signed_up', i.signed_up,",
    '(select count(*) from inv_pending ip',
    'and (not p_verified_only',
    'and ip.claimed_by not in (select bn.user_id from banned bn)',
    `or ip.claimed_by ${ENTERED})::int as signed_up,`,
    'select pi.invited_by, pi.claimed_by',
    'where ip.claimed_by is not null',
  ].sort());

  const panel = readSrc('../pages/admin/analytics/widgets/AdminReferralsSection.jsx');
  assert.match(panel, /<RateCell numer=\{invites\.signed_up \|\| 0\} denom=\{invites\.pending_signup \|\| 0\} \/>/,
    'the panel divides the answered invites by the same invites');
  assert.doesNotMatch(panel, /numer=\{bySource\.collab\?\.total/, 'not every collaboration referral, links included');
});
