// mcpDraftsMigration.test.mjs — 0706 against 0705, and 0708 against 0706 and
// 0335, read as text.
//
//   node --test src/lib/mcpDraftsMigration.test.mjs
//
// 0706 restates two of 0705's functions to change one line in each: a draft's
// clusters sit beside its root (create_boards with no parent is a top-level
// cluster), not under it, so "not the root" replaced "has a parent". Each
// restated body must be 0705's with only that line swapped, so a "while I was
// in there" edit fails here. Their behaviour is proven on Postgres before
// they're applied; this holds the files to what was proven.
//
// 0708 restates two more, each with one statement added: the keep view
// stamps a draft's first open, and the acquisition channel files a keep
// page's signup as 'mcp_draft'.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, definitionsOf, latestDefinition } from './migrationText.mjs';
import { redactKeepLink } from './linkTokens.js';

const FILE_0705 = '0705_mcp_drafts.sql';
const FILE_0706 = '0706_mcp_draft_clusters_beside_the_root.sql';
const FILE_0708 = '0708_mcp_drafts_measured.sql';
const FILE_0335 = '0335_ai_attribution_and_pipeline_alerts.sql';
const src = readFileSync(join(MIGRATIONS_DIR, FILE_0706), 'utf8');
const src0708 = readFileSync(join(MIGRATIONS_DIR, FILE_0708), 'utf8');
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const NOT_ROOT = 'b.id is distinct from public._mcp_draft_root(d.workspace_id)';
const SWAPS = {
  mcp_draft_keep_view: [
    '   where b.workspace_id = d.workspace_id and b.parent_board_id is not null and b.deleted_at is null;',
    `   where b.workspace_id = d.workspace_id and ${NOT_ROOT} and b.deleted_at is null;`,
  ],
  keep_mcp_draft: [
    '  select b.name into v_name from public.boards b where b.id = v_board and b.parent_board_id is not null;',
    `  select b.name into v_name from public.boards b where b.id = v_board and ${NOT_ROOT};`,
  ],
};

const definedIn = (fn, file) => definitionsOf(fn).find((d) => d.file === file)?.body ?? null;

for (const [fn, [from, to]] of Object.entries(SWAPS)) {
  test(`${fn} is 0705's with one line swapped`, () => {
    const before = definedIn(fn, FILE_0705);
    const after = definedIn(fn, FILE_0706);
    assert.ok(before && after, `${fn} is defined in both files`);
    assert.equal(before.split(from).length, 2, `0705's ${fn} has the line exactly once`);
    assert.equal(after, before.replace(from, to));
  });
}

const madeIn = (text) => [...text.matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.([a-z0-9_]+)\s*\(/gi)]
  .map((m) => m[1]).sort();
const RESTATED_LATER = { mcp_draft_keep_view: FILE_0708 };

test('0706 makes these four functions, and they are the ones that run (or a later restatement)', () => {
  const made = madeIn(src);
  assert.deepEqual(made, ['_mcp_draft_main_board', '_mcp_draft_root', 'keep_mcp_draft', 'mcp_draft_keep_view']);
  for (const fn of made) assert.equal(latestDefinition(fn).file, RESTATED_LATER[fn] || FILE_0706, fn);
});

// 0708: one statement added to each restated body, where it was proven.
const ADDS = {
  mcp_draft_keep_view: [FILE_0706,
    "    return json_build_object('state', 'expired', 'host', d.host);\n  end if;\n",
    '  -- The first time a browser opened the page on it while it was live (0708).\n' +
    '  update public.mcp_drafts m set first_viewed_at = now() where m.id = d.id and m.first_viewed_at is null;\n'],
  derive_acquisition_channel: [FILE_0335,
    "  if lp like '/oauth/authorize%' then return 'mcp_connect'; end if;\n",
    '  -- A keep page (0708): signed up to keep what an assistant made for them.\n' +
    "  if lp like '/keep/%' then return 'mcp_draft'; end if;\n"],
};
for (const [fn, [file, after, added]] of Object.entries(ADDS)) {
  test(`0708's ${fn} is ${file.slice(0, 4)}'s with one statement added`, () => {
    const before = definedIn(fn, file);
    const now = definedIn(fn, FILE_0708);
    assert.ok(before && now, `${fn} is defined in both files`);
    assert.equal(before.split(after).length, 2, `${file.slice(0, 4)}'s ${fn} has the anchor exactly once`);
    assert.equal(now, before.replace(after, after + added));
  });
}

test('0708 makes these three functions, and they are the ones that run', () => {
  const made = madeIn(src0708);
  assert.deepEqual(made, ['admin_mcp_drafts', 'derive_acquisition_channel', 'mcp_draft_keep_view']);
  for (const fn of made) assert.equal(latestDefinition(fn).file, FILE_0708, fn);
  assert.match(src0708, /alter table public\.mcp_drafts add column if not exists first_viewed_at timestamptz;/);
});

test("0708's funnel is for admins, and its proof checks the gates", () => {
  assert.ok(src0708.includes('revoke execute on function public.admin_mcp_drafts(integer, boolean) from public, anon;'));
  assert.ok(src0708.includes('revoke execute on function public.mcp_draft_keep_view(text, uuid) from public, anon, authenticated;'));
  const body = definedIn('admin_mcp_drafts', FILE_0708);
  assert.match(body, /perform public\._require_admin\(\);/);
  assert.match(body, /public\._internal_user_ids\(\)/);
  assert.doesNotMatch(body, /key_hash|keep_hash|subject_hash|email/, 'never a hash or an address');
  const proof = src0708.slice(src0708.lastIndexOf('do $proof$'));
  for (const sig of ['public.admin_mcp_drafts(integer, boolean)', 'public.mcp_draft_keep_view(text, uuid)']) {
    assert.ok(proof.includes(`'${sig}'`), `the proof checks ${sig}`);
  }
});

test("a keep page's first touch is the path the channel's arm matches, and the admin names it", () => {
  // analytics.js getFirstSource records the page's path through redactKeepLink.
  assert.match(read('./analytics.js'), /source\.landing_path = redactKeepLink\(window\.location\.pathname\)/);
  const landed = redactKeepLink('/keep/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d');
  assert.ok(landed.toLowerCase().startsWith('/keep/') && !/[0-9a-f]{8}-/.test(landed), landed);
  assert.match(read('../pages/admin/AdminUserDetailParts.jsx'), /\bmcp_draft: +\{ variant: 'referral', +display: 'AI draft kept'/);
});

test('its helpers are closed to clients, and its proof names every function it makes', () => {
  for (const fn of ['_mcp_draft_root', '_mcp_draft_main_board']) {
    assert.ok(src.includes(`revoke execute on function public.${fn}(uuid) from public, anon, authenticated;`), fn);
  }
  const proof = src.slice(src.lastIndexOf('do $$'));
  for (const sig of ['public._mcp_draft_root(uuid)', 'public._mcp_draft_main_board(uuid)',
                     'public.mcp_draft_keep_view(text, uuid)', 'public.keep_mcp_draft(text)']) {
    assert.ok(proof.includes(`'${sig}'`), `the proof checks ${sig}`);
  }
});

test('a draft\'s root is picked as a workspace\'s root is healed (0275): its oldest live top-level cluster', () => {
  assert.match(definedIn('_mcp_draft_root', FILE_0706),
    /parent_board_id is null and r\.deleted_at is null\s+order by r\.created_at, r\.id\s+limit 1;/);
  assert.match(latestDefinition('_ensure_workspace_root').body,
    /parent_board_id is null and deleted_at is null\s+order by created_at asc\s+limit 1;/);
});
