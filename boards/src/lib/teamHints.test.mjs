// The Team plan's hints: each one is raised somewhere in the team SQL, and
// teamRefusal reads a PostgrestError for each.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR } from './migrationText.mjs';
import { TEAM_HINT, teamRefusal } from './teamHints.js';

const FILES = [
  '0522_teams_tables.sql', '0530_teams_access.sql', '0531_teams_seats.sql',
  '0532_teams_rpcs.sql', '0533_teams_people.sql', '0534_teams_joining.sql',
  '0535_teams_read.sql', '0538_teams_billing.sql', '0540_teams_setup_and_domains.sql',
  '0541_team_invite_email.sql',
];
const fileText = (f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
const sql = FILES.map(fileText).join('\n');

test('every hint appears in the team SQL', () => {
  for (const h of Object.values(TEAM_HINT)) {
    assert.ok(sql.includes(h), `${h} is in no team migration`);
  }
});

test('each key is its own hint string', () => {
  for (const [k, v] of Object.entries(TEAM_HINT)) assert.equal(k, v);
  assert.equal(Object.keys(TEAM_HINT).length, 23);
});

test('teamRefusal maps a fake PostgrestError for each hint', () => {
  for (const h of Object.values(TEAM_HINT)) {
    const r = teamRefusal({ message: 'x', hint: h, details: null });
    assert.equal(r.kind, h);
    assert.equal(r.needed, null);
  }
});

test('team_seats_needed carries the shortfall', () => {
  assert.deepEqual(teamRefusal({ hint: 'team_seats_needed', details: '3' }), { kind: 'team_seats_needed', needed: 3 });
  assert.equal(teamRefusal({ hint: 'team_seats_needed', details: 'nope' }).needed, null);
});

test('anything else is not a team refusal', () => {
  assert.equal(teamRefusal(null), null);
  assert.equal(teamRefusal({ message: 'boom' }), null);
  assert.equal(teamRefusal({ hint: 'editor_limit' }), null);
  assert.equal(teamRefusal({ hint: 'toString' }), null);
});
