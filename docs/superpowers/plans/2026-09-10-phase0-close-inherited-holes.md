# Phase 0 — Close the inherited authorization holes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make workspace roles real, close the four privilege and data-hygiene holes the organization layer would otherwise inherit, and give owners a Members tab — without changing behaviour for anyone who is not a workspace `viewer`.

**Architecture:** Four additive Postgres migrations (0317–0320) rewrite the existing SECURITY DEFINER choke points in place (bodies re-emitted from the live definitions with one change each), close table/column grants, and add one owner RPC. Client work is a role-aware permission mirror, a role picker on workspace invites, and a Members tab in Settings. Every migration asserts its own post-conditions; repo tests read the migration text; a rolled-back SQL probe proves the row-level behaviour before and after applying to the shared project.

**Tech Stack:** Postgres 17 on Supabase (migrations in `supabase/migrations`, applied through the Supabase MCP `apply_migration`), Cloudflare Worker (`boards/src/worker-api.js`), PartyKit (`boards/party/*.ts`), React/Vite (`boards/src`), `node --test` (`boards/src/lib/*.test.mjs`), Playwright source-reading specs (`boards/tests/*-wiring.spec.js`), the docs gate (`npm run docs:build && npm run docs:accept`).

## Global Constraints

- The Supabase project is **shared between preview and production**: a migration is live for production users the moment it applies. Every migration here is backward compatible with the production client (no signature changes; new columns are additive; predicates only tighten for `workspace_members.role = 'viewer'`).
- **Applying a migration is a gated step.** Tasks 2–5 only *write* migration files and tests. Task 14 applies them, and it starts by asking the owner. Never call `mcp__supabase__apply_migration` before that.
- Since 0311 a new function is born with ACL `{postgres, authenticated, service_role}`. Every `_`-prefixed helper gets `revoke execute … from public, anon, authenticated`; RLS-helper functions (`can_*`, `my_*`, `is_*`) keep `grant execute … to anon, authenticated, service_role`; each migration ends with a `do $$ … has_function_privilege … $$` post-condition block in the 0311 style.
- Migration files are numbered `0317`–`0320`; before creating one, run `ls supabase/migrations | grep '^03(17|18|19|20)'` and pick the next free number if a concurrent session took it (22 prefixes are already duplicated; do not add a 23rd).
- Any change to `TABS` in `SettingsPanel.jsx` trips `docsite.test.mjs`. The fix is to update `boards/content/docs/account/settings.md`, then `npm run docs:build && npm run docs:accept` in the same commit. Tab ids match `/^[a-z]+$/` and entries are written `{ id, label, group }` in that order.
- House rules from CLAUDE.md: never `.catch()` a `supabase.rpc()` builder; gold (`--soleil`) only for active/selection/focus; deletion shows an undo toast (member removal is not content deletion and uses the existing confirm pattern from `ShareModal.onRemoveMember`); the repo is public, so no customer names or business numbers in commits or fixtures.
- Concurrent session hygiene: another session has uncommitted edits to `boards/tests/boards-smoke.spec.js`, `comprehensive-local.spec.js`, `draw-routing.spec.js`, `ws6-overlays.spec.js`. Before every commit run `git diff --cached --name-only` and stage only the files the task names. Never run a bare `git stash pop`.
- Commit after every task; push `origin main` after every commit (push to `main` deploys a preview, never production). Commit messages end with the attribution trailer in the system reminder.
- `npm test` runs from `boards/` and includes `../scout/src/*.test.mjs`; run it from `boards/`.

---

## File Structure

| File | Responsibility |
|---|---|
| `boards/src/lib/migrationText.mjs` (new) | Shared helper for migration-text tests: list files in apply order, find the latest definition of a function or policy |
| `boards/src/lib/migrationText.test.mjs` (new) | Tests the helper against a synthetic migrations directory |
| `supabase/migrations/0317_workspace_board_link_grants.sql` (new) | Column-scoped UPDATE grants on `workspaces` and `boards`; `public_share_links` becomes read-only to clients; formalises `workspaces.ai_tagger_enabled` |
| `supabase/migrations/0318_workspace_roles_real.sql` (new) | Role CHECK, `_actor_active`, `_workspace_member_role`, `_workspace_member_can_write`, role-aware `can_write_workspace`/`can_write_board`, `authorize_upload` without the membership OR, share cascade on removal/leave, `set_workspace_member_role`, `invite_workspace_member` viewer fix, `can_comment_board` |
| `supabase/migrations/0319_read_suspend_gate.sql` (new) | `_actor_active()` in `can_read_board`, `my_readable_board_ids`, `my_workspace_ids` |
| `supabase/migrations/0320_api_request_log_durability.sql` (new) | Nullable FKs with `set null`, `actor_label`/`ip`/`user_agent`, `api_log_request` re-created |
| `boards/src/lib/roleCheck.test.mjs` (new) | Asserts the four migrations say what this plan says, by text |
| `boards/src/lib/boardPermission.test.mjs` (new) | Unit test for `computeBoardPermission` viewer handling |
| `boards/src/hooks/useBoardPermission.js` (modify) | Workspace `viewer` members resolve to read-only |
| `boards/src/components/ShareModal.jsx` (modify) | Workspace invites can be view-only |
| `boards/src/lib/boardsApi.js` (modify) | `setWorkspaceMemberRole`, `listWorkspaceDirectory` |
| `boards/src/components/settings/MembersTab.jsx` (new) | Owner-facing member roster with role change and removal |
| `boards/src/components/SettingsPanel.jsx` (modify) | `members` tab under "This workspace" |
| `boards/content/docs/account/settings.md`, `collaborate/index.md`, `collaborate/comments.md` (modify) | Documentation the gate and the truth require |
| `CLAUDE.md` (modify) | Stale "no CI" line; grant-hygiene rule |
| `boards/party/workspace.ts` (modify) | Presence identity is checked against the JWT |
| `boards/party/upload.ts`, `boards/src/lib/uploads.js` (modify) | Multipart complete returns the server-measured size and the client records it |
| `boards/src/worker-api.js` (modify) | API log carries `cf-connecting-ip` and user agent |
| `boards/tests/share-roles-wiring.spec.js` (new) | Source-reading spec for the client wiring |
| `supabase/tests/phase0_rls_probe.sql` (new) | Rolled-back behavioural probe run before and after applying |

---

### Task 1: Shared migration-text helper

**Files:**
- Create: `boards/src/lib/migrationText.mjs`
- Test: `boards/src/lib/migrationText.test.mjs`

**Interfaces:**
- Produces: `migrationFiles(dir?) → string[]` (basenames sorted by numeric prefix, then name), `latestDefinition(fnName, dir?) → { file, body } | null` (matches `create [or replace] function [public.]name(` through the closing dollar-quote), `latestPolicy(policyName, dir?) → { file, body } | null`, `latestMatch(regex, dir?) → { file, match } | null`, `duplicatePrefixes(dir?) → string[]`.

- [ ] **Step 1: Write the failing test**

```js
// boards/src/lib/migrationText.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrationFiles, latestDefinition, latestPolicy, latestMatch, duplicatePrefixes } from './migrationText.mjs';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'mig-'));
  writeFileSync(join(dir, '0001_init.sql'),
    `create or replace function foo(x uuid) returns boolean language sql as $$ select true $$;\n` +
    `create policy "p read" on t for select using (true);\n`);
  writeFileSync(join(dir, '0002_b.sql'),
    `create function public.foo(x uuid) returns boolean language sql as $function$ select false $function$;\n`);
  writeFileSync(join(dir, '0002_a.sql'),
    `drop policy if exists "p read" on t;\ncreate policy "p read" on t for select using (false);\n`);
  writeFileSync(join(dir, '0010_c.sql'), `-- nothing\n`);
  return dir;
}

test('migrationFiles orders by numeric prefix then name', () => {
  const dir = fixture();
  assert.deepEqual(migrationFiles(dir), ['0001_init.sql', '0002_a.sql', '0002_b.sql', '0010_c.sql']);
});

test('latestDefinition returns the last file that defines the function, either syntax', () => {
  const dir = fixture();
  const def = latestDefinition('foo', dir);
  assert.equal(def.file, '0002_b.sql');
  assert.match(def.body, /select false/);
});

test('latestPolicy returns the last create policy for that name', () => {
  const dir = fixture();
  const p = latestPolicy('p read', dir);
  assert.equal(p.file, '0002_a.sql');
  assert.match(p.body, /using \(false\)/);
});

test('latestMatch and duplicatePrefixes', () => {
  const dir = fixture();
  assert.equal(latestMatch(/nothing/, dir).file, '0010_c.sql');
  assert.deepEqual(duplicatePrefixes(dir), ['0002']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd boards && node --test src/lib/migrationText.test.mjs`
Expected: FAIL with `Cannot find module './migrationText.mjs'`

- [ ] **Step 3: Write the helper**

```js
// boards/src/lib/migrationText.mjs
//
// Shared reader for migration-text tests. The house rule is that a test which
// guards a function's shape reads the LATEST definition in supabase/migrations,
// because that is what is live in Postgres. Three things every such test needs
// and inviteUpsert.test.mjs first wrote locally:
//   * apply order, not filename order — 22 prefixes are used twice, and Supabase
//     applies by full version string, so sort by numeric prefix and then name;
//   * both definition syntaxes — `create or replace function` and the
//     `drop function` + `create function` form a RETURNS TABLE change forces;
//   * both dollar-quote tags — `$$` by hand, `$function$` from pg_get_functiondef.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const MIGRATIONS_DIR = new URL('../../../supabase/migrations/', import.meta.url).pathname;

export function migrationFiles(dir = MIGRATIONS_DIR) {
  return readdirSync(dir)
    .filter(f => f.endsWith('.sql'))
    .sort((a, b) => {
      const na = Number(a.slice(0, 4)), nb = Number(b.slice(0, 4));
      return na !== nb ? na - nb : (a < b ? -1 : a > b ? 1 : 0);
    });
}

function read(dir, f) { return readFileSync(join(dir, f), 'utf8'); }

export function latestDefinition(fnName, dir = MIGRATIONS_DIR) {
  const re = new RegExp(
    `create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?${fnName}\\s*\\(` +
    `[\\s\\S]*?as\\s*(\\$[a-z_]*\\$)[\\s\\S]*?\\1\\s*;`,
    'i',
  );
  let found = null;
  for (const f of migrationFiles(dir)) {
    const m = read(dir, f).match(re);
    if (m) found = { file: f, body: m[0] };
  }
  return found;
}

export function latestPolicy(policyName, dir = MIGRATIONS_DIR) {
  const re = new RegExp(`create\\s+policy\\s+"${policyName}"[\\s\\S]*?;`, 'i');
  let found = null;
  for (const f of migrationFiles(dir)) {
    const m = read(dir, f).match(re);
    if (m) found = { file: f, body: m[0] };
  }
  return found;
}

export function latestMatch(regex, dir = MIGRATIONS_DIR) {
  let found = null;
  for (const f of migrationFiles(dir)) {
    const m = read(dir, f).match(regex);
    if (m) found = { file: f, match: m };
  }
  return found;
}

export function duplicatePrefixes(dir = MIGRATIONS_DIR) {
  const seen = new Map();
  for (const f of migrationFiles(dir)) {
    const p = f.slice(0, 4);
    seen.set(p, (seen.get(p) || 0) + 1);
  }
  return [...seen].filter(([, n]) => n > 1).map(([p]) => p).sort();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd boards && node --test src/lib/migrationText.test.mjs`
Expected: 4 passing

- [ ] **Step 5: Commit**

```bash
git add boards/src/lib/migrationText.mjs boards/src/lib/migrationText.test.mjs
git diff --cached --name-only
git commit -m "Migration-text tests get one shared reader that orders by apply order

inviteUpsert.test.mjs kept its own latestDefinition(); the Phase 0 tests need
the same thing plus the drop-and-create form a RETURNS TABLE change forces,
and filename order is wrong for the 22 duplicated prefixes."
git push origin main
```

---

### Task 2: Migration 0317 — column-scoped grants on workspaces, boards and public links

**Files:**
- Create: `supabase/migrations/0317_workspace_board_link_grants.sql`
- Create: `boards/src/lib/roleCheck.test.mjs` (first tests)

**Interfaces:**
- Consumes: `latestMatch`, `migrationFiles` from Task 1.
- Produces: nothing callable; grants only.

Facts this migration rests on (verified 2026-09-09/10 by reading): `workspaces` has exactly `id, name, created_by, created_at, settings` on disk plus a live `ai_tagger_enabled` column with no migration file; no grant or revoke statement touches `workspaces` in any migration; the only client write is `boardsApi.js:100` `.update({ name })`, settings go through `merge_workspace_settings` (SECURITY DEFINER); `transfer_workspace_ownership`, `merge_workspace_settings` and `prepare_account_deletion` are all SECURITY DEFINER so column grants do not apply to them. `boards` carries the 0247 18-column grant list. `public_share_links` has one FOR ALL owner policy (0018:29-40) and no client code reads or writes the table directly (every write goes through `create_public_link`, `revoke_public_link`, `set_public_link_indexing`, `set_public_link_subboards`, `create_collab_link`).

- [ ] **Step 1: Write the failing tests**

```js
// boards/src/lib/roleCheck.test.mjs
//
// Phase 0 of the enterprise work closes holes the organization layer would
// inherit. Each assertion here names the hole and the migration that closes
// it, and reads the LATEST migration text so a later rewrite that reopens one
// fails loudly instead of silently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, migrationFiles, latestDefinition, latestPolicy, latestMatch, duplicatePrefixes } from './migrationText.mjs';

const fileNamed = (prefix) => migrationFiles().find(f => f.startsWith(prefix));
const textOf = (prefix) => readFileSync(join(MIGRATIONS_DIR, fileNamed(prefix)), 'utf8');

test('0317: workspaces UPDATE is column-scoped and never includes created_by', () => {
  const sql = textOf('0317');
  assert.match(sql, /revoke update on public\.workspaces from anon, authenticated;/);
  const grant = /grant update \(([^)]*)\) on public\.workspaces to authenticated;/i.exec(sql);
  assert.ok(grant, '0317 must grant an explicit column list on workspaces');
  const cols = grant[1].split(',').map(s => s.trim());
  assert.deepEqual(cols.sort(), ['name', 'settings']);
});

test('0317: boards column grant drops id, workspace_id and created_by, keeps day_types', () => {
  const sql = textOf('0317');
  const grant = /grant update \(([^)]*)\) on public\.boards to authenticated, anon;/i.exec(sql);
  assert.ok(grant, '0317 must re-issue the boards column grant to authenticated, anon');
  const cols = grant[1].split(',').map(s => s.trim());
  for (const banned of ['id', 'workspace_id', 'created_by']) assert.ok(!cols.includes(banned), `boards grant must not include ${banned}`);
  assert.ok(cols.includes('day_types'), 'boards grant must keep day_types (0247)');
  assert.ok(cols.includes('parent_board_id'), 'parent_board_id stays granted; the 0118 policy governs it');
});

test('no migration after 0316 grants id/workspace_id/created_by on boards or created_by/org_id on workspaces', () => {
  for (const f of migrationFiles().filter(f => Number(f.slice(0, 4)) >= 317)) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
    for (const m of sql.matchAll(/grant update \(([^)]*)\) on public\.(boards|workspaces)/gi)) {
      const cols = m[1].split(',').map(s => s.trim());
      const banned = m[2] === 'boards' ? ['id', 'workspace_id', 'created_by'] : ['created_by', 'org_id', 'id'];
      for (const b of banned) assert.ok(!cols.includes(b), `${f} grants ${b} on ${m[2]}`);
    }
  }
});

test('0317: public_share_links is read-only to client roles', () => {
  const sql = textOf('0317');
  assert.match(sql, /revoke insert, update, delete on public\.public_share_links from anon, authenticated;/);
  assert.match(sql, /drop policy if exists "public_links manage by owner" on public\.public_share_links;/);
  const p = latestPolicy('public_links read by owner');
  assert.ok(p && p.file.startsWith('0317'), 'select-only owner policy must be in 0317');
  assert.match(p.body, /for select/i);
});

test('0317: formalises the drifted ai_tagger_enabled column without changing it', () => {
  assert.match(textOf('0317'), /alter table public\.workspaces\s+add column if not exists ai_tagger_enabled boolean;/);
});

test('no duplicate migration prefixes from 0317 on', () => {
  const dupes = duplicatePrefixes().filter(p => Number(p) >= 317);
  assert.deepEqual(dupes, [], `duplicated prefixes: ${dupes.join(', ')}`);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd boards && node --test src/lib/roleCheck.test.mjs`
Expected: FAIL — `fileNamed('0317')` is undefined (`Cannot read properties of undefined`)

- [ ] **Step 3: Write the migration**

```sql
-- 0317_workspace_board_link_grants.sql
--
-- Three grant holes the organization layer (Phase 1) would inherit on day one.
--
-- 1. workspaces.created_by is the whole owner concept (0009, 0013, 0015, 0086:
--    every owner check is `created_by <> auth.uid()`), and the 0047 UPDATE policy
--    is row-scoped on membership with role in ('editor','owner') — which is every
--    member the UI can create (ShareModal hard-codes role:'editor'). There is no
--    grant or revoke on workspaces in any migration, so Supabase's table-level
--    UPDATE grant lets such a member `patch workspaces set created_by = me` via
--    PostgREST and inherit every owner-gated RPC. Same class as 0091 (profiles)
--    and 0238/0247 (boards), which replaced the table grant with a column list.
--    The only client write is boardsApi.js:100 `.update({ name })`; settings go
--    through merge_workspace_settings (SECURITY DEFINER), as do transfer_workspace_
--    ownership and prepare_account_deletion, so column grants do not touch them.
--
-- 2. boards: 0247's 18-column list still includes id, workspace_id and created_by.
--    The boards UPDATE policy (0118) never compares OLD to NEW workspace_id, so a
--    member of two workspaces can PATCH a board across the boundary, bypassing
--    move_boards_under and the same-workspace assumption list_shared_boards
--    relies on. Nothing client-side PATCHes those three columns.
--
-- 3. public_share_links: the 0018 policy is FOR ALL for the workspace owner, so an
--    owner can insert, re-point, un-revoke or flip allow_indexing on link rows
--    through PostgREST, around anything the link RPCs enforce. Phase 2 puts
--    organization sharing policy inside those RPCs; that is only a control if the
--    table is not client-writable. No client code reads or writes the table.
--
-- Also formalises workspaces.ai_tagger_enabled, which exists on the live table
-- (read by useAiTagger.js:214) with no migration file — one of the ~53 applied
-- migrations that have none. No default is stated so the live default is kept.

-- ── 0. Drift ────────────────────────────────────────────────────────────────
alter table public.workspaces
  add column if not exists ai_tagger_enabled boolean;

-- ── 1. workspaces: table grant → column list ─────────────────────────────────
revoke update on public.workspaces from anon, authenticated;
grant update (name, settings) on public.workspaces to authenticated;

-- ── 2. boards: 0247's list minus id, workspace_id, created_by ───────────────
revoke update on public.boards from authenticated, anon;
grant update (
  parent_board_id, name, view, cover, meta,
  created_at, updated_at, bg_color, deleted_at, thumb_key, thumb_updated_at,
  card_count, thumb_version, thumb_custom, day_types
) on public.boards to authenticated, anon;

-- ── 3. public_share_links: read-only to clients ─────────────────────────────
revoke insert, update, delete on public.public_share_links from anon, authenticated;
drop policy if exists "public_links manage by owner" on public.public_share_links;
create policy "public_links read by owner" on public.public_share_links
  for select using (
    exists (
      select 1 from public.boards b join public.workspaces w on w.id = b.workspace_id
      where b.id = board_id and w.created_by = auth.uid()
    )
  );

-- ── Post-conditions (the 0311 habit: a grant change that did not take is worse
--    than one that was never attempted) ───────────────────────────────────────
do $$
begin
  if has_column_privilege('authenticated', 'public.workspaces', 'created_by', 'update') then
    raise exception 'authenticated can still update workspaces.created_by';
  end if;
  if not has_column_privilege('authenticated', 'public.workspaces', 'name', 'update') then
    raise exception 'authenticated lost UPDATE on workspaces.name — renames would break';
  end if;
  if not has_column_privilege('authenticated', 'public.workspaces', 'settings', 'update') then
    raise exception 'authenticated lost UPDATE on workspaces.settings';
  end if;
  if has_column_privilege('authenticated', 'public.boards', 'workspace_id', 'update')
     or has_column_privilege('authenticated', 'public.boards', 'created_by', 'update')
     or has_column_privilege('authenticated', 'public.boards', 'id', 'update') then
    raise exception 'authenticated can still update boards.id/workspace_id/created_by';
  end if;
  if not has_column_privilege('authenticated', 'public.boards', 'day_types', 'update') then
    raise exception 'authenticated lost UPDATE on boards.day_types (0247 granted it)';
  end if;
  if has_table_privilege('authenticated', 'public.public_share_links', 'update')
     or has_table_privilege('authenticated', 'public.public_share_links', 'insert')
     or has_table_privilege('authenticated', 'public.public_share_links', 'delete') then
    raise exception 'authenticated can still write public_share_links';
  end if;
end $$;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd boards && node --test src/lib/roleCheck.test.mjs`
Expected: 6 passing

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0317_workspace_board_link_grants.sql boards/src/lib/roleCheck.test.mjs
git diff --cached --name-only
git commit -m "Any editor could take a workspace by writing created_by through PostgREST

workspaces never got the column-scoped grant that profiles (0091) and boards
(0238) did, so the 0047 row policy was the only thing between a member and
ownership. 0317 replaces the table grant with (name, settings), drops id,
workspace_id and created_by from the boards list, and makes public_share_links
read-only to clients so link policy enforced in RPCs cannot be routed around.
Not applied yet."
git push origin main
```

---

### Task 3: Migration 0318 — workspace roles become real

**Files:**
- Create: `supabase/migrations/0318_workspace_roles_real.sql`
- Modify: `boards/src/lib/roleCheck.test.mjs` (append tests)

**Interfaces:**
- Produces (SQL): `public._actor_active() returns boolean`; `public._workspace_member_role(ws uuid) returns text`; `public._workspace_member_can_write(ws uuid) returns boolean`; `public.set_workspace_member_role(p_workspace_id uuid, p_user_id uuid, p_role text) returns void` (owner-only; `p_role in ('editor','viewer')`); `public.can_comment_board(p_board_id uuid) returns boolean`. Re-emits `can_write_workspace`, `can_write_board`, `authorize_upload`, `remove_workspace_member`, `leave_workspace`, `invite_workspace_member`.

Facts: `workspace_members.role` is `text not null default 'editor'` with no CHECK (0001:16-22); live values are `owner`, `editor`, `viewer`, `service` (0222:139-141 writes `'service'`). `is_workspace_member` (0001:69-78) is role-blind and stays so for reads. `can_write_workspace`/`can_write_board` are 0188:108-127 / 0188:68-102. `authorize_upload` (0221:261-295) ORs `is_workspace_member` back in at :277. `remove_workspace_member` (0013:269-293) and `leave_workspace` (0009:75-97) delete only the membership row. `invite_workspace_member` (0086:177-232) stores `'workspace'` on the pending path regardless of `p_role`; both claim paths map `role = 'viewer'` → viewer and anything else → editor (0228:79-81, 0189:565-568). The comments insert policy (0031:50-55) gates on `can_read_board`.

- [ ] **Step 1: Append the failing tests**

```js
// append to boards/src/lib/roleCheck.test.mjs

test('0318: workspace_members.role is constrained and the CHECK includes service', () => {
  const sql = textOf('0318');
  const m = /check \(role in \(([^)]*)\)\)/i.exec(sql);
  assert.ok(m, '0318 must add a role CHECK');
  const vals = m[1].split(',').map(s => s.trim().replace(/'/g, ''));
  assert.deepEqual(vals.sort(), ['admin', 'editor', 'owner', 'service', 'viewer']);
  assert.match(sql, /where role not in \(/i, '0318 must pre-assert live values before adding the CHECK');
});

test('0318: the allowed writer set is stated once and both write predicates use it', () => {
  const canWrite = latestDefinition('_workspace_member_can_write');
  assert.ok(canWrite && canWrite.file.startsWith('0318'));
  assert.match(canWrite.body, /in \('owner',\s*'admin',\s*'editor',\s*'service'\)/);
  for (const fn of ['can_write_workspace', 'can_write_board']) {
    const def = latestDefinition(fn);
    assert.ok(def.file >= '0318', `${fn} latest definition must be 0318 or later, got ${def.file}`);
    assert.match(def.body, /_workspace_member_can_write\(/, `${fn} must route membership writes through _workspace_member_can_write`);
    assert.doesNotMatch(def.body, /\bis_workspace_member\(/, `${fn} must not use the role-blind is_workspace_member`);
    assert.match(def.body, /_actor_active\(\)/, `${fn} must carry the suspend gate`);
  }
});

test('0318: authorize_upload no longer ORs is_workspace_member back in', () => {
  const def = latestDefinition('authorize_upload');
  assert.ok(def.file >= '0318');
  assert.doesNotMatch(def.body, /or public\.is_workspace_member\(/);
  assert.match(def.body, /if not public\.can_write_workspace\(p_workspace_id\) then/);
});

test('0318: removing or leaving a workspace also removes that user\'s board shares there', () => {
  for (const fn of ['remove_workspace_member', 'leave_workspace']) {
    const def = latestDefinition(fn);
    assert.ok(def.file >= '0318', `${fn} must be re-emitted in 0318`);
    assert.match(def.body, /delete from board_shares[\s\S]*board_id in \(\s*select id from boards where workspace_id = p_workspace_id\s*\)/i,
      `${fn} must cascade to board_shares in that workspace`);
  }
});

test('0318: set_workspace_member_role exists, is owner-gated and only allows editor|viewer', () => {
  const def = latestDefinition('set_workspace_member_role');
  assert.ok(def && def.file.startsWith('0318'));
  assert.match(def.body, /p_role not in \('editor',\s*'viewer'\)/);
  assert.match(def.body, /created_by/);
  assert.match(textOf('0318'), /grant execute on function public\.set_workspace_member_role\(uuid, uuid, text\) to authenticated;/);
});

test('0318: invite_workspace_member keeps a viewer invite a viewer', () => {
  const def = latestDefinition('invite_workspace_member');
  assert.ok(def.file >= '0318');
  assert.match(def.body, /case when p_role = 'viewer' then 'viewer' else 'workspace' end/);
});

test('0318: comments insert goes through can_comment_board, which is at least can_read_board', () => {
  const p = latestPolicy('comments insert');
  assert.ok(p.file >= '0318');
  assert.match(p.body, /can_comment_board\(board_id\)/);
  const def = latestDefinition('can_comment_board');
  assert.match(def.body, /can_read_board\(p_board_id\)/);
});

test('0318: every _-prefixed helper is revoked from anon and authenticated', () => {
  const sql = textOf('0318');
  for (const fn of ['_actor_active()', '_workspace_member_role(uuid)', '_workspace_member_can_write(uuid)']) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${fn.replace(/[()]/g, m => '\\' + m)} from public, anon, authenticated;`));
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd boards && node --test src/lib/roleCheck.test.mjs`
Expected: the new tests FAIL (`fileNamed('0318')` undefined; latestDefinition file is `0188…`/`0221…`/`0013…`)

- [ ] **Step 3: Write the migration**

```sql
-- 0318_workspace_roles_real.sql
--
-- workspace_members.role has been decorative since 0001: it is unconstrained
-- text, defaults to 'editor', and is read by exactly two policies (0047, 0048).
-- Every authorization predicate reaches membership through the role-blind
-- is_workspace_member(), so a workspace "viewer" has full write access to every
-- board in the workspace, there is no RPC to change a member's role, the
-- ShareModal can only ever invite 'editor' (ShareModal.jsx:449-452), and
-- invite_workspace_member's pending path stores 'workspace' whatever role was
-- asked for (0086:208-213) — so an invited viewer becomes an editor on claim.
--
-- The organization layer (Phase 1) needs real workspace roles under it. This
-- migration makes them real with the smallest possible change to each body:
--
--   * a CHECK on the column, pre-asserted against live values, which are
--     owner / editor / viewer / service (0222 writes 'service' for service
--     accounts) — 'admin' is reserved for Phase 1;
--   * ONE statement of who may write through membership,
--     _workspace_member_can_write(ws) := role in (owner, admin, editor, service),
--     used by BOTH write predicates. 'service' MUST be in that set or every
--     service account loses /api/v1 writes;
--   * can_write_workspace / can_write_board re-emitted from 0188 with
--     is_workspace_member → _workspace_member_can_write, plus _actor_active()
--     (banned users lose writes at the RLS layer, not at token expiry);
--   * authorize_upload re-emitted from 0221 WITHOUT `or is_workspace_member`,
--     which otherwise lets a viewer open multipart uploads after the change;
--   * remove_workspace_member / leave_workspace cascade to board_shares in that
--     workspace, so "removing someone removes them" becomes a true sentence;
--   * set_workspace_member_role, owner-only, editor|viewer;
--   * invite_workspace_member stores 'viewer' when asked for viewer (both claim
--     paths already map 'viewer' → viewer and anything else → editor);
--   * comments insert goes through can_comment_board(), defined as
--     can_read_board() — share viewers can comment today (0031:50-55) and
--     narrowing that would be a live regression; the docs are corrected instead.
--
-- Reads are untouched here (0319). is_workspace_member stays role-blind.
--
-- Behaviour change for real accounts: any existing workspace_members row with
-- role = 'viewer' loses board_state / card_index writes, and an open PartyKit
-- socket flips to readOnly within the 10-second auth cache. The pre-flight
-- below counts them so the owners can be told before this applies.

-- ── 0. Pre-flight: live values and the viewer count ─────────────────────────
do $$
declare v_bad int; v_viewers int;
begin
  select count(*) into v_bad from public.workspace_members
   where role not in ('owner','admin','editor','viewer','service');
  if v_bad > 0 then
    raise exception 'workspace_members holds % rows with a role outside owner/admin/editor/viewer/service — inspect before adding the CHECK', v_bad;
  end if;
  select count(*) into v_viewers from public.workspace_members where role = 'viewer';
  raise notice '0318: % workspace member rows currently hold role=viewer and will become read-only', v_viewers;
end $$;

alter table public.workspace_members
  drop constraint if exists workspace_members_role_check;
alter table public.workspace_members
  add constraint workspace_members_role_check
  check (role in ('owner','admin','editor','viewer','service'));

-- ── 1. The suspend gate and the one writer set ──────────────────────────────
-- anon (auth.uid() null) has no profile row and is "active": the read
-- predicates decide anon on membership, which anon never has.
create or replace function public._actor_active()
returns boolean
language sql stable security definer
set search_path = public as $$
  select coalesce(
    (select p.banned_at is null from public.profiles p where p.user_id = auth.uid()),
    true
  );
$$;
revoke all on function public._actor_active() from public, anon, authenticated;

create or replace function public._workspace_member_role(ws uuid)
returns text
language sql stable security definer
set search_path = public as $$
  select wm.role from public.workspace_members wm
  where wm.workspace_id = ws and wm.user_id = auth.uid()
  limit 1;
$$;
revoke all on function public._workspace_member_role(uuid) from public, anon, authenticated;

create or replace function public._workspace_member_can_write(ws uuid)
returns boolean
language sql stable security definer
set search_path = public as $$
  select coalesce(public._workspace_member_role(ws) in ('owner', 'admin', 'editor', 'service'), false);
$$;
revoke all on function public._workspace_member_can_write(uuid) from public, anon, authenticated;

-- ── 2. can_write_workspace — 0188:108-127 with two edits ─────────────────────
create or replace function public.can_write_workspace(ws uuid)
returns boolean
language sql stable security definer
set search_path = public as $$
  with t as (
    select coalesce(
      (select tier from public.profiles where user_id = auth.uid()),
      'demo'
    ) as tier
  )
  select case
    when (select tier from t) = 'waitlist' then false
    when not public._actor_active() then false
    else public._workspace_member_can_write(ws)
      or exists (
        select 1 from public.workspaces w
        where w.id = ws and w.created_by = auth.uid()
      )
  end;
$$;

-- ── 3. can_write_board — 0188:68-102 with the same two edits ────────────────
create or replace function public.can_write_board(p_board_id uuid)
returns boolean
language sql stable security definer
set search_path = public as $$
  with recursive t as (
    select coalesce(
      (select tier from public.profiles where user_id = auth.uid()),
      'demo'
    ) as tier
  ),
  chain as (
    select id, workspace_id, parent_board_id
    from public.boards where id = p_board_id
    union all
    select b.id, b.workspace_id, b.parent_board_id
    from public.boards b
    join chain c on b.id = c.parent_board_id
  )
  select case
    when (select tier from t) = 'waitlist' then false
    when not public._actor_active() then false
    else exists (
      select 1 from chain
      where public._workspace_member_can_write(chain.workspace_id)
         or exists (
           select 1 from public.workspaces w
           where w.id = chain.workspace_id and w.created_by = auth.uid()
         )
         or exists (
           select 1 from public.board_shares s
           where s.board_id = chain.id
             and s.user_id  = auth.uid()
             and s.role     = 'editor'
         )
    )
  end;
$$;

-- ── 4. authorize_upload — 0221:261-295 minus the membership OR ──────────────
create or replace function public.authorize_upload(p_workspace_id uuid, p_bytes bigint)
returns table(allow boolean, used bigint, quota bigint, remaining bigint, reason text)
language plpgsql stable security definer
set search_path = public as $$
declare
  v_owner uuid;
  v_owner_tier text;
  v_quota bigint;
  v_used bigint;
  v_bytes bigint := greatest(0, coalesce(p_bytes, 0));
begin
  select created_by into v_owner from public.workspaces where id = p_workspace_id;
  if v_owner is null then
    return query select false, 0::bigint, 0::bigint, 0::bigint, 'no_workspace'::text; return;
  end if;

  if not public.can_write_workspace(p_workspace_id) then
    return query select false, 0::bigint, 0::bigint, 0::bigint, 'not_writer'::text; return;
  end if;

  v_quota := public._storage_quota_bytes(v_owner);

  select coalesce(tier, 'demo') into v_owner_tier from public.profiles where user_id = v_owner;
  if coalesce(v_owner_tier, 'demo') not in ('paid', 'admin') then
    return query select false, 0::bigint, v_quota, 0::bigint, 'owner_not_paid'::text; return;
  end if;

  v_used := public._storage_used_bytes(v_owner);

  return query select (v_used + v_bytes <= v_quota), v_used, v_quota,
                      greatest(0, v_quota - v_used),
                      (case when (v_used + v_bytes <= v_quota) then 'ok' else 'over_quota' end)::text;
end $$;

-- ── 5. Removal cascades to board shares in that workspace ───────────────────
create or replace function public.remove_workspace_member(
  p_workspace_id uuid, p_user_id uuid
) returns void
language plpgsql security definer
set search_path = public as $$
declare
  v_owner uuid;
begin
  select created_by into v_owner from workspaces
  where id = p_workspace_id;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'only the workspace owner can remove members'
      using errcode = '42501';
  end if;
  if p_user_id = v_owner then
    raise exception 'cannot remove the workspace owner'
      using errcode = '42501';
  end if;

  delete from workspace_members
  where workspace_id = p_workspace_id and user_id = p_user_id;

  -- 0318: a per-board share in this workspace survived removal before, so a
  -- removed person kept access to whatever had been shared to them directly.
  delete from board_shares
  where user_id = p_user_id
    and board_id in (select id from boards where workspace_id = p_workspace_id);
end;
$$;

create or replace function public.leave_workspace(p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select created_by into v_owner from workspaces where id = p_workspace_id;

  if v_owner = auth.uid() then
    raise exception 'workspace owner cannot leave — delete the workspace instead'
      using errcode = '42501';
  end if;

  delete from workspace_members
  where workspace_id = p_workspace_id and user_id = auth.uid();

  -- 0318: same cascade as remove_workspace_member.
  delete from board_shares
  where user_id = auth.uid()
    and board_id in (select id from boards where workspace_id = p_workspace_id);
end;
$$;

-- ── 6. Owner changes a member's role ────────────────────────────────────────
create or replace function public.set_workspace_member_role(
  p_workspace_id uuid, p_user_id uuid, p_role text
) returns void
language plpgsql security definer
set search_path = public as $$
declare
  v_owner uuid;
begin
  if p_role not in ('editor', 'viewer') then
    raise exception 'role must be editor or viewer' using errcode = '22023';
  end if;
  select created_by into v_owner from workspaces where id = p_workspace_id;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'only the workspace owner can change roles' using errcode = '42501';
  end if;
  if p_user_id = v_owner then
    raise exception 'the owner''s role is ownership; transfer it instead' using errcode = '42501';
  end if;
  update workspace_members
     set role = p_role
   where workspace_id = p_workspace_id
     and user_id = p_user_id
     and role in ('editor', 'viewer');
  if not found then
    raise exception 'not a member with a changeable role' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.set_workspace_member_role(uuid, uuid, text) from public, anon;
grant execute on function public.set_workspace_member_role(uuid, uuid, text) to authenticated;

-- ── 7. invite_workspace_member — 0086:177-232, pending role honours viewer ──
create or replace function public.invite_workspace_member(
  p_workspace_id uuid, p_email text, p_role text default 'editor'
) returns text
language plpgsql security definer
set search_path = public as $$
declare
  v_owner       uuid;
  v_user        uuid;
  v_my_tier     text;
  v_email_norm  text := lower(trim(p_email));
begin
  if p_role not in ('editor','viewer') then
    raise exception 'workspace member role must be editor or viewer'
      using errcode = '22023';
  end if;

  select coalesce((select tier from public.profiles where user_id = auth.uid()), 'demo')
    into v_my_tier;
  if v_my_tier = 'waitlist' then
    raise exception 'your account isn''t active yet' using errcode = '42501';
  end if;

  select created_by into v_owner from workspaces where id = p_workspace_id;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'only the workspace owner can add members'
      using errcode = '42501';
  end if;

  select id into v_user from auth.users where email = v_email_norm;

  if v_user is null then
    -- 0318: 'workspace' is what both claim paths turn into an editor membership;
    -- a viewer invite must stay 'viewer' or the claim promotes it.
    insert into pending_invites (email, workspace_id, board_id, role, invited_by)
    values (v_email_norm, p_workspace_id, null,
            case when p_role = 'viewer' then 'viewer' else 'workspace' end,
            auth.uid())
    on conflict (lower(email), workspace_id) where claimed_at is null and board_id is null
    do update set role       = case when p_role = 'viewer' then 'viewer' else 'workspace' end,
                  invited_by = auth.uid(),
                  expires_at = now() + interval '30 days';
    return 'pending';
  end if;

  if v_user = auth.uid() then
    raise exception 'cannot invite yourself' using errcode = '22023';
  end if;

  begin
    insert into workspace_members (workspace_id, user_id, role)
    values (p_workspace_id, v_user, p_role);
  exception when unique_violation then
    return 'already_member';
  end;

  return 'granted';
end;
$$;

-- ── 8. Commenting is a read-level right today; say so in one function ───────
create or replace function public.can_comment_board(p_board_id uuid)
returns boolean
language sql stable security definer
set search_path = public as $$
  select public.can_read_board(p_board_id);
$$;
revoke all on function public.can_comment_board(uuid) from public;
grant execute on function public.can_comment_board(uuid) to anon, authenticated, service_role;

drop policy if exists "comments insert" on public.comments;
create policy "comments insert"
  on public.comments for insert
  with check (
    author = auth.uid()
    and public.can_comment_board(board_id)
  );

-- ── Post-conditions ─────────────────────────────────────────────────────────
do $$
begin
  if has_function_privilege('anon', 'public._actor_active()', 'execute')
     or has_function_privilege('authenticated', 'public._actor_active()', 'execute')
     or has_function_privilege('anon', 'public._workspace_member_role(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public._workspace_member_role(uuid)', 'execute')
     or has_function_privilege('anon', 'public._workspace_member_can_write(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public._workspace_member_can_write(uuid)', 'execute') then
    raise exception 'an internal helper is client-callable';
  end if;
  -- RLS helpers must stay anon-callable (0311 rationale: a policy evaluated for
  -- an anon SELECT must be able to call them).
  if not has_function_privilege('anon', 'public.can_write_board(uuid)', 'execute')
     or not has_function_privilege('anon', 'public.can_write_workspace(uuid)', 'execute')
     or not has_function_privilege('anon', 'public.can_comment_board(uuid)', 'execute') then
    raise exception 'an RLS helper lost its anon EXECUTE';
  end if;
  if has_function_privilege('anon', 'public.set_workspace_member_role(uuid, uuid, text)', 'execute') then
    raise exception 'set_workspace_member_role is anon-callable';
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'workspace_members_role_check'
  ) then
    raise exception 'role CHECK missing';
  end if;
end $$;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd boards && node --test src/lib/roleCheck.test.mjs src/lib/inviteUpsert.test.mjs`
Expected: all passing (`inviteUpsert.test.mjs` still finds the workspace-scoped arbiter in the re-emitted `invite_workspace_member`)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0318_workspace_roles_real.sql boards/src/lib/roleCheck.test.mjs
git diff --cached --name-only
git commit -m "A workspace viewer could write every board, and an invited viewer became an editor

workspace_members.role was free text that no write predicate read. 0318 adds
the CHECK (including the live 'service' value), states the writer set once in
_workspace_member_can_write, routes can_write_workspace and can_write_board
through it, drops the is_workspace_member OR from authorize_upload, cascades
removal and leave to board_shares, adds set_workspace_member_role, keeps a
viewer invite a viewer, and names commenting a read-level right. Not applied yet."
git push origin main
```

---

### Task 4: Migration 0319 — the suspend gate on reads

**Files:**
- Create: `supabase/migrations/0319_read_suspend_gate.sql`
- Modify: `boards/src/lib/roleCheck.test.mjs` (append tests)

**Interfaces:**
- Consumes: `public._actor_active()` from 0318.
- Re-emits: `can_read_board` (0013:46-64), `my_readable_board_ids` (0272:52-73), `my_workspace_ids` (0272:80-90). Signatures unchanged.

Why all three: the `boards` SELECT policy has used `my_readable_board_ids()` since 0294 and `card_index`/`board_state` since 0295, and PartyKit admits a socket on that policy (`party/auth.ts:135-142`). Gating only `can_read_board` would leave a banned user reading through the policies and connecting to rooms. The three bodies below are 0013/0272 verbatim with one wrapping condition each.

- [ ] **Step 1: Append the failing tests**

```js
// append to boards/src/lib/roleCheck.test.mjs

test('0319: every read predicate carries the suspend gate', () => {
  for (const fn of ['can_read_board', 'my_readable_board_ids', 'my_workspace_ids']) {
    const def = latestDefinition(fn);
    assert.ok(def.file >= '0319', `${fn} must be re-emitted in 0319 or later, got ${def.file}`);
    assert.match(def.body, /_actor_active\(\)/, `${fn} lacks _actor_active()`);
  }
});

test('0319: the read predicates keep their anon grants (RLS evaluates them for anon SELECTs)', () => {
  const sql = textOf('0319');
  assert.match(sql, /grant execute on function public\.can_read_board\(uuid\) to anon, authenticated, service_role;/);
  assert.match(sql, /grant execute on function public\.my_readable_board_ids\(\) to anon, authenticated, service_role;/);
  assert.match(sql, /grant execute on function public\.my_workspace_ids\(\) to anon, authenticated, service_role;/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd boards && node --test src/lib/roleCheck.test.mjs`
Expected: the two new tests FAIL (`can_read_board` latest is `0013…`)

- [ ] **Step 3: Write the migration**

```sql
-- 0319_read_suspend_gate.sql
--
-- The only account-level kill switch (a Supabase ban, surfaced as
-- profiles.banned_at and TierRouter's Suspended screen) stopped WRITES in
-- can_write_board / can_write_workspace and left READS untouched: can_read_board
-- (0013) never had a tier or ban clause, and the InitPlan helpers the boards /
-- card_index / board_state policies use since 0294/0295 test membership and
-- shares only. So a suspended person kept read access to every board they
-- were a member of until their token expired, and PartyKit — which admits a
-- socket on the boards SELECT policy — kept admitting them.
--
-- 0318 added _actor_active() to the write side. This adds it to all three read
-- bodies, verbatim otherwise, so the read and write paths stay symmetric (the
-- 0294 equivalence between can_read_board and my_readable_board_ids holds only
-- if both carry the same gate). For anon, auth.uid() is null, _actor_active()
-- is true, and the membership tests still return nothing — unchanged.

-- ── can_read_board — 0013:46-64 ─────────────────────────────────────────────
create or replace function public.can_read_board(p_board_id uuid)
returns boolean language sql stable security definer
set search_path = public as $$
  with recursive chain as (
    select id, workspace_id, parent_board_id
    from boards where id = p_board_id
    union all
    select b.id, b.workspace_id, b.parent_board_id
    from boards b join chain c on b.id = c.parent_board_id
  )
  select public._actor_active() and exists (
    select 1 from chain
    where is_workspace_member(chain.workspace_id)
       or exists (
         select 1 from board_shares s
         where s.board_id = chain.id and s.user_id = auth.uid()
       )
  );
$$;
revoke all on function public.can_read_board(uuid) from public;
grant execute on function public.can_read_board(uuid) to anon, authenticated, service_role;

-- ── my_readable_board_ids — 0272:52-73 ──────────────────────────────────────
create or replace function public.my_readable_board_ids()
returns uuid[]
language sql
stable
security definer
set search_path to 'public'
as $$
  with recursive roots as (
    select b.id, b.parent_board_id
    from boards b
    where b.workspace_id in (
            select wm.workspace_id from workspace_members wm where wm.user_id = auth.uid()
          )
       or exists (
            select 1 from board_shares s where s.board_id = b.id and s.user_id = auth.uid()
          )
    union
    select c.id, c.parent_board_id
    from boards c join roots r on c.parent_board_id = r.id
  )
  select case when public._actor_active()
              then coalesce(array_agg(id), '{}'::uuid[])
              else '{}'::uuid[] end
  from roots;
$$;
revoke all on function public.my_readable_board_ids() from public;
grant execute on function public.my_readable_board_ids() to anon, authenticated, service_role;

-- ── my_workspace_ids — 0272:80-90 ───────────────────────────────────────────
create or replace function public.my_workspace_ids()
returns uuid[]
language sql
stable
security definer
set search_path to 'public'
as $$
  select case when public._actor_active()
              then coalesce(array_agg(wm.workspace_id), '{}'::uuid[])
              else '{}'::uuid[] end
  from workspace_members wm
  where wm.user_id = auth.uid();
$$;
revoke all on function public.my_workspace_ids() from public;
grant execute on function public.my_workspace_ids() to anon, authenticated, service_role;

-- ── Post-conditions ─────────────────────────────────────────────────────────
do $$
begin
  if not has_function_privilege('anon', 'public.can_read_board(uuid)', 'execute')
     or not has_function_privilege('anon', 'public.my_readable_board_ids()', 'execute')
     or not has_function_privilege('anon', 'public.my_workspace_ids()', 'execute') then
    raise exception 'a read predicate lost its anon EXECUTE; anon SELECTs would error instead of returning zero rows';
  end if;
end $$;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd boards && node --test src/lib/roleCheck.test.mjs src/lib/securityInvokerContract.test.mjs`
Expected: all passing

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0319_read_suspend_gate.sql boards/src/lib/roleCheck.test.mjs
git diff --cached --name-only
git commit -m "A suspended account kept reading every board until its token expired

can_read_board and the two InitPlan helpers behind the boards, card_index and
board_state policies had no ban clause, and PartyKit admits on those policies.
0319 adds _actor_active() to all three, verbatim otherwise, so reads and writes
carry the same gate. Not applied yet."
git push origin main
```

---

### Task 5: Migration 0320 — the API audit log survives its actors, and records where from

**Files:**
- Create: `supabase/migrations/0320_api_request_log_durability.sql`
- Modify: `boards/src/worker-api.js:862-873`
- Modify: `boards/src/lib/roleCheck.test.mjs` (append tests)

**Interfaces:**
- Produces (SQL): `public.api_log_request(p_token_id uuid, p_user_id uuid, p_method text, p_route text, p_status integer, p_ms integer, p_target uuid, p_tool text default null, p_ip inet default null, p_ua text default null) returns void` — the old 8-argument function is dropped in the same migration (PostgREST resolves overloads by argument name, so two overloads would be ambiguous for the Worker's call).
- Consumes: `api_request_log` (0220:219-233; `token_id`/`user_id` are `not null … on delete cascade`), `api_log_request` (0223:59-78), the Worker call at `worker-api.js:863-872`.

- [ ] **Step 1: Append the failing tests**

```js
// append to boards/src/lib/roleCheck.test.mjs

test('0320: api_request_log rows outlive their token and user', () => {
  const sql = textOf('0320');
  assert.match(sql, /alter column token_id drop not null/i);
  assert.match(sql, /alter column user_id drop not null/i);
  assert.match(sql, /references public\.api_tokens\(id\) on delete set null not valid/i);
  assert.match(sql, /references auth\.users\(id\)\s+on delete set null not valid/i);
  assert.match(sql, /validate constraint api_request_log_token_id_fkey/i);
  assert.match(sql, /validate constraint api_request_log_user_id_fkey/i);
  assert.match(sql, /add column if not exists actor_label text/);
  assert.match(sql, /add column if not exists ip inet/);
  assert.match(sql, /add column if not exists user_agent text/);
});

test('0320: api_log_request is a single 10-argument function, service-role only', () => {
  const sql = textOf('0320');
  assert.match(sql, /drop function if exists public\.api_log_request\(uuid, uuid, text, text, integer, integer, uuid, text\);/);
  const def = latestDefinition('api_log_request');
  assert.ok(def.file.startsWith('0320'));
  assert.match(def.body, /p_ip\s+inet default null/);
  assert.match(def.body, /p_ua\s+text default null/);
  assert.match(def.body, /actor_label/);
  assert.match(sql, /revoke all on function public\.api_log_request\(uuid, uuid, text, text, integer, integer, uuid, text, inet, text\)\s+from public, anon, authenticated;/);
});

test('worker passes the client IP and user agent to api_log_request', () => {
  const src = readFileSync(new URL('../worker-api.js', import.meta.url), 'utf8');
  const call = src.slice(src.indexOf("scoutRpc(env, 'api_log_request'"), src.indexOf("scoutRpc(env, 'api_log_request'") + 600);
  assert.match(call, /p_ip: request\.headers\.get\('cf-connecting-ip'\) \|\| null/);
  assert.match(call, /p_ua: \(request\.headers\.get\('user-agent'\) \|\| ''\)\.slice\(0, 200\) \|\| null/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd boards && node --test src/lib/roleCheck.test.mjs`
Expected: the three new tests FAIL

- [ ] **Step 3: Write the migration**

```sql
-- 0320_api_request_log_durability.sql
--
-- api_request_log is the customer-facing audit log behind GET /api/v1/audit.
-- Its two foreign keys were NOT NULL ... ON DELETE CASCADE (0220:221-222), so
-- revoking a token or deleting a user erased that actor's entire history — an
-- audit trail the person being audited could partly delete. It also recorded
-- no IP and no user agent, which is the first thing a security review asks
-- for after "who".
--
-- Shape after this migration: both FKs nullable with ON DELETE SET NULL, an
-- actor_label snapshot taken at write time (service account name, display
-- name, or email) so a row still reads sensibly after its actor is gone, and
-- ip / user_agent columns filled by the Worker from cf-connecting-ip.
--
-- Locking: the table is written on every API write on the shared production
-- project. DROP CONSTRAINT is metadata-only; the expensive step is ADD, which
-- is deferred with NOT VALID and then VALIDATE (a SHARE UPDATE EXCLUSIVE lock
-- that does not block writes). Run this in the 03:xx window regardless.
--
-- api_log_request gains p_ip and p_ua. The 8-argument version is DROPPED, not
-- overloaded: PostgREST resolves overloads by argument name, and the Worker
-- posts named arguments, so two candidates would be an ambiguity error at call
-- time (the 0247 lesson). The Worker sends the new arguments from the same
-- deploy; until it is promoted, production's Worker calls with 8 names and
-- the defaults fill the rest.

-- ── Columns ─────────────────────────────────────────────────────────────────
alter table public.api_request_log add column if not exists actor_label text;
alter table public.api_request_log add column if not exists ip inet;
alter table public.api_request_log add column if not exists user_agent text;

-- ── FKs: nullable, set null on delete ───────────────────────────────────────
alter table public.api_request_log alter column token_id drop not null;
alter table public.api_request_log alter column user_id drop not null;

alter table public.api_request_log drop constraint if exists api_request_log_token_id_fkey;
alter table public.api_request_log drop constraint if exists api_request_log_user_id_fkey;

alter table public.api_request_log
  add constraint api_request_log_token_id_fkey
  foreign key (token_id) references public.api_tokens(id) on delete set null not valid;
alter table public.api_request_log
  add constraint api_request_log_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null not valid;

alter table public.api_request_log validate constraint api_request_log_token_id_fkey;
alter table public.api_request_log validate constraint api_request_log_user_id_fkey;

-- ── Backfill the label for rows that still have an actor ────────────────────
update public.api_request_log l
   set actor_label = coalesce(s.name, p.display_name, u.email::text)
  from auth.users u
  left join public.service_accounts s on s.user_id = u.id
  left join public.profiles p on p.user_id = u.id
 where l.user_id = u.id
   and l.actor_label is null;

-- ── The writer: snapshot the label, record where from ───────────────────────
drop function if exists public.api_log_request(uuid, uuid, text, text, integer, integer, uuid, text);

create function public.api_log_request(
  p_token_id uuid,
  p_user_id  uuid,
  p_method   text,
  p_route    text,
  p_status   integer,
  p_ms       integer,
  p_target   uuid,
  p_tool     text default null,
  p_ip       inet default null,
  p_ua       text default null
) returns void
language sql
security definer
set search_path = public, auth as $$
  insert into public.api_request_log
    (token_id, user_id, method, route, target_id, status, ms, tool, actor_label, ip, user_agent)
  values (
    p_token_id, p_user_id, left(p_method, 10), left(p_route, 120), p_target, p_status, p_ms,
    nullif(left(p_tool, 80), ''),
    (select coalesce(s.name, p.display_name, u.email::text)
       from auth.users u
       left join public.service_accounts s on s.user_id = u.id
       left join public.profiles p on p.user_id = u.id
      where u.id = p_user_id),
    p_ip,
    nullif(left(p_ua, 200), '')
  );
$$;
revoke all on function public.api_log_request(uuid, uuid, text, text, integer, integer, uuid, text, inet, text)
  from public, anon, authenticated;

-- ── Post-conditions ─────────────────────────────────────────────────────────
do $$
declare v_n int;
begin
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'api_log_request';
  if v_n <> 1 then
    raise exception 'expected exactly one api_log_request overload, found %', v_n;
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'api_request_log'
                and column_name in ('token_id', 'user_id') and is_nullable = 'NO') then
    raise exception 'api_request_log.token_id/user_id are still NOT NULL';
  end if;
  if has_function_privilege('authenticated', 'public.api_log_request(uuid, uuid, text, text, integer, integer, uuid, text, inet, text)', 'execute') then
    raise exception 'api_log_request is client-callable';
  end if;
end $$;
```

- [ ] **Step 4: Change the Worker call**

In `boards/src/worker-api.js`, the call at lines 863-872 becomes:

```js
    const write = scoutRpc(env, 'api_log_request', {
      p_token_id: auth.tokenId,
      p_user_id: auth.userId,
      p_method: request.method,
      p_route: trace.route,
      p_status: res.status,
      p_ms: Date.now() - t0,
      p_target: trace.target,
      p_tool: trace.tool || null,
      // 0320: where from. cf-connecting-ip is set by Cloudflare on every
      // request and cannot be forged by the client; the UA is bounded here so
      // the column stays small.
      p_ip: request.headers.get('cf-connecting-ip') || null,
      p_ua: (request.headers.get('user-agent') || '').slice(0, 200) || null,
    }).catch(() => {});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd boards && node --test src/lib/roleCheck.test.mjs && npm test`
Expected: roleCheck passes; the full suite is green (in particular `docsite.test.mjs` — no public surface moved)

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0320_api_request_log_durability.sql boards/src/worker-api.js boards/src/lib/roleCheck.test.mjs
git diff --cached --name-only
git commit -m "Revoking a token erased its own audit history

api_request_log cascaded on both foreign keys, and both were NOT NULL, so the
customer-facing audit trail could be partly deleted by deleting the actor.
0320 makes the keys nullable with SET NULL (NOT VALID then VALIDATE, so no
write-blocking lock on the shared project), snapshots an actor label at write
time, and records cf-connecting-ip and the user agent from the Worker. Not
applied yet; the Worker sends the new arguments and the defaults cover the
production Worker until it is promoted."
git push origin main
```

---

### Task 6: The client permission mirror honours viewer

**Files:**
- Modify: `boards/src/hooks/useBoardPermission.js:54-61`
- Test: `boards/src/lib/boardPermission.test.mjs`

**Interfaces:**
- `computeBoardPermission({ board, boards, workspace, workspaceMembers, sharedBoards, userId, tier })` — unchanged signature; a workspace member whose `role === 'viewer'` now returns `{ role: 'viewer', canEdit: false, source: 'workspace' }`; a member with any other role still returns `{ role: 'editor', canEdit: true, source: 'workspace' }`.

- [ ] **Step 1: Write the failing test**

```js
// boards/src/lib/boardPermission.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBoardPermission } from '../hooks/useBoardPermission.js';

const ws = { id: 'ws1', created_by: 'owner' };
const board = { id: 'b1', workspace_id: 'ws1', parent_board_id: null };
const base = { board, boards: { b1: board }, workspace: ws, sharedBoards: [], tier: 'demo' };

test('a workspace viewer resolves to read-only', () => {
  const r = computeBoardPermission({ ...base, userId: 'v', workspaceMembers: [{ user_id: 'v', role: 'viewer' }] });
  assert.deepEqual(r, { role: 'viewer', canEdit: false, source: 'workspace' });
});

test('a workspace editor and a service member still write', () => {
  for (const role of ['editor', 'service', 'owner']) {
    const r = computeBoardPermission({ ...base, userId: 'e', workspaceMembers: [{ user_id: 'e', role }] });
    assert.equal(r.canEdit, true, role);
    assert.equal(r.source, 'workspace');
  }
});

test('an editor share on the board beats a viewer membership', () => {
  const r = computeBoardPermission({
    ...base, userId: 'v',
    workspaceMembers: [{ user_id: 'v', role: 'viewer' }],
    sharedBoards: [{ board_id: 'b1', role: 'editor' }],
  });
  assert.deepEqual(r, { role: 'editor', canEdit: true, source: 'share' });
});

test('the workspace owner is unaffected', () => {
  const r = computeBoardPermission({ ...base, userId: 'owner', workspaceMembers: [] });
  assert.equal(r.role, 'owner');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd boards && node --test src/lib/boardPermission.test.mjs`
Expected: FAIL — the viewer case returns `role: 'editor', canEdit: true`

- [ ] **Step 3: Change the membership branch**

Replace lines 54-61 of `boards/src/hooks/useBoardPermission.js` with:

```js
  // Workspace member of THE BOARD'S workspace (not necessarily the
  // currently active one — board could be from a different workspace
  // when navigating via shared links).
  //
  // 0318 made workspace_members.role real: a 'viewer' member reads but does
  // not write, unless a per-board editor share (below) says otherwise. Any
  // other role — owner, admin, editor, service — writes.
  const membership = (workspaceMembers || []).find(m => m.user_id === userId);
  const isWsMember = !!membership && board.workspace_id === workspace?.id;
  if (isWsMember && membership.role !== 'viewer') {
    return { role: 'editor', canEdit: true, source: 'workspace' };
  }
```

and after the share walk (line 79, `if (bestRole) { … }`) add, before the final `return { role: 'none' … }`:

```js
  if (isWsMember) {
    return { role: 'viewer', canEdit: false, source: 'workspace' };
  }
```

Also update the header comment lines 9-10 to read:

```js
// "editor" = workspace member with a writing role (owner/admin/editor/service)
//            OR per-board editor share.
// "viewer" = workspace member with role 'viewer', or a per-board viewer share
//            (cascades to descendants).
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd boards && node --test src/lib/boardPermission.test.mjs`
Expected: 4 passing

- [ ] **Step 5: Commit**

```bash
git add boards/src/hooks/useBoardPermission.js boards/src/lib/boardPermission.test.mjs
git diff --cached --name-only
git commit -m "The client permission mirror treats a workspace viewer as read-only

Matches 0318. A viewer member still gets an editor share's write on the
boards that share covers, exactly as the server predicate walks it."
git push origin main
```

---

### Task 7: Workspace invites can be view-only

**Files:**
- Modify: `boards/src/components/ShareModal.jsx` (the `inviteRole` uses at :449-452, :469-470, :493, :499, :521, :655-665, :659)

**Interfaces:**
- Consumes: `inviteWorkspaceMember({ workspaceId, email, role })` from `boardsApi.js:298` (already accepts `'viewer'`).

- [ ] **Step 1: Add the derived flags next to the state (line 87)**

```jsx
  const [inviteRole, setInviteRole] = useState('editor');
  // Two select values map to a workspace invite: 'workspace' (can edit) and
  // 'workspaceviewer' (read-only). Everything that used to test
  // inviteRole === 'workspace' tests isWorkspaceInvite now; the role that is
  // actually sent is workspaceRole.
  const isWorkspaceInvite = inviteRole === 'workspace' || inviteRole === 'workspaceviewer';
  const workspaceRole = inviteRole === 'workspaceviewer' ? 'viewer' : 'editor';
```

- [ ] **Step 2: Replace the five comparisons**

- line 449: `if (inviteRole === 'workspace') {` → `if (isWorkspaceInvite) {`
- lines 450-452: `role: 'editor'` → `role: workspaceRole`
- line 469: `how: inviteRole === 'workspace' ? 'workspace' : 'email'` → `how: isWorkspaceInvite ? 'workspace' : 'email'`
- line 470: `role: inviteRole` → `role: isWorkspaceInvite ? `workspace:${workspaceRole}` : inviteRole`
- line 493: `if (inviteRole === 'workspace' && …` → `if (isWorkspaceInvite && …`
- line 499: `if (inviteRole !== 'workspace' && …` → `if (!isWorkspaceInvite && …`
- line 521: `: (inviteRole === 'workspace'` → `: (isWorkspaceInvite`

- [ ] **Step 3: Add the second option to the select (lines 862-864)**

```jsx
                {isOwner && (
                  <option value="workspace">Whole workspace — can edit</option>
                )}
                {isOwner && (
                  <option value="workspaceviewer">Whole workspace — view only</option>
                )}
```

- [ ] **Step 4: Extend the role label map (line 659)**

```jsx
  const ROLE_LABEL = { viewer: 'Viewer', editor: 'Editor', workspace: 'Workspace member', workspaceviewer: 'Workspace viewer' };
```

- [ ] **Step 5: Type-check by building**

Run: `cd boards && npx vite build 2>&1 | tail -5`
Expected: build succeeds (no unresolved identifiers; `noUndefScan.test.mjs` also covers ShareModal — run `node --test src/lib/noUndefScan.test.mjs`)

- [ ] **Step 6: Commit**

```bash
git add boards/src/components/ShareModal.jsx
git diff --cached --name-only
git commit -m "Whole-workspace invites can be view-only

invite_workspace_member accepted 'viewer' since 0086 but the only caller
hard-coded 'editor', and until 0318 a viewer member could write anyway."
git push origin main
```

---

### Task 8: A Members tab in Settings

**Files:**
- Modify: `boards/src/lib/boardsApi.js` (append after `transferWorkspaceOwnership`, line 274)
- Create: `boards/src/components/settings/MembersTab.jsx`
- Modify: `boards/src/components/SettingsPanel.jsx:46-56` (TABS) and `:266-281` (pane)
- Modify: `boards/content/docs/account/settings.md`
- Generated (by `docs:build`/`docs:accept`): `boards/src/lib/docsiteIndex.js`, `docsiteContent.js`, `docsiteCrawlable.js`, `boards/public/docs/**`, `boards/public/llms*.txt`, `boards/src/lib/docsiteSurface.json`

**Interfaces:**
- Produces: `listWorkspaceDirectory(workspaceId) → [{ user_id, workspace_id, title, email, created_at }]` (wraps `rpc('workspace_user_directory')`, filtered client-side), `setWorkspaceMemberRole({ workspaceId, userId, role }) → void`.
- Consumes: `listWorkspaceMembers`, `removeWorkspaceMember`, `transferWorkspaceOwnership`, `inviteWorkspaceMember` (existing), `useFeedback` (`confirm`, `toast`), `useSettingsSave`, `Field`/`SettingsCategory` from `settings/fields.jsx`.

- [ ] **Step 1: Add the two API functions (after line 274 of boardsApi.js)**

```js
// Owner-only (0318): change an existing member's role between editor and
// viewer. The owner's own row is ownership, not a role — use
// transferWorkspaceOwnership for that.
export async function setWorkspaceMemberRole({ workspaceId, userId, role }) {
  const { error } = await supabase
    .rpc('set_workspace_member_role', {
      p_workspace_id: workspaceId,
      p_user_id: userId,
      p_role: role,
    });
  if (error) throw error;
}

// Names and emails for the members of one workspace. workspace_user_directory
// (0084) returns every workspace the caller belongs to, gated server-side by
// is_workspace_member, so filtering here leaks nothing the caller could not
// already see.
export async function listWorkspaceDirectory(workspaceId) {
  if (!workspaceId) return [];
  const { data, error } = await supabase.rpc('workspace_user_directory');
  if (error) throw error;
  return (data || []).filter(r => r.workspace_id === workspaceId);
}
```

- [ ] **Step 2: Write the tab**

```jsx
// boards/src/components/settings/MembersTab.jsx
//
// The third tab under "This workspace": who is in it, at what level, and — for
// the owner — the controls that were only reachable through the board-scoped
// ShareModal before (remove, transfer) plus the one that did not exist
// (change role, 0318).
//
// Removal uses the same confirm the ShareModal uses (ShareModal.onRemoveMember):
// it is an access change, not content deletion, so the undo-toast convention
// for deletes does not apply and there is nothing to restore silently — 0318
// also drops the person's board shares in this workspace.
import { useEffect, useMemo, useState } from 'react';
import {
  listWorkspaceMembers, listWorkspaceDirectory, setWorkspaceMemberRole,
  removeWorkspaceMember, transferWorkspaceOwnership, inviteWorkspaceMember,
} from '../../lib/boardsApi.js';
import { useFeedback } from '../AppFeedback.jsx';
import { SettingsCategory } from './fields.jsx';
import { useSettingsSave } from './saveState.jsx';

const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', editor: 'Editor', viewer: 'Viewer', service: 'Service account' };

export function MembersTab({ workspaceId, workspaceName, user, role, onWorkspacesChanged }) {
  const feedback = useFeedback();
  const save = useSettingsSave();
  const isOwner = role === 'owner';
  const [members, setMembers] = useState([]);
  const [directory, setDirectory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('editor');

  const load = async () => {
    if (!workspaceId) { setMembers([]); setDirectory([]); return; }
    setLoading(true);
    try {
      const [m, d] = await Promise.all([listWorkspaceMembers(workspaceId), listWorkspaceDirectory(workspaceId)]);
      setMembers(m); setDirectory(d);
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Could not load members: ' + (e.message || e) });
    } finally {
      setLoading(false);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [workspaceId]);

  const byId = useMemo(() => new Map(directory.map(d => [d.user_id, d])), [directory]);
  const label = (m) => byId.get(m.user_id)?.title || byId.get(m.user_id)?.email || m.user_id.slice(0, 8);

  const changeRole = (m, next) => save(async () => {
    await setWorkspaceMemberRole({ workspaceId, userId: m.user_id, role: next });
    await load();
  });

  const remove = async (m) => {
    const who = label(m);
    const ok = await feedback.confirm({
      title: `Remove ${who}?`,
      message: `They'll lose access to "${workspaceName}" and all its clusters, including any cluster shared to them directly.`,
      confirmLabel: 'Remove member',
      danger: true,
    });
    if (!ok) return;
    try {
      await removeWorkspaceMember({ workspaceId, userId: m.user_id });
      feedback.toast({ type: 'success', message: `Removed ${who}.` });
      await load();
      await onWorkspacesChanged?.();
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Could not remove: ' + (e.message || e) });
    }
  };

  const transfer = async (m) => {
    const who = label(m);
    const ok = await feedback.confirm({
      title: `Make ${who} the owner?`,
      message: `You'll become an editor of "${workspaceName}". Only they can transfer it back.`,
      confirmLabel: 'Transfer ownership',
      danger: true,
    });
    if (!ok) return;
    try {
      await transferWorkspaceOwnership({ workspaceId, newOwnerId: m.user_id });
      feedback.toast({ type: 'success', message: `${who} now owns this workspace.` });
      await load();
      await onWorkspacesChanged?.();
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Could not transfer: ' + (e.message || e) });
    }
  };

  const invite = async () => {
    const email = inviteEmail.trim();
    if (!email || !isOwner) return;
    try {
      const status = await inviteWorkspaceMember({ workspaceId, email, role: inviteRole });
      feedback.toast({
        type: status === 'already_member' ? 'warning' : 'success',
        message: status === 'pending' ? `Invited ${email} — access is waiting for them when they sign up.`
              : status === 'already_member' ? `${email} is already a member.`
              : `Added ${email} as ${inviteRole}.`,
      });
      setInviteEmail('');
      await load();
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Could not invite: ' + (e.message || e) });
    }
  };

  return (
    <div className="settings-tab-body">
      <SettingsCategory title="People in this workspace"
                        hint={isOwner ? 'Editors can add and change content. Viewers can open and read, comment, and vote.'
                                      : 'Only the owner can change roles or remove members.'}>
        {loading && members.length === 0 && <div className="settings-muted">Loading…</div>}
        <ul className="settings-member-list">
          {members.map(m => {
            const self = m.user_id === user?.id;
            const isOwnerRow = m.role === 'owner';
            const changeable = isOwner && !isOwnerRow && !self && (m.role === 'editor' || m.role === 'viewer');
            return (
              <li key={m.user_id} className="settings-member-row">
                <span className="settings-member-name">{label(m)}{self ? ' (you)' : ''}</span>
                {changeable ? (
                  <select className="settings-select" aria-label={`Role for ${label(m)}`}
                          value={m.role} onChange={(e) => changeRole(m, e.target.value)}>
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                  </select>
                ) : (
                  <span className="settings-member-role">{ROLE_LABEL[m.role] || m.role}</span>
                )}
                {isOwner && !isOwnerRow && !self && m.role !== 'service' && (
                  <span className="settings-member-actions">
                    <button type="button" className="settings-link-btn" onClick={() => transfer(m)}>Make owner</button>
                    <button type="button" className="settings-link-btn is-danger" onClick={() => remove(m)}>Remove</button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </SettingsCategory>
      {isOwner && (
        <SettingsCategory title="Add someone" hint="They sign in to accept. Editors are free on every plan.">
          <div className="settings-invite-row">
            <input className="settings-input" type="email" placeholder="Email address"
                   aria-label="Email address to invite"
                   value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)}
                   onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); invite(); } }} />
            <select className="settings-select" aria-label="Role for the new member"
                    value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </select>
            <button type="button" className="settings-btn" onClick={invite} disabled={!inviteEmail.trim()}>Invite</button>
          </div>
        </SettingsCategory>
      )}
    </div>
  );
}
```

Add these rules at the end of `boards/src/styles.css` (neutral ink only; the danger colour is the existing `--danger` token if present, else `#ef4444` as `StorageMeter` uses; no gold):

```css
/* Settings → Members (Phase 0). Table-shaped, so it is a list, not a grid. */
.settings-member-list { list-style: none; margin: 0; padding: 0; }
.settings-member-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--line, rgba(0,0,0,.08)); }
.settings-member-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.settings-member-role { color: var(--ink-2); font-size: 13px; }
.settings-member-actions { display: flex; gap: 8px; }
.settings-link-btn { background: none; border: 0; padding: 0; color: var(--ink-2); font: inherit; font-size: 13px; cursor: pointer; text-decoration: underline; }
.settings-link-btn.is-danger { color: #ef4444; }
.settings-invite-row { display: flex; gap: 8px; flex-wrap: wrap; }
.settings-invite-row .settings-input { flex: 1; min-width: 180px; }
```

(If `settings-input`, `settings-select`, `settings-btn` do not already exist in `styles.css`, use the class names `fields.jsx` uses for its text input and select — check with `grep -n "className=\"settings-" boards/src/components/settings/fields.jsx` and match them.)

- [ ] **Step 3: Register the tab**

In `SettingsPanel.jsx`, TABS (line 46-56) gains, after the `general` entry and before `defaults`:

```js
  { id: 'members',       label: 'Members',        group: 'workspace' },
```

Import next to `WorkspaceGeneralTab`:

```js
import { MembersTab } from './settings/MembersTab.jsx';
```

Pane, after the `general` block (line 275):

```jsx
              {tab === 'members' && (
                <MembersTab workspaceId={workspaceId}
                            workspaceName={workspaceName}
                            user={user}
                            role={role}
                            onWorkspacesChanged={onWorkspacesChanged} />
              )}
```

- [ ] **Step 4: Run the docs gate to see it trip**

Run: `cd boards && node --test src/lib/docsite.test.mjs 2>&1 | tail -20`
Expected: FAIL naming `settingsTabs` (the surface hash moved: `members` was added)

- [ ] **Step 5: Document the tab**

In `boards/content/docs/account/settings.md`:
- `metaDescription`: `… General, Members, Card defaults and Documentation.`
- `answer`: `This workspace covers General, Members and Card defaults.`
- `updated: 2026-09-10`
- Under `## This workspace`, after the `### General` section, add:

```md
### Members

Everyone in the workspace, with their level: **Owner**, **Editor** (adds and
changes content) or **Viewer** (opens, reads, comments and votes, but does not
change anything). The owner can change an editor to a viewer and back, remove a
member — which also removes any cluster shared to them directly in this
workspace — hand the workspace to another member, and invite someone by email
as an editor or a viewer. Everyone else sees the list.
```

- and change the intro line of `## This workspace` to: `Shared. Everyone in the workspace sees the same values. Editors and owners can change Card defaults; only the owner can change the name, the icon, the members, or run a recovery. Viewers see everything read-only.`

Then: `cd boards && npm run docs:build && npm run docs:accept && node --test src/lib/docsite.test.mjs`
Expected: PASS

- [ ] **Step 6: Build and run the suite**

Run: `cd boards && npx vite build 2>&1 | tail -3 && npm test 2>&1 | tail -5`
Expected: build OK; suite green

- [ ] **Step 7: Commit**

```bash
git add boards/src/lib/boardsApi.js boards/src/components/settings/MembersTab.jsx boards/src/components/SettingsPanel.jsx boards/src/styles.css boards/content/docs/account/settings.md boards/src/lib/docsiteIndex.js boards/src/lib/docsiteContent.js boards/src/lib/docsiteCrawlable.js boards/src/lib/docsiteSurface.json boards/public/docs boards/public/llms.txt boards/public/llms-full.txt
git diff --cached --name-only
git commit -m "Settings gets a Members tab; workspace membership had no home outside the Share dialog

Roster with names, role change (editor/viewer, owner-only, via
set_workspace_member_role from 0318), remove, transfer and invite. Documented
in account/settings.md and the surface snapshot re-accepted."
git push origin main
```

---

### Task 9: Presence identity is checked against the JWT

**Files:**
- Modify: `boards/party/workspace.ts` (`onBeforeConnect` :62-70, `onConnect` :72-82, `onMessage` :84-124, `connInfo` type :57)

**Interfaces:**
- Consumes: `authWorkspace(token, workspaceId) → { ok, userId, email }` (`party/auth.ts:216-235`).

The board party's awareness identity rides y-partykit's binary protocol and is deferred to Phase 1's socket re-authorization work; this task closes the JSON presence roster, where any member could appear as anyone (`workspace.ts:87-103` accepts `msg.user` verbatim).

- [ ] **Step 1: Stamp the user id at upgrade time**

Replace `onBeforeConnect` (lines 62-70) with:

```ts
  static async onBeforeConnect(req: Party.Request) {
    const url = new URL(req.url);
    const token = url.searchParams.get("access_token");
    if (!token) return new Response("Missing access_token", { status: 401 });
    const workspaceId = url.pathname.split("/").filter(Boolean).pop() ?? "";
    const auth = await authWorkspace(token, workspaceId);
    if (!auth.ok) return new Response(auth.reason ?? "Unauthorized", { status: 401 });
    // The roster trusts what a client says its identity is; stamp the JWT's
    // subject here so onMessage can refuse a `here` that claims to be someone
    // else. Headers set on the upgrade request are visible in onConnect.
    req.headers.set("x-user-id", auth.userId ?? "");
    return req;
  }
```

- [ ] **Step 2: Carry it on the connection**

Change the `connInfo` type (line 57) to `{ tabId?: string; epoch: number; userId?: string }` and `onConnect` (lines 72-82) to:

```ts
  onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    // Stamp a fresh epoch for this connection object up front, so even a
    // reconnect that reuses connection.id is distinguishable from its dead
    // predecessor. Also remember whose JWT opened it.
    const userId = ctx.request.headers.get("x-user-id") || undefined;
    this.connInfo.set(conn, { epoch: ++this.epoch, userId });
    this.pruneStale();
    const roster = [...this.peers.values()];
    conn.send(JSON.stringify({ type: "roster", peers: roster }));
  }
```

- [ ] **Step 3: Refuse impersonation**

At the top of the `here` branch in `onMessage` (after line 87's condition), before `const tabId`:

```ts
      const owner = this.connInfo.get(sender)?.userId;
      if (owner && String(msg.user.id) !== owner) {
        // A member claiming to be another member. Drop it; the socket stays
        // open because the rest of the protocol is fine.
        console.warn(`[workspace ${this.room.id}] presence identity mismatch`);
        return;
      }
```

and keep the existing `const info = this.connInfo.get(sender) ?? { epoch: ++this.epoch };` line as is (it now carries `userId` through).

- [ ] **Step 4: Type-check the party**

Run: `cd boards && npx tsc --noEmit -p party/tsconfig.json 2>&1 | tail -5` (if there is no `party/tsconfig.json`, run `npx partykit dev --port 1999 --dry-run 2>&1 | tail -5`; either way expect no type errors mentioning `workspace.ts`)

- [ ] **Step 5: Commit**

```bash
git add boards/party/workspace.ts
git diff --cached --name-only
git commit -m "The presence roster took any member's word for who they were

The workspace party accepted msg.user verbatim, so a member could appear as
the showrunner. The JWT subject is stamped at upgrade and a here message
claiming a different id is dropped. Board-room awareness (binary y-partykit
protocol) is handled with socket re-authorization in Phase 1. Party not
deployed yet."
git push origin main
```

---

### Task 10: The server measures a multipart upload's bytes

**Files:**
- Modify: `boards/party/upload.ts` (`completeMultipart` :593-607, `handleMpuComplete` :686-708)
- Modify: `boards/src/lib/uploads.js` (`insertFileImageRow` :1022-1041, the `complete` call :1103-1107, the call at :1119)

**Interfaces:**
- `POST /mpu/complete` now returns `{ key, bytes }` where `bytes` is the R2 object's `content-length` after completion (or `null` if the HEAD failed).
- `insertFileImageRow({ …, sizeBytes })` writes `size_bytes: sizeBytes ?? file.size ?? null`.

The client-declared `images.size_bytes` is what every quota reads (0221), and the Worker backfill only fills NULLs. This is the smallest server-authoritative step; the DB-side reconciliation that corrects non-null mismatches belongs to Phase 1's storage re-keying (0324).

- [ ] **Step 1: HEAD the object after completion**

Replace `completeMultipart` (lines 593-607) with:

```ts
  // S3 CompleteMultipartUpload. Returns { ok, bytes } where bytes is what R2
  // reports for the finished object — the number the quota should believe,
  // rather than whatever the client said before uploading.
  async completeMultipart(
    r2: AwsClient, env: R2Env, key: string, uploadId: string, parts: Array<{ partNumber: number; etag: string }>,
  ): Promise<{ ok: boolean; bytes?: number | null; error?: string }> {
    const body = `<CompleteMultipartUpload>${parts.map((p) => {
      const et = String(p.etag || "").replace(/"/g, "");
      return `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>"${et}"</ETag></Part>`;
    }).join("")}</CompleteMultipartUpload>`;
    const url = `${this.r2ObjectUrl(env, key)}?uploadId=${encodeURIComponent(uploadId)}`;
    const res = await r2.fetch(url, { method: "POST", body, headers: { "Content-Type": "application/xml" } });
    const text = await res.text().catch(() => "");
    if (!res.ok || /<Error>/.test(text)) return { ok: false, error: text.slice(0, 500) };
    let bytes: number | null = null;
    try {
      const head = await r2.fetch(this.r2ObjectUrl(env, key), { method: "HEAD" });
      const len = Number(head.headers.get("content-length"));
      if (head.ok && Number.isFinite(len) && len >= 0) bytes = len;
    } catch (_) { /* size stays unknown; the nightly backfill fills NULLs */ }
    return { ok: true, bytes };
  }
```

(Keep the first line of the original body — the `parts` mapping — exactly as it was if it differs from the reconstruction above; only the return type and the HEAD block are new.)

In `handleMpuComplete`, change the final line (707) to:

```ts
    return Response.json({ key, bytes: result.bytes ?? null }, { headers: corsHeaders(origin) });
```

- [ ] **Step 2: Record it on the client**

In `uploads.js`, change the `complete` call (lines 1103-1106) to capture the response:

```js
    const done = await mpuPost('complete', workspaceId, {
      boardId, key, uploadId,
      parts: parts.map(p => ({ partNumber: p.partNumber, etag: completed[p.partNumber] })),
    });
    serverBytes = Number.isFinite(Number(done?.bytes)) ? Number(done.bytes) : null;
```

declare `let serverBytes = null;` just above the `try {` that contains it, and change line 1119 to:

```js
  await insertFileImageRow({ workspaceId, boardId, cardId, key, file, userId, sizeBytes: serverBytes });
```

and `insertFileImageRow` (line 1022 signature and line 1032):

```js
async function insertFileImageRow({ workspaceId, boardId, cardId, key, file, userId, sizeBytes = null }) {
  …
      size_bytes: sizeBytes ?? file.size ?? null,
```

Also change the returned `sizeBytes: file.size,` (line 1124) to `sizeBytes: serverBytes ?? file.size,`.

Check `mpuPost` returns the parsed JSON body on success (`uploads.js:912-930`); if it returns `undefined` for 2xx, make it `return res.status === 204 ? null : await res.json().catch(() => null);`.

- [ ] **Step 3: Build**

Run: `cd boards && npx vite build 2>&1 | tail -3`
Expected: OK

- [ ] **Step 4: Commit**

```bash
git add boards/party/upload.ts boards/src/lib/uploads.js
git diff --cached --name-only
git commit -m "A multipart upload's size now comes from R2, not from the client

images.size_bytes was whatever the browser declared, and the backfill only
fills NULLs, so a quota could be under-reported by a modified client. The
upload party HEADs the finished object and the client records that number."
git push origin main
```

---

### Task 11: Documentation says what the server does, and CLAUDE.md stops lying about CI

**Files:**
- Modify: `boards/content/docs/collaborate/index.md` (FAQ :15-16, roles table :29-34, `updated`)
- Modify: `boards/content/docs/collaborate/comments.md` (:64-69, `updated`)
- Modify: `CLAUDE.md` (:82 and the House conventions list)
- Generated: docs outputs (`docs:build`)

- [ ] **Step 1: collaborate/index.md**

- `updated: 2026-09-10`
- FAQ item `Can a viewer comment?` → `a: Yes. Viewers can read, comment and vote; they cannot add, move or change cards.`
- Roles table:

```md
| Role | Can |
|---|---|
| **Owner** | Everything, including deleting the cluster and managing members and shares |
| **Editor** | Add, change and remove content; comment; invite if permitted |
| **Viewer** | Open, read, [comment](/docs/collaborate/comments) and [vote](/docs/canvas/vote-cards) — never change content |
| **Workspace member** | The same two levels, editor or viewer, granted for every cluster in the workspace at once |
```

- [ ] **Step 2: collaborate/comments.md**

- `updated: 2026-09-10`
- Replace the `## Who can comment` section with:

```md
## Who can comment

Anyone who can open the board, including viewers. Editing a card is a
different right from talking about it, and feedback is the point of sharing
a board with someone. Public links are the exception: they are anonymous, and
comments need an account.
```

- [ ] **Step 3: CLAUDE.md**

Line 82 `Two tiers, neither wired to CI (there is no CI):` → `Two tiers. The first runs in CI (\`.github/workflows/test.yml\`: \`npm test\` and \`docs:check\` on every push to main/production and every PR); Playwright does not:`

Under `## House conventions`, add a bullet:

```md
- **Function grants since 0311:** a new function is born with EXECUTE for
  `authenticated` and `service_role` only. A `_`-prefixed internal helper must
  `revoke execute … from public, anon, authenticated`; an RPC meant for
  signed-out callers needs an explicit `grant … to anon`; every migration that
  creates functions ends with a `do $$ … has_function_privilege … $$` block
  that proves its own grants (the 0311 habit — a REVOKE reporting success
  proves nothing).
```

- [ ] **Step 4: Rebuild docs and run the suite**

Run: `cd boards && npm run docs:build && npm run docs:check && npm test 2>&1 | tail -3`
Expected: `docs:check` clean; suite green (no surface moved, so no `docs:accept` needed)

- [ ] **Step 5: Commit**

```bash
git add boards/content/docs/collaborate/index.md boards/content/docs/collaborate/comments.md CLAUDE.md boards/src/lib/docsiteIndex.js boards/src/lib/docsiteContent.js boards/src/lib/docsiteCrawlable.js boards/public/docs boards/public/llms.txt boards/public/llms-full.txt
git diff --cached --name-only
git commit -m "Docs said viewers cannot comment; the server has let them since 0031

collaborate/index.md and comments.md now describe the real rule, which 0318
names in can_comment_board. CLAUDE.md's 'there is no CI' line was stale since
test.yml landed, and it gains the post-0311 function-grant rule."
git push origin main
```

---

### Task 12: Source-reading spec for the client wiring

**Files:**
- Create: `boards/tests/share-roles-wiring.spec.js`

- [ ] **Step 1: Write the spec**

```js
// Source-guard for Phase 0's client half: the ShareModal can invite a
// workspace viewer, the Members tab exists and is documented, the permission
// mirror honours viewer, the presence party checks identity. The ?local=1
// harness stubs Supabase and never mounts ShareModal or SettingsPanel, so this
// reads the source the way collab-invite-link-wiring does.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, new URL('../', import.meta.url)), 'utf8');

test.describe('workspace roles wiring', () => {
  test('ShareModal sends the chosen workspace role, not a hard-coded editor', () => {
    const s = read('src/components/ShareModal.jsx');
    expect(s).toContain("const workspaceRole = inviteRole === 'workspaceviewer' ? 'viewer' : 'editor';");
    expect(s).toMatch(/inviteWorkspaceMember\(\{[\s\S]{0,120}role: workspaceRole,/);
    expect(s).not.toMatch(/inviteWorkspaceMember\(\{[\s\S]{0,120}role: 'editor'/);
    expect(s).toContain('<option value="workspaceviewer">');
  });

  test('Settings has a members tab, in the right key order for the docs gate', () => {
    const s = read('src/components/SettingsPanel.jsx');
    expect(s).toMatch(/\{ id: 'members',\s+label: 'Members',\s+group: 'workspace' \}/);
    expect(s).toContain("{tab === 'members' && (");
    expect(read('content/docs/account/settings.md')).toContain('### Members');
  });

  test('the Members tab uses the 0318 RPC and confirms before removing', () => {
    const s = read('src/components/settings/MembersTab.jsx');
    expect(s).toContain('setWorkspaceMemberRole({');
    expect(s).toMatch(/feedback\.confirm\(\{[\s\S]{0,200}confirmLabel: 'Remove member'/);
    expect(read('src/lib/boardsApi.js')).toContain("rpc('set_workspace_member_role'");
  });

  test('the permission mirror returns viewer for a viewer member', () => {
    const s = read('src/hooks/useBoardPermission.js');
    expect(s).toContain("membership.role !== 'viewer'");
    expect(s).toContain("return { role: 'viewer', canEdit: false, source: 'workspace' };");
  });

  test('the workspace party refuses a presence claim for another user', () => {
    const s = read('party/workspace.ts');
    expect(s).toContain('req.headers.set("x-user-id", auth.userId ?? "");');
    expect(s).toContain('String(msg.user.id) !== owner');
  });

  test('the upload party reports the object size it measured', () => {
    expect(read('party/upload.ts')).toContain('{ key, bytes: result.bytes ?? null }');
    expect(read('src/lib/uploads.js')).toContain('sizeBytes: serverBytes');
  });
});
```

- [ ] **Step 2: Run it**

Run: `cd boards && npx playwright test tests/share-roles-wiring.spec.js --project=desktop-chrome 2>&1 | tail -8`
Expected: 6 passed (if a concurrent session has a Vite server on 5173, set `PW_PORT` per the house note in memory so the run does not reuse another tree's server; source-reading specs do not need the server at all)

- [ ] **Step 3: Commit**

```bash
git add boards/tests/share-roles-wiring.spec.js
git diff --cached --name-only
git commit -m "Wiring spec for the Phase 0 client changes"
git push origin main
```

---

### Task 13: The rolled-back behavioural probe

**Files:**
- Create: `supabase/tests/phase0_rls_probe.sql`

Run through the Supabase MCP `execute_sql` as one statement inside `begin; … rollback;`. It creates its own fixture rows (a workspace, four users, a board, a share) and asserts with `raise exception` on any mismatch, so a clean run prints only notices. The `auth.users` inserts set the GoTrue token columns to `''`, not NULL — a hand-inserted row with NULLs breaks `generate_link` for that user (house gotcha), and even inside a rollback it is the correct shape.

- [ ] **Step 1: Write the probe**

```sql
-- supabase/tests/phase0_rls_probe.sql
-- Run inside `begin; … rollback;` via the Supabase MCP. Read-only in effect.
-- Expected BEFORE 0317–0320: the assertions marked (AFTER) fail — that is the
-- point; keep the output as the "before" record. Expected AFTER: all pass.
do $$
declare
  u_owner  uuid := gen_random_uuid();
  u_editor uuid := gen_random_uuid();
  u_viewer uuid := gen_random_uuid();
  u_banned uuid := gen_random_uuid();
  u_out    uuid := gen_random_uuid();
  ws       uuid;
  b        uuid;
  b_child  uuid;
  ok       boolean;
  ids      uuid[];
  r        record;
begin
  -- fixture users (token columns '' per the GoTrue gotcha)
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change,
                          email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  select x.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         x.email, '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(),
         '', '', '', '', '', '', '', ''
  from (values (u_owner, 'probe-owner@example.invalid'), (u_editor, 'probe-editor@example.invalid'),
               (u_viewer, 'probe-viewer@example.invalid'), (u_banned, 'probe-banned@example.invalid'),
               (u_out, 'probe-out@example.invalid')) as x(id, email);
  insert into public.profiles (user_id, tier) values (u_owner,'demo'),(u_editor,'demo'),(u_viewer,'demo'),(u_banned,'demo'),(u_out,'demo')
  on conflict (user_id) do nothing;
  update public.profiles set banned_at = now() where user_id = u_banned;

  insert into public.workspaces (name, created_by) values ('probe', u_owner) returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role) values
    (ws, u_owner, 'owner'), (ws, u_editor, 'editor'), (ws, u_viewer, 'viewer'), (ws, u_banned, 'editor');
  insert into public.boards (workspace_id, name, view, created_by) values (ws, 'root', 'canvas', u_owner) returning id into b;
  insert into public.board_state (board_id, doc) values (b, '');
  insert into public.boards (workspace_id, parent_board_id, name, view, created_by) values (ws, b, 'child', 'canvas', u_owner) returning id into b_child;
  insert into public.board_shares (board_id, user_id, role, invited_by) values (b_child, u_viewer, 'editor', u_owner);

  -- ── as the viewer ──
  perform set_config('request.jwt.claims', json_build_object('sub', u_viewer, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select public.can_read_board(b) into ok;      if not ok then raise exception 'viewer cannot read the board'; end if;
  select public.can_write_board(b) into ok;     if ok then raise exception '(AFTER) viewer can still write the root board'; end if;
  select public.can_write_workspace(ws) into ok; if ok then raise exception '(AFTER) viewer can still write the workspace'; end if;
  select public.can_write_board(b_child) into ok; if not ok then raise exception 'viewer with an editor share cannot write the shared child'; end if;
  select public.can_comment_board(b) into ok;   if not ok then raise exception '(AFTER) viewer cannot comment'; end if;
  select allow into ok from public.authorize_upload(ws, 10); if ok then raise exception '(AFTER) viewer can open a multipart upload'; end if;
  select public.my_readable_board_ids() into ids; if not (ids @> array[b, b_child]) then raise exception 'viewer read set wrong'; end if;
  perform set_config('role', 'postgres', true);

  -- ── as the editor ──
  perform set_config('request.jwt.claims', json_build_object('sub', u_editor, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select public.can_write_board(b) into ok; if not ok then raise exception 'editor lost write'; end if;
  select public.can_write_workspace(ws) into ok; if not ok then raise exception 'editor lost workspace write'; end if;
  -- (AFTER) column grants: an editor cannot take the workspace
  begin
    update public.workspaces set created_by = u_editor where id = ws;
    raise exception '(AFTER) editor rewrote workspaces.created_by';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.workspaces set name = 'renamed' where id = ws;
  exception when insufficient_privilege then raise exception 'editor lost the rename grant';
  end;
  perform set_config('role', 'postgres', true);

  -- ── as the banned member ──
  perform set_config('request.jwt.claims', json_build_object('sub', u_banned, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select public.can_read_board(b) into ok; if ok then raise exception '(AFTER) banned member can read'; end if;
  select public.my_readable_board_ids() into ids; if coalesce(array_length(ids, 1), 0) <> 0 then raise exception '(AFTER) banned member read set not empty'; end if;
  select public.my_workspace_ids() into ids; if coalesce(array_length(ids, 1), 0) <> 0 then raise exception '(AFTER) banned member workspace set not empty'; end if;
  select public.can_write_board(b) into ok; if ok then raise exception '(AFTER) banned member can write'; end if;
  perform set_config('role', 'postgres', true);

  -- ── as an outsider and as anon ──
  perform set_config('request.jwt.claims', json_build_object('sub', u_out, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select public.can_read_board(b) into ok; if ok then raise exception 'outsider can read'; end if;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);
  select public.can_read_board(b) into ok; if ok then raise exception 'anon can read'; end if;
  select public.my_readable_board_ids() into ids; if coalesce(array_length(ids, 1), 0) <> 0 then raise exception 'anon read set not empty'; end if;
  perform set_config('role', 'postgres', true);

  -- ── owner-side RPCs and the cascade ──
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.set_workspace_member_role(ws, u_viewer, 'editor');                        -- (AFTER)
  select role into r from public.workspace_members where workspace_id = ws and user_id = u_viewer;
  if r.role <> 'editor' then raise exception '(AFTER) set_workspace_member_role did not apply'; end if;
  perform public.remove_workspace_member(ws, u_viewer);
  if exists (select 1 from public.board_shares where user_id = u_viewer and board_id = b_child) then
    raise exception '(AFTER) removal did not cascade to board_shares';
  end if;
  perform set_config('role', 'postgres', true);

  -- ── grants and helpers ──
  if has_function_privilege('anon', 'public._actor_active()', 'execute') then raise exception '(AFTER) _actor_active anon-callable'; end if;
  if not has_function_privilege('anon', 'public.can_read_board(uuid)', 'execute') then raise exception 'can_read_board lost anon'; end if;
  if has_table_privilege('authenticated', 'public.public_share_links', 'update') then raise exception '(AFTER) public_share_links writable'; end if;
  if has_column_privilege('authenticated', 'public.boards', 'workspace_id', 'update') then raise exception '(AFTER) boards.workspace_id writable'; end if;
  -- the realtime policies still exist and still name the predicates
  if (select count(*) from pg_policies where schemaname = 'realtime' and tablename = 'messages'
        and (qual ilike '%can_read_board%' or qual ilike '%can_write_board%' or qual ilike '%is_workspace_member%'
             or with_check ilike '%can_write_board%' or with_check ilike '%is_workspace_member%')) < 4 then
    raise exception 'realtime.messages policies moved';
  end if;

  raise notice 'phase0 probe: all assertions passed';
end $$;
```

- [ ] **Step 2: Run it BEFORE applying (expected to fail at the first (AFTER) assertion)**

Via MCP `execute_sql` with the body `begin; <file contents> rollback;`. Record the failing assertion text in the promotion notes: it should be `(AFTER) viewer can still write the root board`.

- [ ] **Step 3: Commit the probe**

```bash
git add supabase/tests/phase0_rls_probe.sql
git diff --cached --name-only
git commit -m "Rolled-back behavioural probe for Phase 0"
git push origin main
```

---

### Task 14: Apply to the shared project — gated

**STOP. This step changes the production database.** Before anything below, tell the owner: which four migrations, the viewer-row count from 0318's pre-flight (run `select count(*) from workspace_members where role = 'viewer'` read-only first and report the number to the owner in chat, not in any file), and that `remove_workspace_member`/`leave_workspace` now cascade board shares. Proceed only on an explicit yes.

- [ ] **Step 1: Pre-checks**

- `cd boards && npm test` green; `npm run docs:check` clean.
- `git status` shows nothing of ours uncommitted.
- `ls supabase/migrations | tail -4` shows 0317–0320 and no duplicate prefixes.
- Run the probe (Task 13) before; note the first failing assertion.

- [ ] **Step 2: Apply in order**

Use `mcp__supabase__apply_migration` four times with `name` = the file's basename without extension and `query` = the file contents: `0317_workspace_board_link_grants`, `0318_workspace_roles_real`, `0319_read_suspend_gate`, `0320_api_request_log_durability`. Each migration's own `do $$` block raises if a post-condition failed; a failure means stop and report, not retry.

- [ ] **Step 3: Verify**

- Run the probe again inside `begin; … rollback;` — expect `phase0 probe: all assertions passed`.
- `select proname, has_function_privilege('anon', oid, 'execute') as anon from pg_proc where proname in ('_actor_active','_workspace_member_role','_workspace_member_can_write','can_read_board','can_write_board','can_write_workspace','can_comment_board','set_workspace_member_role','api_log_request');` — the three helpers and `api_log_request` false, the five RLS helpers true, `set_workspace_member_role` false.
- `mcp__supabase__get_advisors` (security) — no new ERROR-level items; the anon-executable count must not have grown.
- Open production (`clusters.soleilpictures.com`) in a browser as a normal account: create a board, rename a workspace, share a board, invite by email. All must work against the new schema with the OLD client (this is the shared-project check; the production Worker/client have not changed).

- [ ] **Step 4: Deploy the party — gated**

`npm run deploy:party` drops every open socket (clients reconnect). Ask the owner for a time window; then run it from `boards/`. Afterwards open a board in two browsers and confirm presence dots appear.

- [ ] **Step 5: Record**

Append to the commit that follows (or in chat if nothing else changes): the four migration names, the probe result, the advisor delta, and that production promotion of the client (Tasks 6–8, 10) is a separate cherry-pick per `docs/superpowers/specs/2026-09-10-enterprise-orgs-and-seats-design.md` → Verification → promotion checklist. Do not promote in this plan.

---

## Self-review

**Spec coverage.** Phase 0 in the design record lists: workspaces/boards column grants (Task 2), public_share_links closure (Task 2), `ai_tagger_enabled` (Task 2), role CHECK with pre-assert (Task 3), share cascade (Task 3), `set_workspace_member_role` (Task 3), viewer excluded from both write predicates and from `authorize_upload` (Task 3), comments → `can_comment_board` (Task 3), invite role bug (Task 3), `_actor_active` on reads (Task 4), `api_request_log` durability with `not valid`/`validate` (Task 5), presence identity (Task 9), server-authoritative bytes (Task 10, minimal form; reconciliation deferred to 0324 as the design says), ShareModal role picker (Task 7), Members tab (Task 8), docs + CLAUDE.md (Task 11), tests (Tasks 1–6, 12), probe (Task 13), realtime policies in the probe (Task 13). `authWorkspace` via RPC is Phase 1 (it needs `can_read_workspace`, which needs orgs) and is deliberately not here.

**Placeholders.** None: every SQL body is complete; the two "check with grep" notes in Tasks 8 and 10 name the exact command and the exact fallback.

**Type consistency.** `set_workspace_member_role(uuid, uuid, text)` everywhere; `_workspace_member_can_write(uuid)`; `api_log_request` 10-argument signature in migration, revoke, test and Worker; `computeBoardPermission` return shape `{ role, canEdit, source }`; `insertFileImageRow({ …, sizeBytes })`; ShareModal option value `workspaceviewer` matches the spec's regex.
