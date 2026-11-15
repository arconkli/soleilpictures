// feedbackOutreachMigration.test.mjs — 0894, "reached out" on Admin › Feedback.
//
//   node --test src/lib/feedbackOutreachMigration.test.mjs
//
// 0894 replaces admin_list_feedback (DROP + CREATE: new columns and a new
// argument) and adds the summary behind the "waiting for a reply" pill. What
// must not move: every column 0348 returned, in its place, so a client that
// predates 0894 reads the same rows; the admin gate; the grants. What must
// agree: the filter ids the client sends and the ones the SQL accepts, the
// list's and the summary's idea of "waiting", and the client's optimistic mark
// with the SQL's idea of "same person, at or before".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, latestDefinition, definitionsOf } from './migrationText.mjs';
import {
  OUTREACH_FILTERS, samePerson, canMark, markReached, unmarkReached, reachedByName,
} from './feedbackOutreach.js';

const FILE = '0894_feedback_outreach.sql';
const src = readFileSync(join(MIGRATIONS_DIR, FILE), 'utf8');
const flat = (s) => s.replace(/\s+/g, ' ');

const returnsColumns = (def) => {
  const m = def.match(/returns\s+table\s*\(([\s\S]*?)\)\s*language/i);
  assert.ok(m, 'RETURNS TABLE found');
  return m[1].split(',').map((c) => flat(c).trim()).filter(Boolean);
};

test('the list is 0894\'s, and keeps every 0348 column in its place', () => {
  const latest = latestDefinition('admin_list_feedback');
  assert.equal(latest.file, FILE, 'the latest admin_list_feedback is 0894\'s');
  const prior = definitionsOf('admin_list_feedback').filter((d) => d.file !== FILE).at(-1);
  assert.ok(prior, 'an earlier definition exists');
  const before = returnsColumns(prior.body);
  const after = returnsColumns(latest.body);
  assert.deepEqual(after.slice(0, before.length), before, 'the old columns lead, unchanged and in order');
  assert.deepEqual(after.slice(before.length), [
    'reached_out_at timestamptz', 'reached_out_by text', 'reached_out_id uuid', 'waiting boolean',
  ]);
});

test('the old four-argument list is dropped, and the new one only adds a defaulted argument', () => {
  assert.match(src, /drop function if exists public\.admin_list_feedback\(integer, integer, text, text\);/);
  const head = flat(latestDefinition('admin_list_feedback').body).match(/admin_list_feedback\((.*?)\) returns/i)[1];
  const args = head.split(',').map((a) => a.trim());
  assert.deepEqual(args.map((a) => a.split(' ')[0]), ['p_limit', 'p_offset', 'p_kind', 'p_q', 'p_outreach'],
    'the old argument names stay, so a four-argument named call still resolves');
  assert.match(args[4], /default null$/, 'p_outreach defaults to null');
  assert.match(src, /pg_get_function_identity_arguments\(p\.oid\)\s*= 'p_limit integer, p_offset integer, p_kind text, p_q text'/,
    'the proof block checks the old overload is gone');
});

test('both reads ask for an admin before anything else', () => {
  for (const fn of ['admin_list_feedback', 'admin_feedback_outreach_summary']) {
    const b = latestDefinition(fn).body;
    const begin = b.indexOf('\nbegin\n');
    assert.ok(begin > 0, `${fn} is plpgsql`);
    assert.match(b.slice(begin, begin + 60), /perform public\._require_admin\(\);/, `${fn} asks first`);
    assert.match(b, /security definer/);
    assert.match(b, /set search_path to 'public'/);
  }
});

test('grants: anon never, authenticated yes, and the file proves it', () => {
  for (const sig of [
    'public.admin_list_feedback(integer, integer, text, text, text)',
    'public.admin_feedback_outreach_summary()',
  ]) {
    const esc = sig.replace(/[()]/g, '\\$&');
    assert.match(src, new RegExp(`revoke execute on function ${esc} from public, anon;`));
    assert.match(src, new RegExp(`grant\\s+execute on function ${esc} to authenticated, service_role;`));
    assert.ok(src.includes(`'${sig}'`), `${sig} is in the proof block`);
  }
  assert.match(src, /do \$\$[\s\S]*has_function_privilege\('anon', v_fn, 'execute'\)[\s\S]*raise exception '0894:%'/);
  assert.match(src, /notify pgrst, 'reload schema';/);
});

test('the client sends only filter ids the SQL accepts', () => {
  const b = latestDefinition('admin_list_feedback').body;
  const m = b.match(/v_outreach not in \(([^)]*)\)/);
  assert.ok(m, 'the list validates p_outreach');
  const sqlIds = m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).sort();
  const clientIds = OUTREACH_FILTERS.map((f) => f.id).filter(Boolean).sort();
  assert.deepEqual(clientIds, sqlIds);
  for (const id of sqlIds) assert.ok(b.includes(`v_outreach = '${id}'`), `the list filters on '${id}'`);
  assert.equal(OUTREACH_FILTERS[0].id, '', 'the first choice is everyone, which sends nothing');
});

test('the list and the summary mean the same thing by "reached out" and "waiting"', () => {
  const list = flat(latestDefinition('admin_list_feedback').body);
  const sum = flat(latestDefinition('admin_feedback_outreach_summary').body);
  const sameP = '(uo.user_id = f.user_id or lower(uo.email) = lower(u.email))';
  const atOrAfter = 'uo.reached_at >= f.created_at';
  const words = '(f.message is distinct from public._feedback_label(f.kind, f.choice))';
  const team = 'from public._internal_user_ids() i where i.user_id = f.user_id';
  for (const [name, body, optIn] of [
    ['list', list, 'coalesce(b.contact_ok, false)'],
    ['summary', sum, 'coalesce(f.contact_ok, false)'],
  ]) {
    for (const piece of [sameP, atOrAfter, words, team, optIn]) {
      assert.ok(body.includes(piece), `the ${name} has: ${piece}`);
    }
  }
  assert.ok(list.includes('b.email is not null and not b.is_internal and (b.has_note or coalesce(b.contact_ok, false)) and b.reached_out_at is null'),
    'waiting = left an email, not the team, wrote words or opted in, not reached out');
  assert.ok(sum.includes("'waiting_rows', count(*) filter (where asked and not reached)"));
  assert.ok(sum.includes('u.email is not null'), 'the summary counts only people who left an email');
});

test('samePerson matches 0894: user_id, or email ignoring case and spaces', () => {
  assert.ok(samePerson({ user_id: 'u1', email: 'a@x.com' }, { user_id: 'u1', email: null }));
  assert.ok(samePerson({ user_id: null, email: ' A@X.com' }, { user_id: 'u9', email: 'a@x.com' }));
  assert.ok(!samePerson({ user_id: 'u1', email: null }, { user_id: 'u2', email: null }));
  assert.ok(!samePerson({ user_id: null, email: '' }, { user_id: null, email: '' }), 'two blanks are not one person');
  assert.ok(!canMark({ email: null }) && !canMark({ email: '  ' }) && canMark({ email: 'a@x.com' }));
});

test('a mark turns that person\'s answers up to now green, and Undo puts back exactly what was there', () => {
  const rows = [
    { id: 'new', user_id: 'u1', email: 'a@x.com', created_at: '2026-11-14T10:00:00Z', waiting: true,
      reached_out_at: null, reached_out_by: null, reached_out_id: null },
    { id: 'old', user_id: 'u1', email: 'a@x.com', created_at: '2026-10-01T10:00:00Z', waiting: false,
      reached_out_at: '2026-10-02T09:00:00Z', reached_out_by: 'admin@x.com', reached_out_id: 'o-old' },
    { id: 'later', user_id: 'u1', email: 'a@x.com', created_at: '2026-11-15T12:00:00Z', waiting: true,
      reached_out_at: null, reached_out_by: null, reached_out_id: null },
    { id: 'other', user_id: 'u2', email: 'b@x.com', created_at: '2026-11-14T09:00:00Z', waiting: true,
      reached_out_at: null, reached_out_by: null, reached_out_id: null },
  ];
  const entry = { id: 'o-new', reached_at: '2026-11-15T08:00:00Z', reached_by_email: 'me@x.com' };
  const { rows: marked, before } = markReached(rows, { user_id: 'u1', email: 'a@x.com' }, entry);
  const by = Object.fromEntries(marked.map((r) => [r.id, r]));
  assert.equal(by.new.reached_out_id, 'o-new');
  assert.equal(by.new.waiting, false);
  assert.equal(by.old.reached_out_id, 'o-new', 'the latest outreach is the one a row shows');
  assert.equal(by.later.reached_out_id, null, 'an answer sent after the mark still waits');
  assert.equal(by.other, rows[3], 'someone else is untouched');
  const undone = unmarkReached(marked, 'o-new', before);
  assert.deepEqual(undone, rows);
});

test('the row names the admin by the part of their email before the @', () => {
  assert.equal(reachedByName('andrew@soleil.example'), 'andrew');
  assert.equal(reachedByName(''), '');
  assert.equal(reachedByName(null), '');
  assert.equal(reachedByName('noat'), 'noat');
});
