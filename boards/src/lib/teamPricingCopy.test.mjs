// teamPricingCopy.test.mjs — what /pricing promises for Team comes from the
// code that enforces it.
//
//   node --test src/lib/teamPricingCopy.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { teamBenefits, teamComparison, TEAM_COLUMN } from './teamPricingCopy.js';
import { PLAN_COMPARISON, TRIAL_STORAGE_LABEL } from './billingCopy.js';
import { EDITOR_LIMIT } from './editorLimit.js';
import { TEAM_SEAT_MIN, TEAM_SEAT_MAX, TEAM_STORAGE_PER_SEAT, SEAT_PERK_STORAGE } from './teamModel.js';

test('the figures are the enforced ones: 1TB a seat, 3 to 100 seats, 50GB perk, the trial drive', () => {
  assert.equal(TEAM_STORAGE_PER_SEAT, 1e12, 'a seat brings 1 TB (0539)');
  assert.equal(SEAT_PERK_STORAGE, 50e9, 'the perk is 50 GB (0536)');
  assert.deepEqual([TEAM_SEAT_MIN, TEAM_SEAT_MAX], [3, 100]);
  const b = Object.fromEntries(teamBenefits(EDITOR_LIMIT).map((x) => [x.key, x]));
  assert.equal(b['team-storage'].title, '1TB a seat, one shared drive');
  assert.match(b['team-storage'].body, /^3 seats hold \*\*3TB\*\*, and every seat you add brings 1TB more\. /);
  assert.ok(b['team-storage'].body.endsWith(`${TRIAL_STORAGE_LABEL} during the free trial.`));
  assert.equal(b['team-seats'].title, `More than ${EDITOR_LIMIT} people who edit`);
  assert.match(b['team-seats'].body, /3 to 100 on your own/);
  assert.match(b['team-perk'].body, /unlimited cards and 50GB more/);
});

test('six benefits, each with a title and a body, and no old Team figures', () => {
  const list = teamBenefits(EDITOR_LIMIT);
  assert.equal(list.length, 6);
  for (const x of list) assert.ok(x.key && x.title && x.body, x.key);
  const all = JSON.stringify(list) + JSON.stringify(teamComparison(EDITOR_LIMIT));
  assert.doesNotMatch(all, /\$15\b|\b144\b|250 ?GB/);
});

test('the Team column answers every row of the two-plan comparison, then adds its own', () => {
  for (const r of PLAN_COMPARISON) assert.ok(TEAM_COLUMN[r.key], `no Team value for ${r.key}`);
  const rows = teamComparison(EDITOR_LIMIT);
  assert.deepEqual(rows.map((r) => r.key), [...PLAN_COMPARISON.map((r) => r.key), 'editors', 'viewers', 'admins', 'domain']);
  const editors = rows.find((r) => r.key === 'editors');
  assert.deepEqual([editors.demo, editors.creator, editors.team], [`Up to ${EDITOR_LIMIT}`, `Up to ${EDITOR_LIMIT}`, 'A seat each, 3 to 100']);
  for (const r of rows) assert.ok(r.demo && r.creator && r.team, r.key);
});
