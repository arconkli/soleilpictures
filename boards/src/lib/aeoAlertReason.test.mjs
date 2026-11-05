// aeoAlertReason.test.mjs — 0867's "AEO probe failing" alert must say why.
//
//   node --test src/lib/aeoAlertReason.test.mjs
//
// 0867 restates check_discovery_pipelines() from 0480 and changes only the
// AEO-failing branch. These pin that nothing else moved, that each reason is
// there, and that the grants are still proven. 0868 adds the connector questions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, latestDefinition } from './migrationText.mjs';

const F867 = '0867_aeo_alert_says_why.sql';
const F868 = '0868_aeo_questions_chatgpt_claude.sql';
const src867 = readFileSync(join(MIGRATIONS_DIR, F867), 'utf8');
const src868 = readFileSync(join(MIGRATIONS_DIR, F868), 'utf8');
const def867 = src867.match(/create or replace function public\.check_discovery_pipelines\(\)[\s\S]*?end \$fn\$;/i)[0];
const def480 = readFileSync(join(MIGRATIONS_DIR, '0480_index_coverage_and_indexnow.sql'), 'utf8')
  .match(/create or replace function public\.check_discovery_pipelines\(\)[\s\S]*?end \$fn\$;/i)[0];

const norm = s => s.replace(/\s+/g, ' ').trim();
// Cut the AEO-failing branch (and the declaration/select 0867 widened) so the
// rest can be compared byte for byte.
function withoutAeoFailing(s) {
  return norm(s
    .replace(/\n\s*v_aeo_err text;/, '')
    .replace(/select (?:id, )?run_at, asked, failed into v_aeo/, 'select run_at, asked, failed into v_aeo')
    .replace(/(elsif coalesce\(v_aeo\.asked, 0\) > 0[^\n]*\n)[\s\S]*?(?=\n\s*end if;\n\s*\n\s*-- Crawlers)/, '$1'));
}

test('the latest definition of check_discovery_pipelines comes from 0867', () => {
  assert.equal(latestDefinition('check_discovery_pipelines').file, F867);
});

test('nothing outside the AEO-failing branch moved from 0480', () => {
  assert.equal(withoutAeoFailing(def867), withoutAeoFailing(def480));
  assert.ok(withoutAeoFailing(def480).includes("'AEO probe stale'"), 'the cut left the neighbouring branch');
});

test('0867 reads the first error of the failing run', () => {
  assert.match(src867, /select id, run_at, asked, failed into v_aeo/);
  assert.match(norm(src867), /select error into v_aeo_err from public\.aeo_retrieval_results where run_id = v_aeo\.id and error is not null order by id limit 1;/);
});

test('0867 carries each reason', () => {
  for (const s of [
    'OpenAI rejected the key (revoked or wrong): replace OPENAI_API_KEY on the soleil-boards Worker in Cloudflare',
    'the OpenAI account is out of credit: add credit to the org that owns the key',
    'OpenAI rate-limited the sweep',
    'OpenAI does not know the model: check the model in boards/src/worker-aeo.js',
    'OpenAI timed out',
    "'first error: ' || left(coalesce(v_aeo_err, 'none recorded'), 200)",
    "'^openai 401'", "'^openai 429'", 'insufficient_quota', "'^openai 404'",
  ]) assert.ok(src867.includes(s), `0867 has: ${s}`);
});

test('0867 revokes and proves the grants', () => {
  assert.match(src867, /revoke execute on function public\.check_discovery_pipelines\(\) from public, anon, authenticated;/);
  assert.match(src867, /has_function_privilege\('anon',\s*'public\.check_discovery_pipelines\(\)'/);
  assert.match(src867, /has_function_privilege\('authenticated',\s*'public\.check_discovery_pipelines\(\)'/);
});

test('0868 inserts the three connector questions only where absent', () => {
  for (const q of ['how to make a mood board with ChatGPT',
                   'mood board app with an MCP server',
                   'Claude connector for organizing reference images']) {
    assert.ok(src868.includes(`('${q}', 'discovery'`), `0868 inserts "${q}"`);
  }
  assert.match(src868, /where not exists \(select 1 from public\.aeo_probe_questions q where q\.question = v\.question\)/);
  assert.match(src868, /raise exception '0868:/);
});
