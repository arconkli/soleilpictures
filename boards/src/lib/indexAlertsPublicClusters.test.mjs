// indexAlertsPublicClusters.test.mjs — 0885: the index alerts watch public
// clusters and Soft 404, and "Google dropped" says what it measured.
//
//   node --test src/lib/indexAlertsPublicClusters.test.mjs
//
// 0885 restates check_discovery_pipelines() from 0867. These pin that only the
// index-coverage filters, their two messages and the "Google dropped" message
// moved, that each change is there, and that the grants are still proven.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, latestDefinition } from './migrationText.mjs';

const F885 = '0885_index_alerts_public_clusters_soft_404.sql';
const DEF = /create or replace function public\.check_discovery_pipelines\(\)[\s\S]*?end \$fn\$;/i;
const src = readFileSync(join(MIGRATIONS_DIR, F885), 'utf8');
const def885 = src.match(DEF)[0];
const def867 = readFileSync(join(MIGRATIONS_DIR, '0867_aeo_alert_says_why.sql'), 'utf8').match(DEF)[0];

const section = (body, from, to) => {
  const a = body.indexOf(from), b = body.indexOf(to, a + 1);
  assert.ok(a > 0 && b > a, `section ${from} … ${to}`);
  return body.slice(a, b);
};
const code = (s) => s.split('\n').filter((l) => !/^\s*--/.test(l)).map((l) => l.trim()).filter(Boolean);

test('the latest definition of check_discovery_pipelines comes from 0885', () => {
  assert.equal(latestDefinition('check_discovery_pipelines').file, F885);
});

test('only the index filters, their messages and the "Google dropped" message moved from 0867', () => {
  const now = new Set(code(def885));
  const gone = code(def867).filter((l) => !now.has(l));
  assert.deepEqual(gone, [
    // "Google dropped": the old message.
    "v_page.path || ' averaged ' || round(v_page.recent_mean)::text ||",
    "' web impressions/day over the 3 days to ' || (v_gsc - 1)::text ||",
    "' against ' || round(v_page.base_mean)::text || '/day in a baseline fortnight a month back. seo-health cannot see this '",
    "'(it checks our server, not Google) — check Search Console URL Inspection for the page.') then",
    // De-index: the PASS-within-a-week test gains an "or", so it re-indents.
    'and exists (select 1 from public.seo_index_status p',
    "v_cnt || ' page(s) Google had on its index within the past week and no longer does. ' || v_list) then",
    // 14 days: the path filter's closing bracket moves, and the message.
    "or s.path ~ '^/(tools|vs|best)/')",
    "v_cnt || ' marketing page(s) still off Google after 14 daily checks; request indexing in Search Console. ' || v_list) then",
  ]);
  const was = new Set(code(def867));
  const added = code(def885).filter((l) => !was.has(l));
  assert.equal(added.length, 22, 'and nothing else was added');
  // Every alert 0867 raised is still raised, under the same literal name.
  const names = (s) => [...s.matchAll(/_discovery_alert\('([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(names(def885), names(def867));
});

test('both index checks watch public clusters', () => {
  const gone = section(def885, "'Index coverage check failing'", "'Google de-indexed a page'");
  const streak = section(def885, "'Google de-indexed a page'", "'Pages not indexed after 14 days'");
  for (const [label, s] of [['de-indexed', gone], ['14 days', streak]]) {
    assert.match(s, /or s\.path ~ '\^\/\(tools\|vs\|best\)\/'\s+or s\.path ~ '\^\/c\/'/, `${label}: /c/ sits beside the marketing paths`);
  }
  assert.doesNotMatch(def885, /marketing page\(s\) still off Google/, 'the 14-day message no longer says marketing');
  assert.match(def885, /for Soft 404, first fix what Google fetched/);
});

test('a watched page is named on the day it turns Soft 404, and only then', () => {
  const gone = section(def885, "'Index coverage check failing'", "'Google de-indexed a page'");
  // Either it was indexed within the week, or it is Soft 404 today and its
  // last inspection in the week was something else (or there was none).
  assert.match(gone, /and \(exists \(select 1 from public\.seo_index_status p[\s\S]*?p\.verdict = 'PASS'[\s\S]*?\)\s+or \(s\.coverage_state = 'Soft 404'/);
  assert.match(gone, /coalesce\(\(select q\.coverage_state from public\.seo_index_status q\s+where q\.path = s\.path and q\.error is null\s+and q\.day between v_ix_day - 7 and v_ix_day - 1\s+order by q\.day desc\s+limit 1\), ''\) <> 'Soft 404'\)\)/);
  // The Soft 404 arm is inside the path filter's scope: both are ANDed.
  assert.ok(gone.indexOf("s.coverage_state = 'Soft 404'") < gone.indexOf("s.path = '/'"));
  assert.match(def885, /no longer does, or that newly read as Soft 404\. '/);
});

test('"Google dropped" says what was measured and what the index check found', () => {
  const msg = section(def885, "'Google dropped ' || v_page.path", 'v_n := v_n + 1;');
  assert.match(msg, /from ' \|\| \(v_gsc - 3\)::text \|\| ' to ' \|\| \(v_gsc - 1\)::text/, 'the recent window by date');
  assert.match(msg, /from ' \|\| \(v_gsc - 31\)::text \|\| ' to ' \|\| \(v_gsc - 18\)::text/, 'the baseline window by date');
  assert.match(msg, /round\(100 \* \(1 - v_page\.recent_mean \/ v_page\.base_mean\)\)::text \|\| '% from '/, 'the fall as a percentage');
  assert.match(msg, /Search Console page-level web impressions/);
  assert.match(msg, /This measures how often Google shows the page, '\s+'not whether it is indexed/);
  assert.match(msg, /from public\.seo_index_status s\s+where s\.path = v_page\.path and s\.error is null\s+order by s\.day desc\s+limit 1\), 'none on record'\)/);
  // base_mean >= 20 is what makes the division safe.
  assert.match(def885, /where base_mean >= 20/);
});

test('the longest "Google dropped" message fits the 500 characters _discovery_alert keeps', () => {
  const longest = '/best/free-mood-board-apps-for-film-directors' + ' was shown ' + '1234' +
    ' times a day in Google web search from 2026-11-08 to 2026-11-10, down 100% from 12345 a day from 2026-10-11 to 2026-10-24' +
    ' (Search Console page-level web impressions). This measures how often Google shows the page, ' +
    'not whether it is indexed. Latest index inspection: Discovered - currently not indexed on 2026-11-14' +
    '. Still indexed means it lost ranking or demand; otherwise open it in URL Inspection.';
  for (const part of ["' times a day in Google web search from '",
                      "' (Search Console page-level web impressions). This measures how often Google shows the page, '",
                      "'not whether it is indexed. Latest index inspection: '",
                      "'. Still indexed means it lost ranking or demand; otherwise open it in URL Inspection.'"]) {
    assert.ok(def885.includes(part), `the message still reads: ${part}`);
  }
  assert.ok(longest.length <= 500, `${longest.length} characters`);
});

test('0885 keeps the ACL: no drop, the revoke restated, the grant proven', () => {
  assert.doesNotMatch(src, /drop\s+function/i);
  assert.match(src, /revoke execute on function public\.check_discovery_pipelines\(\) from public, anon, authenticated;/);
  assert.match(src, /has_function_privilege\('anon', 'public\.check_discovery_pipelines\(\)', 'execute'\)/);
  assert.match(src, /has_function_privilege\('authenticated', 'public\.check_discovery_pipelines\(\)', 'execute'\)/);
  assert.doesNotMatch(src, /^\s*(insert|update|delete)\s/im, 'the migration writes no rows');
});
