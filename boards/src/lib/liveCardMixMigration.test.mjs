// The Command Center's Content mix counts the Cards figure's own cards (0505).
//
// The panel used to read admin_card_stats(365, false), which counts every card
// made in the last twelve months, the ones on trashed clusters included, so its
// total was a second and larger card count beside the wall's Cards figure.
// These pin the two to one population: the join and the filter that
// admin_universe_stats().total_cards uses, read from the live definitions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { latestDefinition, bodyText, MIGRATIONS_DIR } from './migrationText.mjs';

const FILE = '0505_command_center_mix_counts_live_cards.sql';
const LIVE = 'from public.card_index ci join public.boards b on b.id = ci.board_id where b.deleted_at is null';
const code = readFileSync(`${MIGRATIONS_DIR}${FILE}`, 'utf8');
const wall = readFileSync(new URL('../pages/admin/AdminCommandCenter.jsx', import.meta.url), 'utf8');

test('admin_live_card_mix counts the cards admin_universe_stats calls total_cards', () => {
  const mix = latestDefinition('admin_live_card_mix');
  assert.equal(mix?.file, FILE);
  const body = bodyText(mix.body);
  assert.match(body, /perform public\._require_admin\(\);/, 'admin only');
  assert.ok(body.includes(`select ci.kind, count(*) as n ${LIVE} group by ci.kind`), 'cards on live clusters, by kind');
  assert.match(body, /'total', coalesce\(sum\(k\.n\), 0\)::bigint/, 'the total is the sum of the same rows');

  const stats = bodyText(latestDefinition('admin_universe_stats').body);
  assert.ok(stats.includes(`'total_cards', (select count(*) ${LIVE})`), 'total_cards is still that population');
});

test('0505 keeps it off the signed-out surface and proves it', () => {
  assert.match(code, /revoke execute on function public\.admin_live_card_mix\(\) from public, anon;/);
  assert.match(code, /if has_function_privilege\('anon', v_sig, 'execute'\) then/);
  assert.match(code, /not has_function_privilege\('authenticated', v_sig, 'execute'\)/);
});

test('the Content mix reads it, and says what it counts', () => {
  assert.match(wall, /supabase\.rpc\('admin_live_card_mix'\)/);
  assert.doesNotMatch(wall, /rpc\(\s*'admin_card_stats'/, 'no twelve-month count beside a count of what exists');
  assert.doesNotMatch(wall, /last 12 months/);
});
