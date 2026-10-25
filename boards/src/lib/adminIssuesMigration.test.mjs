// adminIssuesMigration.test.mjs — 0582, the reads behind Admin, Errors.
//
//   node --test src/lib/adminIssuesMigration.test.mjs
//
// The Issues view is where every problem waits now that nothing routine is
// emailed (0581), so its counts have to mean what 0581's mean, staff have to
// stay out of them, and a failure the app records in analytics has to reach
// it. Each of those is read out of the latest definitions here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, latestDefinition } from './migrationText.mjs';
import { EV } from './analyticsEvents.js';
import { FEATURE_EVENTS } from './featureEvents.js';
import { ISSUE_LENSES } from './adminIssues.js';

const FILE = '0582_admin_issues_view.sql';
const src = readFileSync(join(MIGRATIONS_DIR, FILE), 'utf8');
const SRC_DIR = new URL('../', import.meta.url).pathname;

const body = (name) => {
  const def = latestDefinition(name);
  assert.ok(def, `${name} is defined`);
  return def.body;
};

const READS = ['admin_error_groups', 'admin_error_group', 'admin_error_session_trail',
  'admin_set_error_group_status', 'admin_user_errors', 'admin_failure_events', 'admin_click_friction'];
const COUNTS = ['admin_error_groups', 'admin_error_group', 'admin_failure_events', 'admin_click_friction'];

test('every read is an admin\'s, asked before anything else', () => {
  for (const fn of READS) {
    const b = body(fn);
    const begin = b.indexOf('\nbegin\n');
    assert.ok(begin > 0, `${fn} is plpgsql`);
    assert.match(b.slice(begin, begin + 60), /perform public\._require_admin\(\);/, `${fn} asks first`);
    assert.match(b, /security definer/);
  }
});

test('staff stay out of every count: their accounts and their browsers', () => {
  for (const fn of COUNTS) {
    const b = body(fn);
    assert.match(b, /from public\._internal_user_ids\(\) iu where p_exclude_internal/, `${fn}: staff accounts`);
    assert.match(b, /from public\._internal_session_ids\(\) s where p_exclude_internal/, `${fn}: staff browsers`);
    // NOT EXISTS, never NOT IN: one null id would empty a NOT IN.
    assert.match(b, /not exists \(select 1 from internal_users i where i\.user_id = \w\.user_id\)/);
    assert.match(b, /not exists \(select 1 from internal_sessions s where s\.session_id = \w\.session_id\)/);
    assert.doesNotMatch(b, /not in \(select/i);
    assert.match(b, /p_exclude_internal boolean default true/, `${fn} leaves staff out unless asked`);
  }
});

test('"people" is the person 0581 counts', () => {
  const person = 'coalesce(e.session_id::text, e.user_id::text, e.app_session_id::text) as person';
  assert.ok(body('_breaking_candidates').includes(person), "0581's person");
  assert.ok(body('admin_error_groups').includes(person));
  assert.ok(body('admin_error_group').includes(person));
});

test("the lenses are the view's, and the monitors are 0581's other channels", () => {
  const lens = body('_error_lens_ok');
  const groups = body('admin_error_groups');
  const known = groups.match(/if v_lens not in \(([^)]*)\)/)[1].match(/'(\w+)'/g).map((s) => s.slice(1, -1));
  assert.deepEqual([...known].sort(), [...ISSUE_LENSES.map((l) => l.id), 'all'].sort());
  for (const l of ISSUE_LENSES.filter((x) => !['problems', 'monitors'].includes(x.id))) {
    assert.match(lens, new RegExp(`when '${l.id}'`), `_error_lens_ok knows ${l.id}`);
  }
  const monitors = (sql) => sql.match(/'csp_violation'[^)]*/)[0].match(/'(\w+)'/g).sort();
  assert.deepEqual(monitors(lens), monitors(body('_breaking_candidates')), 'the same five kinds 0581 never emails');
  assert.match(lens, /not public\._error_is_bot_ua\(p_user_agent\)/, 'a crawler is nobody\'s problem');
});

test('badges: breaking is what 0581 would email now, read without sending', () => {
  const groups = body('admin_error_groups');
  assert.match(groups, /from public\.check_breaking\(true\) b/);
  assert.doesNotMatch(groups, /check_breaking\(false\)/);
  assert.match(groups, /exception when others then/, 'a failing check never takes the view down');
  assert.match(groups, /a\.kind in \('something_is_breaking', 'error_watch_is_failing'\) and a\.page/);
  const kind = body('check_breaking').match(/c_kind\s+constant text\s+:= '([^']+)'/)[1];
  assert.equal(kind, 'something_is_breaking');
  // breakingOutcome() rewords these three; a new wording would show raw.
  for (const o of ['would email', 'would record: 6 emails today', 'emailed in the last 6 hours']) {
    assert.ok(body('check_breaking').includes(`'${o}'`), `0581 still says "${o}"`);
  }
});

test("statuses are 0580's, and resolving remembers its releases", () => {
  const set = body('admin_set_error_group_status');
  assert.match(set, /p_status not in \('open', 'resolved', 'muted'\)/);
  assert.match(readFileSync(join(MIGRATIONS_DIR, '0580_every_failure_on_record.sql'), 'utf8'),
    /check \(status in \('open', 'resolved', 'muted'\)\)/);
  assert.match(set, /resolved_releases = case when p_status = 'resolved' then/);
  assert.match(set, /status_by = auth\.uid\(\)/);
  // A reopened problem leaves 0581's emails open to it again.
  assert.match(set, /if p_status = 'open' then\s+delete from public\.client_error_mutes/);
});

// Every logEvent / logRun / env.log call in src, with its event and the props
// written in its literal.
function eventCalls() {
  const out = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(m?js|jsx)$/.test(f) && !/\.test\./.test(f)) {
        const t = readFileSync(p, 'utf8');
        const re = /\b(?:logEvent|logRun|log)\(\s*EV\.([A-Z0-9_]+)\s*,\s*\{([\s\S]{0,600}?)\}\s*\)/g;
        let m;
        while ((m = re.exec(t))) out.push({ key: m[1], props: m[2], file: p.slice(SRC_DIR.length) });
      }
    }
  };
  walk(SRC_DIR);
  return out;
}

test('every failure the app records in analytics reaches Failed actions', () => {
  const isFailure = body('_event_is_failure');
  const names = body('_failure_event_names');
  const nameRe = new RegExp(isFailure.match(/~ '([^']+)'/)[1]);
  assert.equal(names.match(/~ '([^']+)'/)[1], isFailure.match(/~ '([^']+)'/)[1], 'one name rule in both');
  const explicit = isFailure.match(/in \(('editor_limit_refused'[^)]*)\)/)[1].match(/'(\w+)'/g).map((s) => s.slice(1, -1));
  const outcome = body('_outcome_events').match(/array\[([\s\S]*?)\]/)[1].match(/'(\w+)'/g).map((s) => s.slice(1, -1));
  const values = new Set(Object.values(EV));
  for (const n of [...explicit, ...outcome]) assert.ok(values.has(n), `${n} is an EV value`);
  const caught = (v) => nameRe.test(v) || explicit.includes(v) || outcome.includes(v);

  // featureEvents.js says how each feature fails.
  for (const [feature, ev] of Object.entries(FEATURE_EVENTS)) {
    for (const key of ev.failure || []) {
      assert.ok(caught(key), `${feature}'s failure ${key} is never counted`);
    }
  }
  // And any event whose props carry an outcome.
  const calls = eventCalls();
  assert.ok(calls.length > 100, 'the call reader still finds logEvent calls');
  for (const c of calls) {
    if (!/\b(ok|outcome|result|status|failed)\s*:/.test(c.props)) continue;
    const v = EV[c.key];
    assert.ok(v, `EV.${c.key} exists (${c.file})`);
    assert.ok(caught(v), `${v} carries an outcome (${c.file}) but _outcome_events() doesn't list it`);
  }
});

test('clicks: the trace events and the two kinds appTrace.js records', () => {
  const clicks = body('admin_click_friction');
  const traces = clicks.match(/a\.event in \(([^)]*)\)/)[1].match(/'(\w+)'/g).map((s) => s.slice(1, -1));
  const values = new Set(Object.values(EV));
  for (const t of traces) assert.ok(values.has(t), `${t} is an EV value`);
  assert.match(clicks, /x\.r->>'k' in \('dead', 'rage'\)/);
  const trace = readFileSync(join(SRC_DIR, 'lib/appTrace.js'), 'utf8');
  assert.match(trace, /'dead'/);
  assert.match(trace, /'rage'/);
});

test('a trail never shows an event\'s attribution, and paths are templates', () => {
  const props = body('_trail_props');
  assert.match(props, /\^\(lt_\|utm_\|exp_\|referrer\)/);
  const trail = body('admin_error_session_trail');
  assert.match(trail, /public\._trail_props\(a\.props\) as props/);
  assert.match(trail, /public\._error_path_template\(a\.path\) as path/);
  assert.match(trail, /public\._error_path_template\(e\.path\) as path/);
  assert.match(body('admin_error_group'), /public\._error_path_template\(o\.path\) as path/);
});

test('every function 0582 creates is in its grants proof', () => {
  assert.doesNotMatch(src, /drop\s+(function|policy|trigger|table)/i, 'a DROP discards the ACL');
  const proof = src.slice(src.indexOf('do $proof$'));
  const created = [...src.matchAll(/create or replace function (public\.\w+)\(/g)].map((m) => m[1]);
  assert.equal(created.length, 14);
  for (const fn of created) {
    assert.ok(proof.includes(`'${fn}(`), `${fn} is checked with has_function_privilege`);
  }
  for (const fn of created) {
    const esc = fn.replace('.', '\\.');
    if (fn.startsWith('public._')) {
      assert.match(src, new RegExp(`revoke all on function ${esc}\\([^)]*\\) from public, anon, authenticated;`),
        `${fn} is the owner's alone`);
    } else {
      assert.match(src, new RegExp(`revoke execute on function ${esc}\\([^)]*\\) from public, anon;`), `${fn}: not anon`);
      assert.match(src, new RegExp(`grant execute on function ${esc}\\([^)]*\\) to authenticated, service_role;`),
        `${fn}: admins call it through PostgREST`);
    }
  }
  assert.match(proof, /exception when insufficient_privilege then/, 'the proof asks without an admin');
});
