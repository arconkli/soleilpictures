// mcpDraftsMigration.test.mjs — 0706 against 0705, read as text.
//
//   node --test src/lib/mcpDraftsMigration.test.mjs
//
// 0706 restates two of 0705's functions to change one line in each: a draft's
// clusters sit beside its root (create_boards with no parent is a top-level
// cluster), not under it, so "not the root" replaced "has a parent". Each
// restated body must be 0705's with only that line swapped, so a "while I was
// in there" edit fails here. Their behaviour is proven on Postgres before
// they're applied; this holds the files to what was proven.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, definitionsOf, latestDefinition } from './migrationText.mjs';

const FILE_0705 = '0705_mcp_drafts.sql';
const FILE_0706 = '0706_mcp_draft_clusters_beside_the_root.sql';
const src = readFileSync(join(MIGRATIONS_DIR, FILE_0706), 'utf8');

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

test('0706 makes these four functions, and they are the ones that run', () => {
  const made = [...src.matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.([a-z0-9_]+)\s*\(/gi)]
    .map((m) => m[1]).sort();
  assert.deepEqual(made, ['_mcp_draft_main_board', '_mcp_draft_root', 'keep_mcp_draft', 'mcp_draft_keep_view']);
  for (const fn of made) assert.equal(latestDefinition(fn).file, FILE_0706, fn);
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
