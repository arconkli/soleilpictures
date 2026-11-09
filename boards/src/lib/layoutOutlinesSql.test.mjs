// Layout outlines (migration 0878) promise two things in the privacy policy:
// an outline holds nothing that is in the cards, and nothing in it leads back
// to a person, a workspace or a cluster. This test holds the SQL to both, read
// from the LATEST definitions in supabase/migrations, so a later migration
// that widens what the weekly run reads or stores goes red here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, migrationFiles, latestDefinition, latestMatch } from './migrationText.mjs';

const FILE = '0878_layout_outlines.sql';
const sql = readFileSync(join(MIGRATIONS_DIR, FILE), 'utf8');

// Comments out, so a sentence in a header can't satisfy or break a check.
const strip = (s) => s.replace(/--[^\n]*/g, '');

function def(fn) {
  const d = latestDefinition(fn);
  assert.ok(d, `no definition of ${fn}() found in the migrations`);
  return strip(d.body);
}

// The column list of the latest `create table … public.<name> ( … );`.
function columnsOf(table) {
  const found = latestMatch(new RegExp(
    `create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(?:public\\.)?${table}\\s*\\(([\\s\\S]*?)\\n\\);`, 'i'));
  assert.ok(found, `no create table for ${table}`);
  return strip(found.match[1])
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^(primary|unique|check|constraint|foreign)\b/i.test(l))
    .map((l) => l.split(/\s+/)[0].toLowerCase());
}

// Every top-level meta key the body reads: meta->'k' and meta->>'k'.
function metaKeys(body) {
  return new Set([...body.matchAll(/\bmeta\s*->>?\s*'([^']+)'/g)].map((m) => m[1]));
}

// The span of the balanced parenthesis group that opens at index `open`.
function parenSpan(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')' && --depth === 0) return [open, i];
  }
  return [open, s.length];
}

const OUTLINE_META = new Set(['pos', 'unplaced', 'groupId', 'sectionHeader', 'cells', 'rot']);
const FORBIDDEN_META = ['src', 'url', 'fileName', 'sizeBytes', 'alt', 'text', 'name', 'color',
  'label', 'groupName', 'boardId', 'target', 'sub'];

test('cluster_outlines has exactly its six columns, and no id but its own', () => {
  const cols = columnsOf('cluster_outlines');
  assert.deepEqual([...cols].sort(), ['cards', 'frame', 'outline_id', 'sections', 'stats', 'week']);
  assert.deepEqual(cols.filter((c) => c.endsWith('_id')), ['outline_id']);
  assert.ok(!cols.some((c) => /(_at|_on|time|date)$/.test(c)), 'no timestamp finer than the week');
});

test('layout_stats_weekly has no person, workspace, cluster or card column', () => {
  const cols = columnsOf('layout_stats_weekly');
  assert.deepEqual([...cols].sort(), ['bucket', 'clusters_n', 'measure', 'people_n', 'value', 'week']);
  for (const c of cols) {
    assert.ok(!c.endsWith('_id'), `${c} is an id column`);
    assert.ok(!/(user|board|workspace|card|creator|owner)/.test(c) || c === 'clusters_n',
      `${c} could point at someone`);
  }
});

test('later migrations add no column to either table', () => {
  for (const f of migrationFiles()) {
    if (f <= FILE) continue;
    const text = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
    assert.doesNotMatch(text, /alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?(cluster_outlines|layout_stats_weekly)\s+add/i,
      `${f} adds a column to a layout outlines table`);
  }
});

for (const fn of ['_layout_outlines_compute', '_layout_stats_compute']) {
  test(`${fn} never reads a card's title, body or content meta`, () => {
    const body = def(fn);
    assert.doesNotMatch(body, /\b[a-z_]+\.(title|body)\b/i, 'reads card_index title or body');
    assert.doesNotMatch(body, /\bci\.\*|\bselect\s+\*/i, 'selects a whole card_index row');
    assert.doesNotMatch(body, /\bmeta\b(?!\s*->)/, 'passes meta around whole instead of reading a key');
    const keys = metaKeys(body);
    for (const k of keys) assert.ok(OUTLINE_META.has(k), `${fn} reads meta.${k}`);
    for (const k of FORBIDDEN_META) {
      assert.doesNotMatch(body, new RegExp(`'${k}'`), `${fn} names meta.${k}`);
    }
  });
}

test('the outline reads cells only for their count', () => {
  const body = def('_layout_outlines_compute');
  const idx = [...body.matchAll(/'cells'/g)].map((m) => m.index);
  assert.ok(idx.length > 0, 'the grid box count is gone');
  const spans = [...body.matchAll(/jsonb_array_length\s*\(/g)]
    .map((m) => parenSpan(body, m.index + m[0].length - 1));
  for (const i of idx) {
    assert.ok(spans.some(([a, b]) => i > a && i < b), `'cells' read outside jsonb_array_length at ${i}`);
  }
});

test('every jsonb-to-number cast in the outline is behind a type check', () => {
  const body = def('_layout_outlines_compute');
  for (const m of body.matchAll(/\(ci\.meta(->'[a-zA-Z]+')*->>'([a-zA-Z]+)'\)::numeric/g)) {
    const before = body.slice(Math.max(0, m.index - 140), m.index);
    assert.match(before, /jsonb_typeof\([^)]*\)\s*=\s*'number'\s+then\s*(greatest\(\s*)?$/,
      `unguarded cast: ${m[0]}`);
  }
});

test('the stored outline holds only its documented keys', () => {
  const body = def('_layout_outlines_compute');
  const built = [...body.matchAll(/jsonb_build_object\s*\(/g)]
    .map((m) => body.slice(...parenSpan(body, m.index + m[0].length - 1)))
    .flatMap((args) => [...args.matchAll(/'([a-z_]+)'\s*,/gi)].map((x) => x[1]));
  const allowed = new Set(['w', 'h', 'k', 'x', 'y', 'z', 'r', 's', 'hd', 'g', 'i', 'n',
    'cards', 'kinds', 'depth', 'children', 'age', 'rotated', 'grids']);
  for (const k of built) assert.ok(allowed.has(k), `the outline stores '${k}'`);
  assert.match(body, /insert\s+into\s+public\.cluster_outlines\s*\(\s*week,\s*frame,\s*cards,\s*sections,\s*stats\s*\)/i);
  assert.match(body, /order\s+by\s+random\(\)\s*;/i, 'outlines must go in in random order');
});

test('board ids from analytics are matched as uuids before any cast', () => {
  const body = def('_layout_stats_compute');
  const casts = [...body.matchAll(/\(e\.props->>'board_id'\)::uuid/g)];
  assert.ok(casts.length > 0);
  for (const m of casts) {
    const before = body.slice(Math.max(0, m.index - 160), m.index);
    assert.match(before, /case\s+when\s+\(e\.props->>'board_id'\)\s*~\*?\s*'\^\[0-9a-f\]\{8\}-[^']*\$'\s*then\s*$/,
      'the board_id cast is not behind the uuid regex');
  }
});

test('every stats row needs at least 20 people', () => {
  assert.match(sql, /people_n\s+integer\s+not\s+null\s+check\s*\(\s*people_n\s*>=\s*20\s*\)/i);
  const body = def('_layout_stats_compute');
  assert.match(body, /where\s+t\.people_n\s*>=\s*20/i);
  assert.match(body, /where\s+den\.n\s*>=\s*20/i);
});

test('both crons are scheduled, and the purge keeps 400 days', () => {
  assert.match(sql, /cron\.schedule\(\s*'layout-weekly'\s*,\s*'20 4 \* \* 1'\s*,\s*\$\$select public\._layout_weekly_run\(\)\$\$\s*\)/);
  assert.match(sql, /cron\.schedule\(\s*'purge-cluster-outlines'\s*,\s*'41 3 \* \* \*'\s*,\s*\$\$select public\.purge_old_cluster_outlines\(400\)\$\$\s*\)/);
});

test('every function the file creates is in its grant proof', () => {
  const made = [...strip(sql).matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z_]+)\s*\(/gi)].map((m) => m[1]);
  assert.equal(made.length, 9);
  const proof = sql.slice(sql.indexOf('do $proof$'));
  for (const fn of made) assert.ok(proof.includes(`public.${fn}(`), `${fn} is not in the proof block`);
  for (const fn of made.filter((f) => f.startsWith('admin_'))) {
    assert.match(def(fn), /^[\s\S]*?begin\s+perform public\._require_admin\(\);/i, `${fn} must gate on admin first`);
  }
  for (const fn of made.filter((f) => f.startsWith('_') || f.startsWith('purge_'))) {
    assert.match(sql, new RegExp(`revoke execute on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated;`),
      `${fn} must be revoked from client roles`);
  }
});

test('the workspace creator counts as an editor whose "no" excludes the cluster', () => {
  const body = def('_layout_outlines_compute');
  assert.match(body, /select\s+w2\.created_by\s+from\s+public\.workspaces\s+w2\s+where\s+w2\.id\s*=\s*c\.workspace_id\s+and\s+w2\.created_by\s+is\s+not\s+null\s+union/i);
});

test('a section counts in the stats only on a placed card with a non-empty group', () => {
  const body = def('_layout_stats_compute');
  const m = body.match(/bool_or\(([\s\S]*?)\),\s*false\)\s+as\s+sect/i);
  assert.ok(m, 'no sect expression');
  assert.match(m[1], /\(ci\.meta->>'groupId'\)\s*<>\s*''/);
  for (const k of ['x', 'y', 'w', 'h']) assert.match(m[1], new RegExp(`jsonb_typeof\\(ci\\.meta->'pos'->'${k}'\\)\\s*=\\s*'number'`));
  assert.match(m[1], /ci\.meta->'unplaced'\s+is\s+distinct\s+from\s+'true'::jsonb/);
});
