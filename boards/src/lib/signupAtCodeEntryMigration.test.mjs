// signupAtCodeEntryMigration.test.mjs — 0461 counts a signup once the emailed
// code is entered, not when an address is typed. It was applied to the shared
// database the day it was written, so this pins what every admin figure of
// signups and users stands on.
//
//   node --test src/lib/signupAtCodeEntryMigration.test.mjs
//
// What this guards, beyond the grants:
//   * one definition. _admin_entered_code() is the only place the evidence is
//     read, and every reader that took 0149's rule asks it, so no two figures
//     count a signup two ways again;
//   * the swaps. Each restated body is the one before it with only that
//     predicate replaced, so a "while I was in there" edit fails here. The four
//     bodies that had drifted from their files are named, and what drifted is
//     checked too;
//   * the headers. A restatement declares the arguments, defaults, return
//     type and attributes it had, so 0461 changed bodies and nothing else;
//   * the hand edits: the funnel's steps and its leak row, the journey's phase
//     order, the Universe payload counting people once (and still carrying no
//     clock), and the predictors reading day one in one pass;
//   * history. metrics_daily is restated by the same rule, so no chart steps
//     down at this migration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MIGRATIONS_DIR, migrationFiles, latestDefinition, CODE_ENTRY_FILE, codeEntrySwap, bodyText,
} from './migrationText.mjs';
import { JOURNEY_PHASE_ORDER } from './analyticsEvents.js';

const FILE = CODE_ENTRY_FILE;
const FILE_0462 = '0462_users_list_says_who_entered_the_code.sql';
const FILE_0705 = '0705_mcp_drafts.sql';
// Read leniently so a missing file fails every test on its own assertion
// rather than as one unreadable module crash.
const readMigration = (f) => (existsSync(join(MIGRATIONS_DIR, f)) ? readFileSync(join(MIGRATIONS_DIR, f), 'utf8') : '');
const src = readMigration(FILE);
const code = src.replace(/--.*$/gm, '');

const HELPER = '_admin_entered_code';
const HAND_EDITS = ['admin_journey_dropoff', 'admin_return_predictors', 'admin_signup_funnel', 'admin_universe_stats'];

// The populations that had filtered on email_confirmed_at alone. They took the
// same helper in its place.
const CONFIRMED_ALONE = ['admin_activation_by_experiment', 'admin_geo_breakdown', 'admin_landing_scorecard',
                         'admin_retention_by_experiment', 'admin_time_to_first_card'];

// Live, before 0461, other than their files say: three without comments the
// files carry (admin_first_session_compare also with work_mem raised), and
// admin_user_lifespan with its bucket labels hyphenated where its file has
// dashes. 0461 records them as live.
const DRIFTED = ['admin_first_session_compare', 'admin_retention_cohort_matrix', 'admin_stats', 'admin_user_lifespan'];

// 0149's verified rule, either way round.
const RULE_0149 = /email_confirmed_at\s+is\s+(not\s+)?null\s+(and|or)\s+([a-z_]+\.)?last_sign_in_at\s+is\s+(not\s+)?null/i;

// ── Reading definitions ─────────────────────────────────────────────────────

const DEF_RE = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z0-9_]+)\s*\([\s\S]*?as\s*(\$[a-z_]*\$)[\s\S]*?\2\s*;/gi;

// A type or default as the catalog would print it: lower case, the long names,
// no casts. Lets a hand-written header be compared with pg_get_functiondef's.
const canon = (s) => s.toLowerCase()
  .replace(/\btimestamp with time zone\b/g, 'timestamptz')
  .replace(/\bint4\b|\bint\b/g, 'integer')
  .replace(/\bint8\b/g, 'bigint')
  .replace(/\bbool\b/g, 'boolean')
  .replace(/::[a-z_]+/g, '')
  .replace(/\s+/g, ' ')
  .replace(/\(\s+/g, '(').replace(/\s+\)/g, ')')
  .trim();

// Split on commas outside parentheses and quotes.
function splitTop(s) {
  const out = [];
  let depth = 0, quoted = false, cur = '';
  for (const ch of s) {
    if (ch === "'") quoted = !quoted;
    if (!quoted && ch === '(') depth += 1;
    if (!quoted && ch === ')') depth -= 1;
    if (!quoted && depth === 0 && ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => x.trim());
}

// Comments stripped line-wise, never inside a quoted string.
const uncomment = (text) => text.split('\n').map((line) => {
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === "'") quoted = !quoted;
    else if (!quoted && line[i] === '-' && line[i + 1] === '-') return line.slice(0, i);
  }
  return line;
}).join('\n');

// A definition's header: its arguments (with defaults), its argument types,
// what it returns, and its attributes.
function header(definition) {
  const def = uncomment(definition.slice(0, definition.search(/\bas\s*\$[a-z_]*\$/i)));
  const open = def.indexOf('(');
  let depth = 0, quoted = false, close = open;
  for (; close < def.length; close += 1) {
    const ch = def[close];
    if (ch === "'") quoted = !quoted;
    else if (!quoted && ch === '(') depth += 1;
    else if (!quoted && ch === ')' && (depth -= 1) === 0) break;
  }
  const args = splitTop(def.slice(open + 1, close)).map(canon);
  const rest = canon(def.slice(close + 1))
    .replace(/set (\w+) to /g, 'set $1 = ')
    .replace(/set (\w+) = '([^']*)'/g, 'set $1 = $2');
  const KEYWORD = /\s+(?=language |stable\b|volatile\b|immutable\b|security |set |strict\b|parallel )/;
  const [returns, ...attrs] = rest.split(KEYWORD);
  if (!attrs.some((a) => /^(stable|volatile|immutable)$/.test(a))) attrs.push('volatile');
  return {
    args,
    types: args.map((a) => a.split(' ')[1]),
    returns: returns.replace(/^returns /, '').replace(/^table\s*\(/, 'table ('),
    attrs: attrs.map((a) => a.trim()).sort(),
  };
}

function definitionsIn(sql) {
  return [...sql.matchAll(DEF_RE)].map((m) => ({ name: m[1].toLowerCase(), body: m[0], ...header(m[0]) }));
}

const sig = (d) => `public.${d.name}(${d.types.join(',')})`;
const HERE = definitionsIn(src);
const one = (name) => {
  const defs = HERE.filter((d) => d.name === name);
  assert.equal(defs.length, 1, `${FILE} defines ${name} once`);
  return defs[0];
};

// The last definition of the same identity before this file: what 0461 restated.
function previousDefinition(d) {
  let found = null;
  for (const f of migrationFiles()) {
    if (f === FILE) break;
    const same = definitionsIn(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
      .filter((x) => x.name === d.name && sig(x) === sig(d));
    if (same.length) found = { file: f, ...same.at(-1) };
  }
  assert.ok(found, `${sig(d)} was defined before ${FILE}`);
  return found;
}

// A body's code lines: comments stripped line-wise (never inside a quoted
// string), whitespace collapsed, blank lines dropped.
function bodyLines(def) {
  const m = def.match(/as\s*(\$[a-z_]*\$)([\s\S]*?)\1/i);
  assert.ok(m, 'a dollar-quoted body');
  return uncomment(m[2]).split('\n').map((l) => l.trim().replace(/\s+/g, ' ')).filter(Boolean);
}

// The lines a rewrite added and removed, comments aside.
function delta(before, after) {
  const b = bodyLines(before), a = bodyLines(after);
  return { added: a.filter((l) => !b.includes(l)), removed: b.filter((l) => !a.includes(l)) };
}

// One CTE's text, for bodies laid out as "\n  name as (" … "\n  )".
function cteIn(body, name) {
  const m = body.match(new RegExp(`\\n  ${name} as \\(([\\s\\S]*?)\\n  \\)`));
  assert.ok(m, `the ${name} CTE`);
  return m[1];
}

const proof = src.match(/do \$proof\$[\s\S]*?\$proof\$;/)?.[0] ?? '';
const proofArray = (name) => {
  const m = proof.match(new RegExp(`${name} regprocedure\\[\\] := array\\[([\\s\\S]*?)\\]::regprocedure\\[\\];`));
  assert.ok(m, `the proof declares ${name}`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
};

// ── The tests ───────────────────────────────────────────────────────────────

test('the migration exists, is one transaction, waits at most 3s for a lock, and reloads PostgREST', () => {
  assert.ok(src, `${FILE} exists`);
  assert.match(src, /^begin;$/m, 'opens a transaction');
  assert.match(src, /^set local lock_timeout = '3s';$/m, 'never queues behind a long lock');
  assert.ok(src.trimEnd().endsWith('commit;'), 'and commits it last');
  assert.match(src, /^notify pgrst, 'reload schema';$/m);
  // create or replace keeps every identity, and with it every grant.
  assert.doesNotMatch(code, /\bdrop\s+function\b/i, 'nothing is dropped');
});

test('a signup is one helper, reading four kinds of evidence, that only definer functions can call', () => {
  const h = one(HELPER);
  assert.deepEqual(h.args, []);
  assert.equal(h.returns, 'table (entered_id uuid)');
  assert.deepEqual(h.attrs, ['language sql', 'security definer', 'set search_path = public', 'stable']);
  assert.deepEqual(bodyLines(h.body), [
    'select u.id',
    'from auth.users u',
    'where u.email_confirmed_at is not null',
    'and ( u.id in (select w.created_by from public.workspaces w)',
    'or u.id in (select d.user_id from public.user_active_day d)',
    'or (select count(*) from auth.sessions s where s.user_id = u.id) > 1',
    'or exists (select 1 from public.analytics_events e',
    'where e.user_id = u.id and e.session_id is not null));',
  ], 'a workspace, a presence day, a second session, or a client event');
  assert.match(src, /^revoke all on function public\._admin_entered_code\(\) from public, anon, authenticated;$/m);
  const grants = [...src.matchAll(/grant execute on function public\._admin_entered_code\(\) to ([^;]+);/g)].map((m) => m[1]);
  assert.deepEqual(grants, ['service_role'], 'granted to service_role only');
  assert.match(src, /^comment on function public\._admin_entered_code\(\) is$/m);

  // 0705 restated it to leave out the accounts nobody signs in to (an MCP
  // draft, a service identity, a Scout shell): one line, and nothing else.
  assert.equal(latestDefinition(HELPER).file, FILE_0705);
  const src0705 = readMigration(FILE_0705);
  const live = definitionsIn(src0705).filter((d) => d.name === HELPER);
  assert.equal(live.length, 1, `${FILE_0705} defines ${HELPER} once`);
  assert.deepEqual([live[0].args, live[0].returns, live[0].attrs], [h.args, h.returns, h.attrs], 'the same header');
  const expected = bodyLines(h.body);
  expected.splice(3, 0, 'and not public._synthetic_address(u.email)');
  assert.deepEqual(bodyLines(live[0].body), expected, "0461's body with the synthetic addresses left out");
  assert.match(src0705, /^revoke all on function public\._admin_entered_code\(\) from public, anon, authenticated;$/m);
  const grants0705 = [...src0705.matchAll(/grant execute on function public\._admin_entered_code\(\) to ([^;]+);/g)].map((m) => m[1]);
  assert.deepEqual(grants0705, ['service_role'], 'still granted to service_role only');
});

test("every reader that took 0149's rule asks the helper, and the proof names each one", () => {
  const readers = HERE.filter((d) => d.name !== HELPER && d.name !== 'admin_journey_dropoff' && d.name !== 'admin_signup_funnel');
  assert.deepEqual(readers.map(sig).sort(), [...proofArray('v_readers')].sort(), 'the proof names every reader, and only those');
  for (const d of readers) {
    assert.match(d.body, /public\._admin_entered_code\(\)/, `${sig(d)} asks the helper`);
    assert.doesNotMatch(d.body, RULE_0149, `${sig(d)} no longer counts by 0149's rule`);
  }
  for (const name of CONFIRMED_ALONE) {
    assert.doesNotMatch(one(name).body, /email_confirmed_at\s+is\s+not\s+null/i, `${name} no longer counts confirmed addresses`);
  }
  // 0462 moved one more column of admin_list_users onto the helper; 0472 gave
  // admin_event_coverage four more rows, and 0475 counted an import's start
  // toward first_cluster; 0495 made admin_first_session_compare read each
  // signup day once. Each later body still asks the helper.
  const LATER = {
    admin_list_users: FILE_0462,
    admin_event_coverage: '0475_import_clusters_count_as_imports.sql',
    admin_first_session_compare: '0495_first_session_compare_reads_day_one_once.sql',
  };
  // The helper itself was restated by 0705 (pinned in the test above).
  for (const name of new Set(HERE.map((d) => d.name))) {
    const live = name === HELPER ? FILE_0705 : LATER[name];
    assert.equal(latestDefinition(name).file, live ?? FILE, `the live ${name} is ${live ?? 'this one'}`);
  }
  for (const name of Object.keys(LATER)) {
    assert.match(latestDefinition(name).body, /public\._admin_entered_code\(\)/, `${name} in ${LATER[name]} still asks the helper`);
  }
  assert.deepEqual(proofArray('v_closed'), [
    'public._admin_people(boolean,boolean)',
    'public._admin_visits(date,boolean,boolean,integer)',
    'public.capture_metrics_daily(date)',
  ], 'the definer-only helpers and the cron entry point stay closed to clients');
});

test('each restated body is the one before it with only the predicate replaced', () => {
  const swapped = HERE.filter((d) => d.name !== HELPER && !HAND_EDITS.includes(d.name));
  assert.equal(swapped.length, 31);
  const alone = [], other = [];
  for (const d of swapped) {
    const prev = previousDefinition(d);
    const now = bodyText(d.body);
    const as0149 = bodyText(codeEntrySwap(prev.body));
    const asAlone = bodyText(codeEntrySwap(prev.body, { confirmedAlone: true }));
    if (now === as0149 && as0149 !== bodyText(prev.body)) continue;
    if (now === asAlone && asAlone !== bodyText(prev.body)) alone.push(d.name);
    else other.push(d.name);
  }
  assert.deepEqual(alone.sort(), CONFIRMED_ALONE);
  assert.deepEqual(other.sort(), DRIFTED, 'only the drifted bodies differ by more than the swap');

  // And the drift is what DRIFTED says it is.
  for (const name of DRIFTED) {
    const d = one(name);
    const undash = (l) => (name === 'admin_user_lifespan' ? l.replace(/'(\d+)–(\d+)'/g, "'$1-$2'") : l);
    assert.deepEqual(bodyLines(d.body), bodyLines(codeEntrySwap(previousDefinition(d).body)).map(undash),
      `${name}: the swap, once comments are set aside`);
  }
});

test('every restatement declares the arguments, defaults, return type and attributes it had', () => {
  const moved = [];
  for (const d of HERE.filter((x) => x.name !== HELPER)) {
    const prev = previousDefinition(d);
    for (const part of ['args', 'returns', 'attrs']) {
      if (JSON.stringify(d[part]) !== JSON.stringify(prev[part])) {
        moved.push(`${sig(d)} ${part}: ${JSON.stringify(prev[part])} -> ${JSON.stringify(d[part])}`);
      }
    }
  }
  assert.deepEqual(moved, [
    'public.admin_first_session_compare(date,integer,boolean,boolean) attrs: '
      + '["language plpgsql","security definer","set search_path = public","stable"] -> '
      + '["language plpgsql","security definer","set search_path = public","set work_mem = 24mb","stable"]',
  ], 'the one header that had drifted, recorded as it is live');
});

test('the signup funnel names its code steps for what they count, and derives the never-entered leak', () => {
  const d = one('admin_signup_funnel');
  assert.deepEqual(delta(previousDefinition(d).body, d.body), {
    added: [
      "(2, 'email_submit', 'Asked for a code', 'core'),",
      "(3, 'otp_verify', 'Entered the code', 'core'),",
      "(20, 'email_submit_error', 'Code request failed', 'leak'),",
      "(21, 'otp_verify_error', 'Code not accepted', 'leak'),",
      "(24, 'checkout_error', 'Checkout failed', 'leak'),",
      "(25, 'code_never_entered', 'Never entered the code', 'leak')",
      'union all',
      "select 'code_never_entered', count(*), 0",
      'from (select e.session_id',
      'from ev e join sel on sel.session_id = e.session_id',
      "where e.event in ('email_submit', 'otp_verify')",
      'group by e.session_id',
      "having not bool_or(e.event = 'otp_verify')) asked",
    ],
    removed: [
      "(2, 'email_submit', 'Email submitted', 'core'),",
      "(3, 'otp_verify', 'OTP verified (account)', 'core'),",
      "(20, 'email_submit_error', 'Email submit failed', 'leak'),",
      "(21, 'otp_verify_error', 'OTP verify failed', 'leak'),",
      "(24, 'checkout_error', 'Checkout failed', 'leak')",
    ],
  });
});

test('the journey orders setup where the client does', () => {
  const d = one('admin_journey_dropoff');
  const values = d.body.match(/ord\(phase, ordn\) as \(values([\s\S]*?\))\),/)?.[1] ?? '';
  const pairs = [...values.matchAll(/\('([a-z_]+)',(\d+)\)/g)].map((m) => [m[1], Number(m[2])]);
  assert.deepEqual(pairs.map(([phase]) => phase), [...JOURNEY_PHASE_ORDER], 'JOURNEY_PHASE_ORDER, phase for phase');
  assert.deepEqual(pairs.map(([, n]) => n), JOURNEY_PHASE_ORDER.map((_, i) => i + 1));
  const { added, removed } = delta(previousDefinition(d).body, d.body);
  assert.ok([...added, ...removed].every((l) => /^\('[a-z_]+',\d+\)/.test(l)), 'nothing but the order moved');
});

test('the return predictors read day one in one pass, by a range the index can use', () => {
  const d = one('admin_return_predictors');
  const prev = previousDefinition(d);
  // Every signal asked ev again for every person: the cost grew with the
  // square of the signups, and the panel ran past the API's statement timeout.
  assert.match(prev.body, /exists \(select 1 from ev/, 'the shape this replaced');
  assert.doesNotMatch(d.body, /exists\s*\(\s*select\s+1\s+from\s+ev\b/i, 'no per-person scan of ev');
  assert.match(cteIn(d.body, 'ev'), /where e\.occurred_at >= u\.signup and e\.occurred_at < u\.signup \+ 1/,
    'the signup day as a range');
  assert.match(cteIn(d.body, 'per_user'), /from ev e\s+group by e\.user_id\s*$/, 'one row per person');
  assert.match(cteIn(d.body, 'flags'), /left join per_user p on p\.user_id = u\.user_id/, 'a person with no events still counts');
  const unwith = (b) => b.replace(/\n  with u as \(/, '\n  u as (');
  for (const cte of ['u', 'err', 'outcome', 'long', 'banded', 'cells']) {
    assert.deepEqual(bodyLines(`as $x$${cteIn(unwith(d.body), cte)}$x$`),
      bodyLines(`as $x$${cteIn(unwith(codeEntrySwap(prev.body)), cte)}$x$`), `the ${cte} CTE is the one before it`);
  }
  const tail = (b) => bodyLines(b).slice(bodyLines(b).indexOf('select c.k, c.band, c.band_ord,'));
  assert.deepEqual(tail(d.body), tail(prev.body), 'and so is the final select');
});

test('admin_universe_stats counts its people once for all three windows, and still carries no clock', () => {
  const d = one('admin_universe_stats');
  const prev = previousDefinition(d);
  assert.equal(prev.file, '0460_admin_numbers_tell_the_truth.sql');
  assert.deepEqual(delta(prev.body, d.body), {
    added: [
      'v_people record;',
      'select count(*) as total,',
      'count(*) filter (where u.created_at >= v_since) as last_24h,',
      'count(*) filter (where u.created_at >= v_midnight) as today',
      'into v_people',
      'from auth.users u',
      'where u.id in (select ec.entered_id from public._admin_entered_code() ec);',
      "'total_users', v_people.total,",
      "'users', v_people.last_24h,",
      "'users', v_people.today,",
    ],
    removed: [
      "'total_users', (select count(*) from auth.users",
      'where email_confirmed_at is not null and last_sign_in_at is not null),',
      "'users', (select count(*) from auth.users",
      'where email_confirmed_at is not null and last_sign_in_at is not null',
      'and created_at >= v_since),',
      "'users', (select count(*) from auth.users",
      'where email_confirmed_at is not null',
      'and last_sign_in_at is not null',
      'and created_at >= v_midnight),',
    ],
  });
  // The party worker diffs this payload every second and pushes on change.
  assert.equal(d.body.match(/now\(\)/g)?.length, 2, 'now() only in the two declared bounds');
});

test("history moves with the definition: metrics_daily's signups and running total are restated by the same rule", () => {
  const m = code.match(/with signed as \(([\s\S]*?)\)\s*update public\.metrics_daily m\s+set ([\s\S]*?);/);
  assert.ok(m, 'one restatement of metrics_daily');
  assert.match(m[1], /where u\.id in \(select ec\.entered_id from public\._admin_entered_code\(\) ec\)/, 'by the helper');
  const cols = [...m[2].matchAll(/(?:^|,\s*)(\w+)\s+=/g)].map((x) => x[1]);
  assert.deepEqual(cols, ['signups', 'total_users'], 'the tier and money columns stay the snapshots they were');
  assert.match(m[2], /s\.created_at >= m\.day and s\.created_at < m\.day \+ 1/, "a day's signups are that day's");
  assert.match(m[2], /total_users = \(select count\(\*\) from signed s where s\.created_at < m\.day \+ 1\)/, 'everyone by its end');
  assert.equal(code.match(/update public\.metrics_daily/g)?.length, 1);

  // And the nightly capture counts them the same way from here on.
  const capture = one('capture_metrics_daily').body;
  assert.match(capture, /where id in \(select ec\.entered_id from public\._admin_entered_code\(\) ec\)\s+and created_at >= p_day and created_at < p_day \+ 1\)::int,/);
  assert.match(capture, /from public\.subscriptions where status = 'active'/, 'MRR is still active subscriptions only');
});

test('the proof checks the helper, every reader, and both hand-edited shapes', () => {
  assert.ok(proof, 'a do $proof$ block');
  assert.match(proof, /has_function_privilege\('anon', 'public\._admin_entered_code\(\)', 'execute'\)/);
  assert.match(proof, /has_function_privilege\('authenticated', 'public\._admin_entered_code\(\)', 'execute'\)/);
  assert.match(proof, /aclexplode\(p\.proacl\) a\s+where p\.oid = 'public\._admin_entered_code\(\)'::regprocedure and a\.grantee = 0/,
    'PUBLIC holds nothing on it');
  assert.match(proof, /not has_function_privilege\('service_role', 'public\._admin_entered_code\(\)', 'execute'\)/);
  assert.match(proof, /foreach v_fn in array v_readers loop/);
  assert.match(proof, /if v_src !~ 'public\\\._admin_entered_code\\\(\\\)' then/, 'each reader is proven to ask the helper');
  assert.match(proof, /has_function_privilege\('anon', v_fn, 'execute'\)/);
  assert.match(proof, /has_function_privilege\('authenticated', v_fn, 'execute'\) = \(v_fn = any \(v_closed\)\)/,
    "each reader's grant is proven unchanged");
  assert.match(proof, /'public\.admin_journey_dropoff\(integer,boolean\)'::regprocedure/);
  assert.match(proof, /'public\.admin_signup_funnel\(integer,text,text,text,boolean,boolean\)'::regprocedure/);
});

test("0462: the Users list's email_confirmed is the helper's verdict, and nothing else in it moved", () => {
  const src462 = readMigration(FILE_0462);
  assert.ok(src462, `${FILE_0462} exists`);
  assert.match(src462, /^begin;$/m);
  assert.match(src462, /^set local lock_timeout = '3s';$/m);
  assert.ok(src462.trimEnd().endsWith('commit;'));
  assert.match(src462, /^notify pgrst, 'reload schema';$/m);
  // create or replace keeps the grants, so nothing here restates them.
  assert.doesNotMatch(src462.replace(/--.*$/gm, ''), /\b(drop\s+function|grant|revoke)\b/i);

  const defs = definitionsIn(src462);
  assert.deepEqual(defs.map(sig), ['public.admin_list_users(integer,integer,text,text,text,text,text,text,text,text)']);
  const [d] = defs;
  const prev = one('admin_list_users');
  for (const part of ['args', 'returns', 'attrs']) assert.deepEqual(d[part], prev[part], `the same ${part} as 0461's`);
  assert.notEqual(bodyText(d.body), bodyText(prev.body));
  assert.equal(bodyText(d.body), bodyText(codeEntrySwap(prev.body, { confirmedAlone: true })), 'only email_confirmed moved');
  assert.match(d.body, /\(u\.id in \(select ec\.entered_id from public\._admin_entered_code\(\) ec\)\) as email_confirmed,/);
  assert.doesNotMatch(d.body, /email_confirmed_at/, 'the raw stamp is read nowhere in it');
  assert.equal(latestDefinition('admin_list_users').file, FILE_0462);

  const proof462 = src462.match(/do \$proof\$[\s\S]*?\$proof\$;/)?.[0] ?? '';
  assert.match(proof462, /'public\.admin_list_users\(integer,integer,text,text,text,text,text,text,text,text\)'/);
  assert.match(proof462, /if v_src ~ 'email_confirmed_at' then/);
  assert.match(proof462, /has_function_privilege\('anon', v_fn, 'execute'\)/);
  assert.match(proof462, /not has_function_privilege\('authenticated', v_fn, 'execute'\)/);
  assert.match(proof462, /not has_function_privilege\('service_role', v_fn, 'execute'\)/);
});
