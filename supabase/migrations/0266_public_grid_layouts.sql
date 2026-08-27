-- 0266_public_grid_layouts.sql
--
-- The public template gallery — /templates.
--
-- 0265 made a grid layout durable and shareable by link. This makes one
-- publishable: a template anybody can browse and use without being sent a link
-- or knowing the author.
--
-- A SIDECAR, NOT COLUMNS ON grid_layouts
--
-- Same reasoning 0136 gives for public_boards: publication is admin-adjacent
-- curation state, orthogonal to the artefact itself, and hanging it on the main
-- table would widen every member's row with fields that mean nothing for the
-- 99% of templates nobody ever publishes. It also keeps the takedown surface in
-- one place instead of scattered across a table clients can write to.
--
-- AUTO-PUBLISH, WITH TAKEDOWN
--
-- Submitting publishes immediately rather than entering a review queue. The
-- moderation surface here is genuinely small: a template carries no images and
-- no cell content, so the only author-controlled strings that ever reach a
-- public page are the name, title and description. An admin can take one down,
-- which is the same one-column flip in reverse.
--
-- The single-predicate design from 0169 is preserved deliberately:
-- published_at IS NOT NULL is the ONLY visibility test, so no reader function
-- anywhere needs a second "…and is it approved" clause that someone could later
-- forget. taken_down_at and review_reason exist alongside it as an audit trail,
-- never as part of the predicate.

create table if not exists public.public_grid_layouts (
  layout_id     uuid primary key references public.grid_layouts on delete cascade,
  slug          text unique not null,
  title         text not null check (char_length(title) between 1 and 120),
  description   text check (description is null or char_length(description) <= 500),
  submitted_by  uuid references auth.users on delete set null,
  -- THE visibility column. now() on submit, null on takedown.
  published_at  timestamptz,
  -- Audit only. Never read by a reader function.
  taken_down_at timestamptz,
  review_reason text,
  use_count     integer not null default 0,
  created_at    timestamptz default now()
);

-- The gallery's only read pattern: what is live, newest and most-used first.
create index if not exists public_grid_layouts_live_idx
  on public.public_grid_layouts (published_at desc, use_count desc)
  where published_at is not null;

alter table public.public_grid_layouts enable row level security;

-- Anon and authenticated NEVER touch this table directly — every path in or out
-- is a SECURITY DEFINER function below. The only policy is for admins reading it
-- through the dashboard/admin client.
drop policy if exists "public_grid_layouts admin" on public.public_grid_layouts;
create policy "public_grid_layouts admin"
  on public.public_grid_layouts for all
  using (public.is_admin());

revoke all on public.public_grid_layouts from anon, authenticated;

comment on table public.public_grid_layouts is
  'Publication state for grid_layouts shown at /templates. published_at IS NOT NULL is the only visibility test; taken_down_at and review_reason are audit trail.';

-- ── the one gate ─────────────────────────────────────────────────────────────
-- Every public read resolves a slug through here, so "is it published, and is
-- the underlying template still alive" is written down in exactly ONE place
-- (the 0136 pattern). Underscore-prefixed and granted to nobody: it is an
-- implementation detail of the functions below, not an API.
create or replace function public._resolve_published_grid_layout(p_slug text)
returns uuid
language sql stable security definer set search_path = public as $$
  select p.layout_id
  from public_grid_layouts p
  join grid_layouts g on g.id = p.layout_id
  where p.slug = p_slug
    and p.published_at is not null
    and g.deleted_at is null;
$$;
revoke all on function public._resolve_published_grid_layout(text) from public, anon, authenticated;

-- ── submit ───────────────────────────────────────────────────────────────────
-- Author-only, mirroring create_grid_layout_link in 0265: publishing is the
-- author's call, not something a workspace editor does on their behalf.
create or replace function public.submit_grid_layout_to_public(
  p_id uuid, p_title text default null, p_description text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_row   record;
  v_cells int;
  v_base  text;
  v_slug  text;
  v_n     int := 0;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  select id, name, body, created_by, deleted_at into v_row
  from grid_layouts where id = p_id;
  if v_row.id is null or v_row.deleted_at is not null then
    raise exception 'no such template' using errcode = 'P0002';
  end if;
  if v_row.created_by <> v_uid then
    raise exception 'only the author can publish this template' using errcode = '42501';
  end if;

  -- Quality gate, the analogue of "a board needs 3 images": a one-cell grid is
  -- not a layout, it is an empty box, and a gallery full of them is worthless.
  --
  -- STRICT mode is load-bearing, not decoration. In lax mode (the default) a
  -- jsonpath filter auto-unwraps arrays, so every leaf matches twice — once as
  -- itself and once via the `children` array holding it — and the count comes
  -- back doubled. Measured: a 3-cell storyboard counted 6, which would have let
  -- a genuine 1-cell template through the >= 2 gate.
  select coalesce(jsonb_array_length(
           jsonb_path_query_array(v_row.body -> 'layout', 'strict $.**?(@.type == "leaf")')), 0)
    into v_cells;
  if v_cells < 2 then
    raise exception 'A template needs at least 2 cells to be published'
      using errcode = '22023';
  end if;

  v_base := lower(regexp_replace(
    regexp_replace(coalesce(nullif(trim(coalesce(p_title, '')), ''), v_row.name, 'template'),
                   '[^a-zA-Z0-9]+', '-', 'g'),
    '(^-+|-+$)', '', 'g'));
  v_base := left(coalesce(nullif(v_base, ''), 'template'), 70);
  v_slug := v_base;
  while exists (select 1 from public_grid_layouts p where p.slug = v_slug and p.layout_id <> p_id) loop
    v_n := v_n + 1;
    v_slug := left(v_base, 70) || '-' || v_n::text;
  end loop;

  insert into public_grid_layouts as pg
    (layout_id, slug, title, description, submitted_by, published_at, taken_down_at, review_reason)
  values
    (p_id, v_slug,
     left(coalesce(nullif(trim(coalesce(p_title, '')), ''), v_row.name), 120),
     nullif(trim(coalesce(p_description, '')), ''),
     v_uid, now(), null, null)
  on conflict (layout_id) do update set
    slug          = coalesce(excluded.slug, pg.slug),
    title         = excluded.title,
    description   = excluded.description,
    -- Re-submitting a taken-down template re-publishes it. That is deliberate
    -- and survivable: an admin taking it down again is one click, and the
    -- alternative (a silent no-op) reads as the button being broken.
    published_at  = now(),
    taken_down_at = null,
    review_reason = null;

  return jsonb_build_object('status', 'published', 'slug', v_slug);
end $$;
revoke all on function public.submit_grid_layout_to_public(uuid, text, text) from public, anon, authenticated;
grant execute on function public.submit_grid_layout_to_public(uuid, text, text) to authenticated;

-- ── unpublish (the author's own) ──────────────────────────────────────────────
create or replace function public.unpublish_grid_layout(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if not exists (select 1 from grid_layouts where id = p_id and created_by = auth.uid()) then
    raise exception 'only the author can unpublish this template' using errcode = '42501';
  end if;
  update public_grid_layouts set published_at = null where layout_id = p_id;
end $$;
revoke all on function public.unpublish_grid_layout(uuid) from public, anon, authenticated;
grant execute on function public.unpublish_grid_layout(uuid) to authenticated;

-- ── public reads (anon) ──────────────────────────────────────────────────────
-- The gallery index. Returns the geometry too, because the tile IS the geometry
-- — rendering a preview needs no second round-trip and no image pipeline.
-- Never returns submitted_by: a template is a shape, not a person.
create or replace function public.list_public_grid_layouts(p_limit int default 120)
returns table (slug text, title text, description text, body jsonb, use_count int, published_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.slug, p.title, p.description, g.body, p.use_count, p.published_at
  from public_grid_layouts p
  join grid_layouts g on g.id = p.layout_id
  where p.published_at is not null and g.deleted_at is null
  order by p.use_count desc, p.published_at desc
  limit greatest(1, least(coalesce(p_limit, 120), 500));
$$;
revoke all on function public.list_public_grid_layouts(int) from public, anon, authenticated;
grant execute on function public.list_public_grid_layouts(int) to anon, authenticated;

create or replace function public.get_public_grid_layout(p_slug text)
returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'slug', p.slug, 'title', p.title, 'description', p.description,
    'body', g.body, 'use_count', p.use_count)
  from public_grid_layouts p
  join grid_layouts g on g.id = p.layout_id
  where p.layout_id = public._resolve_published_grid_layout(p_slug);
$$;
revoke all on function public.get_public_grid_layout(text) from public, anon, authenticated;
grant execute on function public.get_public_grid_layout(text) to anon, authenticated;

-- ── use (copies into your library) ───────────────────────────────────────────
-- Same COPY semantics as claim_grid_layout_link: taking a template down later
-- must not reach into anybody's library. Idempotent per (template, user).
create or replace function public.use_public_grid_layout(p_slug text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id  uuid;
  v_src record;
  v_dup uuid;
  v_new uuid;
begin
  if auth.uid() is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  v_id := public._resolve_published_grid_layout(p_slug);
  if v_id is null then
    raise exception 'no such template' using errcode = 'P0002';
  end if;
  select id, name, body, created_by into v_src from grid_layouts where id = v_id;
  if v_src.created_by = auth.uid() then
    return v_src.id;
  end if;
  select id into v_dup from grid_layouts
  where created_by = auth.uid() and deleted_at is null
    and body = v_src.body and name = v_src.name
  limit 1;
  if v_dup is not null then
    return v_dup;
  end if;
  insert into grid_layouts (workspace_id, name, body, scope, created_by)
  values (null, v_src.name, v_src.body, 'user', auth.uid())
  returning id into v_new;
  update public_grid_layouts set use_count = use_count + 1 where layout_id = v_id;
  return v_new;
end $$;
revoke all on function public.use_public_grid_layout(text) from public, anon, authenticated;
grant execute on function public.use_public_grid_layout(text) to authenticated;

-- ── admin ────────────────────────────────────────────────────────────────────
create or replace function public.admin_list_grid_layouts(p_status text default 'published')
returns table (
  layout_id uuid, slug text, title text, description text, name text,
  body jsonb, use_count int, published_at timestamptz,
  taken_down_at timestamptz, review_reason text, created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return query
    select p.layout_id, p.slug, p.title, p.description, g.name, g.body, p.use_count,
           p.published_at, p.taken_down_at, p.review_reason, p.created_at
    from public_grid_layouts p
    join grid_layouts g on g.id = p.layout_id
    where p_status is null
       or (p_status = 'published' and p.published_at is not null)
       or (p_status = 'taken_down' and p.published_at is null)
    order by coalesce(p.published_at, p.created_at) desc;
end $$;
revoke all on function public.admin_list_grid_layouts(text) from public, anon, authenticated;
grant execute on function public.admin_list_grid_layouts(text) to authenticated;

create or replace function public.admin_take_down_grid_layout(p_layout_id uuid, p_reason text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  update public_grid_layouts
     set published_at = null, taken_down_at = now(),
         review_reason = nullif(trim(coalesce(p_reason, '')), '')
   where layout_id = p_layout_id;
end $$;
revoke all on function public.admin_take_down_grid_layout(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_take_down_grid_layout(uuid, text) to authenticated;

-- Restoring something taken down in error. Separate from the author's
-- re-submit path so an admin action is always an admin action in the audit.
create or replace function public.admin_restore_grid_layout(p_layout_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  update public_grid_layouts
     set published_at = now(), taken_down_at = null, review_reason = null
   where layout_id = p_layout_id;
end $$;
revoke all on function public.admin_restore_grid_layout(uuid) from public, anon, authenticated;
grant execute on function public.admin_restore_grid_layout(uuid) to authenticated;
