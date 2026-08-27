-- 0265_grid_layouts.sql
--
-- Saved grid layouts — the Templates library.
--
-- A grid card's shape is a fraction tree (boards/src/lib/gridLayout.js). Until
-- now the only shapes anyone could reach were the ten built-ins compiled into
-- the bundle. This table makes a shape durable: save the grid you are looking
-- at, keep it to yourself or give it to the workspace, and hand it to anyone
-- with a link.
--
-- WHY A NEW TABLE, NOT A WIDENING
--
-- `boards` was the obvious place to hang this and is the wrong one. A template
-- is not board content — it outlives the board it came from, is reused across
-- boards, and is visible on a different axis (personal / workspace / public)
-- than boards are. It would also have meant an ADD COLUMN on `boards`, which
-- carries table-level grants, so every new column is instantly client-writable
-- (see 0238 and 0247, where that recurs on every single ADD COLUMN). A fresh
-- table gets a clean `revoke all` and an explicit column-list grant instead.
--
-- WHAT IS STORED — LAYOUT ONLY
--
-- `body` is { layout, textStyle }: the fraction tree and an optional shared
-- text style. NOT cell content. That is a deliberate scope choice, and it is
-- what makes this table cheap: a layout holds no image references, so sharing
-- one across workspaces needs none of the cross-workspace R2 grant machinery
-- that publishing a BOARD needs (compare prepare_showcase in 0143). A template
-- is ~1KB of geometry. A future version may add a `cells` key to `body`; the
-- jsonb column is shaped so that needs no migration.
--
-- NAMING — READ THIS BEFORE ADDING ANYTHING NEARBY
--
-- The app already has a `gridTemplates` Y.Map, a `card.templateId` field, and a
-- promoteGridToTemplate() mutator. Those mean something ELSE: a LINKED FAMILY,
-- a live link between grids on ONE board where editing one reflows the others.
-- They are per-board CRDT state and have nothing to do with this table. This is
-- named grid_layouts, not grid_templates, precisely so the two never blur. The
-- Y.Map keeps its name because every existing board's CRDT holds one under it.
--
-- ALSO DROPS board_templates (0033), WHICH WAS NEVER USED
--
-- 0033 built a `board_templates` table for whole-board Y.Doc snapshots, 0048
-- added an UPDATE policy, and then nothing ever referenced it: zero rows on
-- production, zero references in boards/src. It is dropped here because a dead
-- table named board_templates sitting beside a live grid_layouts is the single
-- most misleading thing the next reader would find. To be clear about what this
-- is NOT: its RLS policies were sound (all four gate on created_by = auth.uid(),
-- which is NULL for anon, so its anon grants were inert). This is tidying, not
-- a security fix.

create table if not exists public.grid_layouts (
  id           uuid primary key default gen_random_uuid(),
  -- null ⇒ a personal template, visible only to its author, in every workspace.
  workspace_id uuid references public.workspaces on delete cascade,
  name         text not null check (char_length(name) between 1 and 80),
  -- { layout, textStyle }. Client-authored, so it is bounded here as well as by
  -- sanitizeLayout on the way in AND on the way out — a stored tree is replayed
  -- through computeCellRects, which recurses without a depth guard.
  body         jsonb not null check (pg_column_size(body) < 16384),
  scope        text not null default 'user' check (scope in ('user', 'workspace')),
  -- Minted by create_grid_layout_link() only. Deliberately NOT in the client's
  -- column-list UPDATE grant below: handing out a link is a decision, not a PATCH.
  share_token  uuid unique,
  -- ON DELETE CASCADE is not optional. Account deletion silently did nothing for
  -- the entire life of this product because four FKs to auth.users were
  -- ON DELETE NO ACTION (diagnosed and fixed in 0264). This is not the fifth.
  created_by   uuid not null references auth.users on delete cascade,
  -- Soft delete: deleting shows an Undo toast, which needs the row to still be
  -- there when Undo is pressed.
  deleted_at   timestamptz,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- The two reads the panel actually makes, both on live rows only.
create index if not exists grid_layouts_mine_idx
  on public.grid_layouts (created_by, updated_at desc)
  where deleted_at is null;
create index if not exists grid_layouts_workspace_idx
  on public.grid_layouts (workspace_id, updated_at desc)
  where deleted_at is null and scope = 'workspace';

alter table public.grid_layouts enable row level security;

-- Visibility: your own (whatever its scope), plus anything shared INTO a
-- workspace you belong to. Soft-deleted rows are invisible here — but note the
-- UPDATE policy below deliberately omits that clause, so an owner can still
-- clear deleted_at to undo. The client holds the id in its Undo closure.
drop policy if exists "grid_layouts select" on public.grid_layouts;
create policy "grid_layouts select"
  on public.grid_layouts for select to authenticated
  using (
    deleted_at is null
    and (
      created_by = auth.uid()
      or (scope = 'workspace' and workspace_id is not null and public.is_workspace_member(workspace_id))
    )
  );

-- You may only create rows as yourself, and may only push one into a workspace
-- you are actually in.
drop policy if exists "grid_layouts insert" on public.grid_layouts;
create policy "grid_layouts insert"
  on public.grid_layouts for insert to authenticated
  with check (
    created_by = auth.uid()
    and (
      scope = 'user'
      or (workspace_id is not null and public.is_workspace_member(workspace_id))
    )
  );

-- Editing follows 0048's stance: a workspace editor may modify a workspace
-- artefact, not just its author. The WITH CHECK repeats the USING predicate and
-- adds a legality guard on the RESULTING row, which is what stops the two ways
-- to launder a template into somewhere it does not belong — flipping a
-- workspace row you do not own to scope='user' (first clause fails), or moving
-- your own row into a workspace you are not in (second clause fails).
drop policy if exists "grid_layouts update" on public.grid_layouts;
create policy "grid_layouts update"
  on public.grid_layouts for update to authenticated
  using (
    created_by = auth.uid()
    or (scope = 'workspace' and workspace_id is not null and public.can_write_workspace(workspace_id))
  )
  with check (
    (
      created_by = auth.uid()
      or (scope = 'workspace' and workspace_id is not null and public.can_write_workspace(workspace_id))
    )
    and (
      scope = 'user'
      or (workspace_id is not null and public.is_workspace_member(workspace_id))
    )
  );

-- No DELETE policy, by design: removal is a soft delete through the UPDATE
-- policy so the Undo toast has something to restore.

-- ── Grant lockdown ───────────────────────────────────────────────────────────
-- Supabase's default privileges are permissive, so a fresh table arrives fully
-- writable by anon and authenticated. Revoke first, then hand back an explicit
-- COLUMN LIST. `share_token` appears in neither list: it exists only as the
-- output of create_grid_layout_link(), and a client that could PATCH it could
-- hand itself somebody else's link. `created_by` is likewise not updatable —
-- RLS checks it, so a writable created_by would let a row change hands.
revoke all on public.grid_layouts from anon, authenticated;
grant select on public.grid_layouts to authenticated;
grant insert (workspace_id, name, body, scope, created_by) on public.grid_layouts to authenticated;
grant update (workspace_id, name, body, scope, deleted_at) on public.grid_layouts to authenticated;

create or replace function public.grid_layouts_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

drop trigger if exists grid_layouts_touch_updated_at on public.grid_layouts;
create trigger grid_layouts_touch_updated_at
  before update on public.grid_layouts
  for each row execute function public.grid_layouts_touch_updated_at();

comment on table public.grid_layouts is
  'Saved grid-card layouts (the Templates library). Layout geometry only — no cell content, no image refs. NOT the same thing as the per-board gridTemplates Y.Map, which is a linked family.';
comment on column public.grid_layouts.body is
  '{ layout, textStyle } — a fraction tree. Bounded by a size check here and sanitized client-side both on save and on apply.';
comment on column public.grid_layouts.share_token is
  'Minted by create_grid_layout_link() only. Not client-writable: it is excluded from the column-list UPDATE grant.';
comment on column public.grid_layouts.scope is
  'user = private to created_by; workspace = visible to every member of workspace_id.';

-- ── Share links ──────────────────────────────────────────────────────────────
-- Three functions, one trust boundary each. Every one is security definer with a
-- pinned search_path, re-checks what RLS would have checked, and is revoked from
-- public, anon AND authenticated before being granted narrowly. All three names
-- are required: 0217 established that `revoke ... from public` does not drop an
-- explicit anon grant, and `revoke ... from anon` does not drop a PUBLIC grant
-- that anon inherits.

-- Owner-only, reuse-before-mint: calling twice returns the same link rather than
-- quietly orphaning the one already pasted into a chat.
create or replace function public.create_grid_layout_link(p_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_row  record;
  v_tok  uuid;
begin
  if auth.uid() is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  select id, created_by, share_token, deleted_at into v_row
  from grid_layouts where id = p_id;
  if v_row.id is null or v_row.deleted_at is not null then
    raise exception 'no such template' using errcode = 'P0002';
  end if;
  -- Sharing is the author's call alone. A workspace editor may EDIT a workspace
  -- template (see the UPDATE policy) but may not publish it outside the
  -- workspace on the author's behalf.
  if v_row.created_by <> auth.uid() then
    raise exception 'only the author can share this template' using errcode = '42501';
  end if;
  if v_row.share_token is not null then
    return v_row.share_token;
  end if;
  v_tok := gen_random_uuid();
  update grid_layouts set share_token = v_tok where id = p_id;
  return v_tok;
end $$;
revoke all on function public.create_grid_layout_link(uuid) from public, anon, authenticated;
grant execute on function public.create_grid_layout_link(uuid) to authenticated;

-- ANON-CALLABLE, deliberately: this is a token-gated reader, the carve-out 0211
-- describes — it authorizes on the argument instead of auth.uid(), because a
-- signed-out visitor opening /t/<token> must be able to see what they were sent.
-- It returns the name and the geometry and NOTHING else: never created_by, never
-- workspace_id, never the row id. A share link reveals a shape, not a person.
-- An unknown, revoked or deleted token returns null rather than raising, so the
-- page renders one honest "this link is not live" state and the caller cannot
-- distinguish "never existed" from "revoked".
create or replace function public.get_grid_layout_by_token(p_token uuid)
returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('name', g.name, 'body', g.body)
  from grid_layouts g
  where g.share_token = p_token and g.deleted_at is null;
$$;
revoke all on function public.get_grid_layout_by_token(uuid) from public, anon, authenticated;
grant execute on function public.get_grid_layout_by_token(uuid) to anon, authenticated;

-- Claiming COPIES. The claimer gets their own private row they can rename and
-- delete; the author keeps theirs, and revoking the link later does not reach
-- into anyone's library and take it back. Idempotent per (token, claimer): a
-- double-click, or opening the link twice, does not litter the library.
create or replace function public.claim_grid_layout_link(p_token uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_src  record;
  v_dup  uuid;
  v_new  uuid;
begin
  if auth.uid() is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  select id, name, body, created_by into v_src
  from grid_layouts
  where share_token = p_token and deleted_at is null;
  if v_src.id is null then
    raise exception 'this link is no longer live' using errcode = 'P0002';
  end if;
  -- Claiming your own link is a no-op that returns the original.
  if v_src.created_by = auth.uid() then
    return v_src.id;
  end if;
  select id into v_dup
  from grid_layouts
  where created_by = auth.uid() and deleted_at is null
    and body = v_src.body and name = v_src.name
  limit 1;
  if v_dup is not null then
    return v_dup;
  end if;
  insert into grid_layouts (workspace_id, name, body, scope, created_by)
  values (null, v_src.name, v_src.body, 'user', auth.uid())
  returning id into v_new;
  return v_new;
end $$;
revoke all on function public.claim_grid_layout_link(uuid) from public, anon, authenticated;
grant execute on function public.claim_grid_layout_link(uuid) to authenticated;

-- ── Retire board_templates (0033 / 0048) ─────────────────────────────────────
-- Verified immediately before writing this: 0 rows on production, 0 references
-- anywhere under boards/src. See the header for why it goes rather than staying.
drop table if exists public.board_templates;
