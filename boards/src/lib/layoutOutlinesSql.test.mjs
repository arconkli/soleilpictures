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
// 0882 adds the first-week link (a short-lived pair table) and who-came-back totals.
const FILE2 = '0882_layout_who_left.sql';
const sql2 = readFileSync(join(MIGRATIONS_DIR, FILE2), 'utf8');

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

// Every `alter table … <table> … add column` after 0878, as {file, name, type}.
function addedColumns(table) {
  const out = [];
  for (const f of migrationFiles()) {
    if (f <= FILE) continue;
    const text = strip(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
    const alters = text.matchAll(new RegExp(
      `alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?(?:public\\.)?${table}\\b([^;]*);`, 'gi'));
    for (const a of alters) {
      for (const c of a[1].matchAll(/\badd\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_0-9]+)\s+([^,]+)/gi)) {
        out.push({ file: f, name: c[1].toLowerCase(), type: c[2].trim().replace(/\s+/g, ' ').toLowerCase() });
      }
    }
  }
  return out;
}

// The `when … then '…'` pairs of the event/action -> tool CASE, alias prefixes
// and whitespace gone, as a set.
function toolPairs(body) {
  const pairs = new Set();
  for (const m of body.matchAll(/\bwhen\s+((?:[a-z]+\.)?(?:event|act)\s*(?:=|<>|in)\s*(?:\([^)]*\)|'[^']*'))\s+then\s+('[^']*'|null)/gi)) {
    pairs.add(`${m[1]} => ${m[2]}`.replace(/\b[a-z]+\./gi, '').replace(/\s+/g, ''));
  }
  return pairs;
}

const OUTLINE_META = new Set(['pos', 'unplaced', 'groupId', 'sectionHeader', 'cells', 'rot']);
const FORBIDDEN_META = ['src', 'url', 'fileName', 'sizeBytes', 'alt', 'text', 'name', 'color',
  'label', 'groupName', 'boardId', 'target', 'sub'];

test("cluster_outlines has 0878's six columns plus 0882's first_week and came_back, and no id but its own", () => {
  const cols = columnsOf('cluster_outlines');
  assert.deepEqual([...cols].sort(), ['cards', 'frame', 'outline_id', 'sections', 'stats', 'week']);
  assert.deepEqual(cols.filter((c) => c.endsWith('_id')), ['outline_id']);
  assert.ok(!cols.some((c) => /(_at|_on|time|date)$/.test(c)), 'no timestamp finer than the week');
  const added = addedColumns('cluster_outlines');
  assert.deepEqual(added.filter((a) => a.file === FILE2).map((a) => [a.name, a.type]), [
    ['first_week', 'boolean not null default false'],
    ['came_back', 'boolean'],
  ]);
  const all = [...cols, ...added.map((a) => a.name)];
  assert.deepEqual([...all].sort(),
    ['came_back', 'cards', 'first_week', 'frame', 'outline_id', 'sections', 'stats', 'week']);
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

test("later migrations add no column to either table, except 0882's first_week and came_back", () => {
  for (const f of migrationFiles()) {
    if (f <= FILE) continue;
    const text = strip(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
    assert.doesNotMatch(text, /alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?layout_stats_weekly\b[^;]*\badd\b/i,
      `${f} adds a column to layout_stats_weekly`);
  }
  const added = addedColumns('cluster_outlines');
  for (const a of added) assert.equal(a.file, FILE2, `${a.file} adds ${a.name} to cluster_outlines`);
  assert.deepEqual(added.map((a) => `${a.name} ${a.type}`).sort(),
    ['came_back boolean', 'first_week boolean not null default false']);
  assert.ok(!added.some((a) => /uuid/.test(a.type)), 'a uuid column was added to cluster_outlines');
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
  assert.match(body, /insert\s+into\s+public\.cluster_outlines\s*\(\s*outline_id,\s*week,\s*frame,\s*cards,\s*sections,\s*stats,\s*first_week\s*\)/i);
  assert.match(body, /order\s+by\s+random\(\)\s*returning\s+outline_id\b/i,
    'outlines must go in in random order, then return their ids');
  assert.match(body, /insert\s+into\s+public\.layout_outline_pending\s*\(\s*outline_id,\s*user_id\s*\)[\s\S]*?\bwhere\s+f\.first_week\b/i,
    'the pending pair is written only for first-week outlines');
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

// ── 0882: the first-week link and who came back ─────────────────────────────

const ROLES = 'public, anon, authenticated';
const fnSig = (fn) => `public\\.${fn}\\([^)]*\\)`;

test("first_week needs the maker's own yes under terms >= 2", () => {
  const body = def('_layout_outlines_compute');
  assert.match(body, /join\s+public\.profiles\s+pc\s+on\s+pc\.user_id\s*=\s*b\.created_by\b/i);
  assert.match(body, /join\s+auth\.users\s+u\s+on\s+u\.id\s*=\s*b\.created_by\b/i);
  const m = body.match(/\)\s+as\s+first_week\b/i);
  assert.ok(m, 'no first_week expression');
  const expr = body.slice(Math.max(0, m.index - 400), m.index);
  assert.match(expr, /pc\.settings->'layout_outlines'->>?'terms'\)?(::numeric)?\s*>=\s*2\b/);
  assert.match(expr, /u\.created_at\s*>=\s*v_from\s+and\s+u\.created_at\s*<\s*v_to/);
});

test('layout_outline_pending is three columns, cascades, and no client role can touch it', () => {
  assert.deepEqual(columnsOf('layout_outline_pending'), ['outline_id', 'user_id', 'created_at']);
  const t = strip(sql2).match(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.layout_outline_pending\s*\(([\s\S]*?)\n\);/i)[1];
  assert.match(t, /outline_id\s+uuid\s+primary\s+key\s+references\s+public\.cluster_outlines\s*\(outline_id\)\s+on\s+delete\s+cascade/i);
  assert.match(t, /user_id\s+uuid\s+not\s+null\s+references\s+auth\.users\s*\(id\)\s+on\s+delete\s+cascade/i);
  assert.match(t, /created_at\s+timestamptz\b/i);
  assert.match(sql2, /alter\s+table\s+public\.layout_outline_pending\s+enable\s+row\s+level\s+security;/i);
  assert.match(sql2, new RegExp(`revoke\\s+all\\s+on\\s+table\\s+public\\.layout_outline_pending\\s+from\\s+${ROLES};`, 'i'));
});

test('layout_return_weekly has no person, workspace, cluster or outline column, and needs 20 people', () => {
  const cols = columnsOf('layout_return_weekly');
  assert.deepEqual([...cols].sort(), ['bucket', 'grp', 'joined_from', 'measure', 'people_n', 'value', 'week']);
  for (const c of cols) assert.ok(!/(^id$|_id$|user|outline|board|workspace)/.test(c), `${c} could point at someone`);
  assert.match(sql2, /people_n\s+integer\s+not\s+null\s+check\s*\(\s*people_n\s*>=\s*20\s*\)/i);
  assert.match(sql2, /alter\s+table\s+public\.layout_return_weekly\s+enable\s+row\s+level\s+security;/i);
  assert.match(sql2, new RegExp(`revoke\\s+all\\s+on\\s+table\\s+public\\.layout_return_weekly\\s+from\\s+${ROLES};`, 'i'));
  const body = def('_layout_return_compute');
  assert.match(body, /insert\s+into\s+public\.layout_return_weekly[\s\S]*?from\s+tiles\s+t\s+where\s+t\.people_n\s*>=\s*20[\s\S]*?from\s+tools\s+o\s+where\s+o\.people_n\s*>=\s*20/i);
});

test('the label step ends by deleting every pair of its week or before, labelled or not', () => {
  const body = def('_layout_outlines_label');
  // `if exists (…) then … end if;` guards only the update; the delete follows it, unconditionally.
  assert.match(body, /\bend\s+if;\s*delete\s+from\s+public\.layout_outline_pending\s+lp\s+using\s+public\.cluster_outlines\s+o\s+where\s+o\.outline_id\s*=\s*lp\.outline_id\s+and\s+o\.week\s*<=\s*p_week\s*;\s*return\s+v_n\s*;\s*end\s*\$\$/i);
  const guard = body.match(/\bif\s+exists[\s\S]*?\bend\s+if;/i);
  assert.ok(guard && !/delete\s+from/i.test(guard[0]), 'the delete sits inside the if');
});

test("set_layout_outlines takes terms 1 or 2, and a no deletes the caller's linked outlines", () => {
  assert.match(sql2, /drop\s+function\s+if\s+exists\s+public\.set_layout_outlines\(boolean\);/i);
  assert.match(sql2, /create\s+or\s+replace\s+function\s+public\.set_layout_outlines\(\s*p_ok\s+boolean,\s*p_terms\s+integer\s+default\s+1\s*\)/i);
  const body = def('set_layout_outlines');
  assert.match(body, /p_terms\s+is\s+null\s+or\s+p_terms\s+not\s+between\s+1\s+and\s+2/i);
  assert.match(body, /\bif\s+not\s+p_ok\s+then\s+delete\s+from\s+public\.cluster_outlines\s+o\s+using\s+public\.layout_outline_pending\s+lp\s+where\s+lp\.outline_id\s*=\s*o\.outline_id\s+and\s+lp\.user_id\s*=\s*v_uid\s*;\s*end\s+if;/i);
  assert.match(body, /'terms',\s*p_terms/);
});

test('0882 grants: internal functions closed to client roles, RPCs closed to anon, the proof names them all', () => {
  const text = strip(sql2);
  const made = [...text.matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z_]+)\s*\(/gi)].map((m) => m[1]);
  assert.deepEqual([...made].sort(), ['_layout_outlines_compute', '_layout_outlines_label', '_layout_return_compute',
    '_layout_weekly_run', 'admin_cluster_outlines', 'admin_layout_return', 'admin_layout_weeks',
    'purge_layout_outline_pending', 'set_layout_outlines']);
  for (const fn of made.filter((f) => f.startsWith('_') || f === 'purge_layout_outline_pending')) {
    assert.match(text, new RegExp(`revoke\\s+execute\\s+on\\s+function\\s+${fnSig(fn)}\\s+from\\s+${ROLES};`, 'i'),
      `${fn} must be revoked from client roles`);
    assert.doesNotMatch(text, new RegExp(`grant\\s+execute\\s+on\\s+function\\s+${fnSig(fn)}\\s+to\\s+[^;]*\\b(anon|authenticated)\\b`, 'i'),
      `${fn} is granted to a client role`);
  }
  for (const fn of ['set_layout_outlines', 'admin_layout_weeks', 'admin_layout_return', 'admin_cluster_outlines']) {
    assert.match(text, new RegExp(`revoke\\s+execute\\s+on\\s+function\\s+${fnSig(fn)}\\s+from\\s+public,\\s*anon;`, 'i'),
      `${fn} must be revoked from public and anon`);
    assert.match(text, new RegExp(`grant\\s+execute\\s+on\\s+function\\s+${fnSig(fn)}\\s+to\\s+authenticated,\\s*service_role;`, 'i'),
      `${fn} must be granted to authenticated and service_role`);
    assert.doesNotMatch(text, new RegExp(`grant\\s+execute\\s+on\\s+function\\s+${fnSig(fn)}\\s+to\\s+[^;]*\\banon\\b`, 'i'));
  }
  const proof = sql2.slice(sql2.indexOf('do $proof$'));
  assert.ok(proof.length > 10, 'no proof block');
  for (const fn of made) assert.ok(proof.includes(`public.${fn}(`), `${fn} is not in the proof block`);
  for (const t of ['cluster_outlines', 'layout_outline_pending', 'layout_return_weekly']) {
    assert.ok(proof.includes(`public.${t}`), `${t} is not in the proof block`);
  }
});

test('the pending purge runs hourly at :13 for 7 days, and the weekly run keeps its Monday slot', () => {
  assert.match(sql2, /cron\.schedule\(\s*'purge-layout-outline-pending'\s*,\s*'13 \* \* \* \*'\s*,\s*\$\$select public\.purge_layout_outline_pending\(7\)\$\$\s*\)/);
  const last = latestMatch(/cron\.schedule\(\s*'layout-weekly'\s*,\s*'([^']*)'/);
  assert.ok(last, 'layout-weekly is not scheduled');
  assert.equal(last.match[1], '20 4 * * 1');
  assert.match(def('purge_layout_outline_pending'),
    /delete\s+from\s+public\.layout_outline_pending\s+where\s+created_at\s*<\s*now\(\)\s*-\s*make_interval/i);
});

test("the weekly run labels last week's people before it adds this week's, and each new step fails alone", () => {
  const body = def('_layout_weekly_run');
  const label = body.search(/_layout_outlines_label\(\s*v_week\s*-\s*7\s*\)/);
  const compute = body.search(/_layout_outlines_compute\(\s*v_week\s*\)/);
  assert.ok(label >= 0 && compute >= 0 && label < compute, 'labels must run before the new outlines');
  for (const call of ['_layout_outlines_label', '_layout_return_compute']) {
    assert.match(body, new RegExp(`\\bbegin\\s+perform\\s+public\\.${call}\\(\\s*v_week\\s*-\\s*7\\s*\\);\\s*exception\\s+when\\s+others\\s+then`, 'i'),
      `${call} is not in its own begin … exception block`);
  }
});

test('who came back covers four weeks of new people', () => {
  const body = def('_layout_return_compute');
  assert.match(body, /v_from\s*:=\s*\(\s*p_week\s*-\s*21\s*\)::timestamp\s+at\s+time\s+zone\s+'utc'/i);
  assert.match(body, /v_to\s*:=\s*\(\s*p_week\s*\+\s*7\s*\)::timestamp\s+at\s+time\s+zone\s+'utc'/i);
  assert.match(body, /v_from\s*:=\s*greatest\(\s*v_from\s*,\s*v_start\s*\)/i);
  assert.match(body, /_admin_engaged_visits\(\s*p_week\s*-\s*22\s*,/i);
  assert.match(body, /insert\s+into\s+public\.layout_return_weekly\s*\(\s*week\s*,\s*joined_from\s*,/i);
  assert.match(def('admin_layout_return'), /'joined_from'/);
});

test('who-came-back names the canvas tools exactly as the weekly totals do', () => {
  const a = toolPairs(def('_layout_return_compute'));
  const b = toolPairs(def('_layout_stats_compute'));
  assert.ok(a.size >= 15, `only ${a.size} tool pairs found in _layout_return_compute`);
  assert.deepEqual([...a].sort(), [...b].sort());
});

test('0882 admin reads start with the admin gate', () => {
  for (const fn of ['admin_layout_return', 'admin_cluster_outlines', 'admin_layout_weeks']) {
    assert.match(def(fn), /\bbegin\s+perform\s+public\._require_admin\(\);/i, `${fn} must gate on admin first`);
  }
});
