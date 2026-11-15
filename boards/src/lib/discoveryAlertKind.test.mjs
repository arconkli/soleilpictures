// discoveryAlertKind.test.mjs — 0886: search and AI pipeline alerts get their
// own ops_alerts kind and stay one row until someone has marked them Seen.
//
//   node --test src/lib/discoveryAlertKind.test.mjs
//
// What this guards:
//   * the email rules still page, under the kind the alert email's subject is
//     chosen by, and are never held back by an older unseen row;
//   * a pipeline rule is filed under 'discovery' and is not raised again while
//     one with the same dedupe key is unseen;
//   * the client_errors row (Admin > Issues, the Overview markers) is untouched;
//   * admin_markers is 0372's body with the new kind left out, nothing else;
//   * Settings > Security lists alerts of any kind, so the new one shows there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIGRATIONS_DIR, latestDefinition, definitionsOf, bodyText } from './migrationText.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = '0886_discovery_alerts_own_kind_one_until_seen.sql';
const src = readFileSync(join(MIGRATIONS_DIR, FILE), 'utf8');
const code = src.replace(/--.*$/gm, '');
const norm = (s) => s.replace(/--.*$/gm, '').replace(/\s+/g, ' ').trim();

const EMAIL_RULES = ['App email volume spike', 'Sign-in email bounces spiked',
                     'Sign-in email opens collapsed', 'Sign-in email rows missing'];

test('both functions are latest in 0886', () => {
  assert.equal(latestDefinition('_discovery_alert').file, FILE);
  assert.equal(latestDefinition('admin_markers').file, FILE);
});

test('the four email rules page under email_health, on the 20-hour window alone', () => {
  const body = norm(latestDefinition('_discovery_alert').body);
  for (const name of EMAIL_RULES) assert.ok(body.includes(`'${name}'`), `${name} is a paging rule`);
  // The names are the ones check_discovery_pipelines() raises.
  const check = latestDefinition('check_discovery_pipelines').body;
  for (const name of EMAIL_RULES) assert.ok(check.includes(`_discovery_alert('${name}'`), `${name} is raised`);
  assert.match(body, /if v_page then perform public\.ops_alert_raise\('email_health', p_name, p_message, true, 'discovery:' \|\| p_name, interval '20 hours'\);/);
  const paging = body.slice(body.indexOf('if v_page then'), body.indexOf('elsif'));
  assert.doesNotMatch(paging, /acked_at/, 'a page never waits on an older alert being seen');
});

test('a pipeline rule is filed under discovery and is one row until it is seen', () => {
  const body = norm(latestDefinition('_discovery_alert').body);
  assert.match(body,
    /elsif not exists \(select 1 from public\.ops_alerts a where a\.dedupe_key = 'discovery:' \|\| p_name and a\.kind = 'discovery' and a\.acked_at is null\) then perform public\.ops_alert_raise\('discovery', p_name, p_message, false, 'discovery:' \|\| p_name, interval '20 hours'\); end if;/);
  assert.equal((body.match(/ops_alert_raise\(/g) || []).length, 2, 'one raise per branch');
});

test('the client_errors row is written exactly as before', () => {
  const [prev] = definitionsOf('_discovery_alert').slice(-2);
  assert.equal(prev.file, '0369_outbound_breaker_and_alerts.sql');
  const upToInsert = (s) => { const b = norm(s); return b.slice(b.indexOf('begin'), b.indexOf("'/discovery-pipelines');")); };
  assert.equal(upToInsert(latestDefinition('_discovery_alert').body), upToInsert(prev.body));
  assert.match(latestDefinition('_discovery_alert').body, /occurred_at <= now\(\) \+ interval '5 minutes'/);
});

test('admin_markers is 0372’s body with discovery left out of the ops markers', () => {
  const [prev, now] = definitionsOf('admin_markers').slice(-2);
  assert.equal(prev.file, '0372_admin_weekly_series_and_notes.sql');
  assert.equal(now.file, FILE);
  const strip = (s) => s.replace(/--.*$/gm, '');
  assert.equal(
    bodyText(strip(now.body)),
    bodyText(strip(prev.body)).replace("'signups', 'email_health')", "'signups', 'email_health', 'discovery')"));
  assert.notEqual(bodyText(strip(now.body)), bodyText(strip(prev.body)));
});

test('0886 writes no rows, drops nothing, and proves its grants', () => {
  assert.doesNotMatch(code, /^\s*(update|delete)\s/im);
  assert.equal((code.match(/insert into/g) || []).length, 1, 'the only insert is the client_errors row inside the function');
  assert.doesNotMatch(code, /drop\s+function/i);
  assert.match(src, /^begin;$/m);
  assert.ok(src.trimEnd().endsWith('commit;'));
  assert.match(code, /revoke execute on function public\._discovery_alert\(text, text\) from public, anon, authenticated;/);
  assert.match(code, /revoke all on function public\.admin_markers\(date\) from public, anon;/);
  assert.match(code, /grant execute on function public\.admin_markers\(date\) to authenticated, service_role;/);
  assert.match(code, /has_function_privilege\('anon', 'public\._discovery_alert\(text, text\)', 'execute'\)/);
  assert.match(code, /has_function_privilege\('authenticated', 'public\._discovery_alert\(text, text\)', 'execute'\)/);
  assert.match(code, /has_function_privilege\('anon', 'public\.admin_markers\(date\)', 'execute'\)/);
  assert.match(code, /not has_function_privilege\('authenticated', 'public\.admin_markers\(date\)', 'execute'\)/);
  assert.match(code, /pg_get_constraintdef\(c\.oid\) ilike '%kind%'/, 'and that ops_alerts.kind is still free text');
});

test('no migration puts a check constraint on ops_alerts.kind', () => {
  const made = readFileSync(join(MIGRATIONS_DIR, '0369_outbound_breaker_and_alerts.sql'), 'utf8');
  const table = made.slice(made.indexOf('create table if not exists public.ops_alerts'), made.indexOf('alter table public.ops_alerts enable row level security'));
  assert.match(table, /kind\s+text not null,/);
  assert.doesNotMatch(table, /check\s*\(/i);
});

test('Settings > Security lists alerts of every kind', () => {
  const overview = latestDefinition('admin_security_overview').body;
  const alerts = overview.slice(overview.indexOf("'alerts'"), overview.indexOf("'actions'"));
  assert.match(alerts, /from public\.ops_alerts order by created_at desc limit 50/);
  assert.doesNotMatch(alerts, /where/i, 'the list is not filtered by kind');
  const tab = readFileSync(resolve(HERE, '../components/settings/SecurityTab.jsx'), 'utf8');
  assert.doesNotMatch(tab, /\.kind\b/, 'and the tab does not filter or branch on kind');
  assert.match(tab, /ackAlert\(a\.id\)/, 'Seen is what lets a pipeline rule raise again');
});
