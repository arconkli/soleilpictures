// adminSearchSignupsInternal.test.mjs — 0887: the admin search and AI sign-up
// counts leave our own accounts out.
//
//   node --test src/lib/adminSearchSignupsInternal.test.mjs
//
// admin_seo_page_stats and admin_ai_referrals count sign-ups from
// profiles.first_source. Each is 0335's body with one predicate added; these
// pin that, and that the predicate sits on the sign-up read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, latestDefinition, definitionsOf, bodyText } from './migrationText.mjs';

const FILE = '0887_admin_search_signups_skip_internal.sql';
const src = readFileSync(join(MIGRATIONS_DIR, FILE), 'utf8');
const code = src.replace(/--.*$/gm, '');
const strip = (s) => s.replace(/--.*$/gm, '');
const SKIP = 'and pr.user_id not in (select iu.user_id from public._internal_user_ids() iu)';

for (const fn of ['admin_seo_page_stats', 'admin_ai_referrals']) {
  test(`${fn} is 0335's body plus the internal-account exclusion`, () => {
    const [prev, now] = definitionsOf(fn).slice(-2);
    assert.equal(prev.file, '0335_ai_attribution_and_pipeline_alerts.sql');
    assert.equal(now.file, FILE);
    assert.equal(latestDefinition(fn).file, FILE);
    const a = bodyText(strip(now.body)), b = bodyText(strip(prev.body));
    assert.equal(a.split(SKIP).length, 2, 'the exclusion appears once');
    assert.equal(a.replace(' ' + SKIP, ''), b, 'and nothing else moved');
    assert.match(now.body, /if not is_admin\(\) then/);
  });
}

test('the exclusion sits on the sign-up read in each', () => {
  const stats = bodyText(strip(latestDefinition('admin_seo_page_stats').body));
  assert.ok(stats.includes(`where pr.first_source->>'landing_path' = p.path and au.created_at >= v_since ${SKIP})`),
    'admin_seo_page_stats: inside the signups subquery');
  const ai = bodyText(strip(latestDefinition('admin_ai_referrals').body));
  assert.ok(ai.includes(`= 'ai' ${SKIP} group by 1, 2`), 'admin_ai_referrals: on the profiles read');
});

test('the scorecard beside them already left internal accounts out', () => {
  assert.match(latestDefinition('admin_landing_scorecard').body,
    /pr\.user_id not in \(select iu\.user_id from public\._internal_user_ids\(\) iu\)/);
});

test('0887 writes no rows, drops nothing, and proves the grants', () => {
  assert.doesNotMatch(code, /^\s*(insert|update|delete)\s/im);
  assert.doesNotMatch(code, /drop\s+function/i);
  assert.match(code, /not has_function_privilege\('authenticated', f, 'execute'\)/);
  assert.match(code, /has_function_privilege\('anon', f, 'execute'\)/);
  for (const sig of ['public.admin_seo_page_stats(integer)', 'public.admin_ai_referrals(integer)']) {
    assert.ok(code.includes(`'${sig}'`), `${sig} is in the proof`);
  }
  assert.match(code, /has_function_privilege\('authenticated', 'public\._internal_user_ids\(\)', 'execute'\)/);
});
