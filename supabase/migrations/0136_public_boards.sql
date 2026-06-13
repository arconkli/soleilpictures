-- 0136_public_boards.sql — admin-curated, slug-based, SEO-discoverable public boards.
--
-- Today the only public surface is the owner's tokened /share/<uuid> link
-- (noindex by default; per-link allow_indexing, 0134). Tokened UUID URLs rank
-- terribly. This adds a SEPARATE, app-super-admin-only curation layer so the
-- Soleil team can publish chosen boards at a clean keyword slug (/c/backrooms-
-- fanart), with dedicated SEO fields, and have them indexed + sitemapped + rank.
--
-- Layers:
--   * public_boards (sidecar table) — admin-only RLS. board_id -> slug + SEO copy.
--   * _resolve_published_board(slug) — the SINGLE auth gate every anon RPC uses:
--       published_at IS NOT NULL AND boards.deleted_at IS NULL.
--     ⚠ The share RPCs (0128 get_share_bundle / 0135 get_share_meta) do NOT check
--     boards.deleted_at — a soft delete (0050) only sets deleted_at; ON DELETE
--     CASCADE fires on HARD delete only. So the public clones MUST gate it here,
--     never assume the clone inherits it.
--   * anon read RPCs: get_public_board_meta / _content / _bundle, list_public_boards.
--   * admin write RPCs: admin_set_public_board / admin_unpublish_board /
--     admin_list_public_boards — every one gated on is_admin() (0073), server-side.
--   * get_share_meta gains public_slug so the Worker can canonicalize a legacy
--     /share/<token> for the same board onto its /c/<slug>.
--
-- get_public_board_bundle is a LOCKSTEP clone of get_share_bundle (0128): any
-- future change to the bundle shape/authorization must touch BOTH.

-- ── 1. Sidecar table ──────────────────────────────────────────────────────
-- Sidecar (not columns on boards): boards RLS is is_workspace_member; admin
-- curation is orthogonal + admin-only and shouldn't widen every member's row.
create table if not exists public.public_boards (
  board_id        uuid primary key references public.boards(id) on delete cascade,
  slug            text not null,
  seo_title       text,
  seo_description text,
  seo_body        text,
  target_keyword  text,
  og_image_key    text,
  priority        int  not null default 0,
  published_at    timestamptz,          -- NULL = draft; NOT NULL = live
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint public_boards_slug_format
    check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and length(slug) between 1 and 80),
  constraint public_boards_slug_reserved
    check (slug not in ('c','explore','share','pricing','legal','api','assets','admin',
      'robots','sitemap','app','auth','login','signup','board','boards','favicon','_headers'))
);
create unique index if not exists public_boards_slug_uidx on public.public_boards (slug);
create index if not exists public_boards_published_idx
  on public.public_boards (published_at) where published_at is not null;

alter table public.public_boards enable row level security;
drop policy if exists "public_boards admin all" on public.public_boards;
create policy "public_boards admin all" on public.public_boards
  for all using (public.is_admin()) with check (public.is_admin());
-- anon/authenticated never touch the table directly; only via the SECURITY
-- DEFINER RPCs below (which bypass RLS as the function owner).

-- ── 2. The single auth gate ───────────────────────────────────────────────
create or replace function public._resolve_published_board(p_slug text)
returns uuid language sql stable security definer set search_path = public as $$
  select pb.board_id
  from public_boards pb
  join boards b on b.id = pb.board_id
  where pb.slug = p_slug
    and pb.published_at is not null
    and b.deleted_at is null   -- ⚠ explicit: the share RPCs do NOT check this
$$;
revoke all on function public._resolve_published_board(text) from public;

-- ── 3. Anon read: lightweight meta (Worker, every /c/<slug>) ───────────────
create or replace function public.get_public_board_meta(p_slug text)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_target uuid;
  v_board  record;
  v_pb     record;
begin
  v_target := _resolve_published_board(p_slug);
  if v_target is null then
    raise exception 'no such public board' using errcode = 'P0002';
  end if;
  select b.name, b.thumb_key, b.thumb_updated_at, b.thumb_version, b.card_count
    into v_board from boards b where b.id = v_target;
  select pb.slug, pb.seo_title, pb.seo_description, pb.seo_body,
         pb.target_keyword, pb.og_image_key
    into v_pb from public_boards pb where pb.board_id = v_target;
  return json_build_object(
    'board_id',        v_target,
    'slug',            v_pb.slug,
    'name',            v_board.name,
    'seo_title',       v_pb.seo_title,
    'seo_description', v_pb.seo_description,
    'seo_body',        v_pb.seo_body,
    'target_keyword',  v_pb.target_keyword,
    'og_image_key',    v_pb.og_image_key,
    'thumb_key',       v_board.thumb_key,
    'thumb_updated_at',v_board.thumb_updated_at,
    'thumb_version',   v_board.thumb_version,
    'card_count',      v_board.card_count
  );
end;
$$;
revoke all on function public.get_public_board_meta(text) from public;
grant execute on function public.get_public_board_meta(text) to anon, authenticated;

-- ── 4. Anon read: crawlable content (Worker, /c body + JSON-LD) ────────────
-- Scoped to the published board id + its NON-DELETED descendants (never
-- workspace_id). Whitelists kinds that carry indexable text/media. Stable
-- ordering (updated_at desc, card_id) so the Worker's /api/public-img ?i=N
-- index matches the rendered <img> list 1:1.
create or replace function public.get_public_board_content(p_slug text, p_limit int default 60)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_target uuid;
  v_cards  json;
  v_subs   json;
  v_total  int;
  v_lim    int;
begin
  v_target := _resolve_published_board(p_slug);
  if v_target is null then
    raise exception 'no such public board' using errcode = 'P0002';
  end if;
  v_lim := greatest(1, least(coalesce(p_limit, 60), 200));

  with recursive sub as (
    select id from boards where id = v_target and deleted_at is null
    union all
    select b.id from boards b join sub s on b.parent_board_id = s.id
    where b.deleted_at is null
  ),
  picked as (
    select ci.card_id, ci.kind, ci.title, ci.body, ci.meta, ci.updated_at
    from card_index ci
    where ci.board_id in (select id from sub)
      and ci.kind in ('image','note','doc','link')
    order by ci.updated_at desc, ci.card_id
    limit v_lim
  )
  select coalesce(json_agg(json_build_object(
           'card_id', p.card_id,
           'kind',    p.kind,
           'title',   nullif(p.title, ''),
           'body',    nullif(p.body, ''),
           'href',    case when p.kind = 'link' then p.meta->>'url' else null end,
           'media',   case
             when p.kind = 'image' and (p.meta->>'src') like 'r2:%'
             then json_build_object(
                    'alt',         p.meta->>'alt',
                    'src_key',     p.meta->>'src',
                    'preview_key', img.preview_path,
                    'blur',        img.blur_hash
                  )
             else null end
         ) order by p.updated_at desc, p.card_id), '[]'::json)
    into v_cards
  from picked p
  left join images img
    on img.storage_path = regexp_replace(p.meta->>'src', '^r2:', '')
   and img.deleted_at is null;

  -- direct non-deleted children (context; rendered as plain text, not links)
  select coalesce(json_agg(json_build_object('id', b.id, 'name', b.name)
           order by b.name), '[]'::json)
    into v_subs
  from boards b where b.parent_board_id = v_target and b.deleted_at is null;

  select count(*) into v_total
  from card_index ci
  where ci.board_id = v_target and ci.kind in ('image','note','doc','link');

  return json_build_object(
    'board_id',  v_target,
    'cards',     v_cards,
    'subboards', v_subs,
    'truncated', (v_total > v_lim)
  );
end;
$$;
revoke all on function public.get_public_board_content(text, int) from public;
grant execute on function public.get_public_board_content(text, int) to anon, authenticated;

-- ── 5. Anon read: published board list (Worker, /explore + sitemap) ────────
create or replace function public.list_public_boards()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object(
    'slug',             pb.slug,
    'seo_title',        coalesce(pb.seo_title, b.name),
    'seo_description',  pb.seo_description,
    'target_keyword',   pb.target_keyword,
    'priority',         pb.priority,
    'published_at',     pb.published_at,
    'thumb_key',        b.thumb_key,
    'thumb_updated_at', b.thumb_updated_at,
    'thumb_version',    b.thumb_version,
    'card_count',       b.card_count,
    'updated_at',       greatest(pb.updated_at, b.updated_at)
  ) order by pb.priority desc, pb.published_at desc), '[]'::json)
  from public_boards pb
  join boards b on b.id = pb.board_id
  where pb.published_at is not null and b.deleted_at is null;
$$;
revoke all on function public.list_public_boards() from public;
grant execute on function public.list_public_boards() to anon, authenticated;

-- ── 6. Anon read: full bundle (party /public-bundle, live canvas) ──────────
-- LOCKSTEP clone of get_share_bundle (0128). Differences: resolves the root via
-- slug (published+not-deleted gate) instead of token; treats the published board
-- like include_subboards=true (full subtree navigable); gates deleted_at on the
-- resolved target (0128 does NOT). Key-gathering predicate is board-scoped
-- (board_id = target OR target = any(referenced_in_board_ids)) — identical to
-- 0128, never workspace-scoped.
create or replace function public.get_public_board_bundle(p_slug text, p_board_id uuid default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_root_id   uuid;
  v_target    uuid;
  v_board     record;
  v_snapshot  text;
  v_image_keys text[];
  v_image_meta json;
  v_nav       json;
begin
  v_root_id := _resolve_published_board(p_slug);
  if v_root_id is null then
    raise exception 'no such public board' using errcode = 'P0002';
  end if;

  v_target := coalesce(p_board_id, v_root_id);

  -- non-root target must be a descendant of the published root (walk UP).
  if v_target <> v_root_id then
    if not exists (
      with recursive chain as (
        select id, parent_board_id from boards where id = v_target
        union all
        select b.id, b.parent_board_id
        from boards b join chain c on b.id = c.parent_board_id
      )
      select 1 from chain where id = v_root_id
    ) then
      raise exception 'board is not part of this public board' using errcode = 'P0002';
    end if;
  end if;

  select b.id, b.name, b.view, b.cover, b.bg_color into v_board
  from boards b where b.id = v_target and b.deleted_at is null;   -- deleted gate
  if v_board.id is null then
    raise exception 'no such public board' using errcode = 'P0002';
  end if;

  select doc into v_snapshot from board_state where board_id = v_target;

  select coalesce(array_agg(distinct k), '{}'::text[]) into v_image_keys
  from (
    select storage_path as k from images
     where storage_path is not null
       and (board_id = v_target or v_target = any(referenced_in_board_ids))
    union
    select preview_path as k from images
     where preview_path is not null
       and (board_id = v_target or v_target = any(referenced_in_board_ids))
  ) s;

  select coalesce(
           jsonb_object_agg(storage_path, jsonb_build_object('blur', blur_hash, 'preview', preview_path)),
           '{}'::jsonb
         )::json
    into v_image_meta
  from images
  where storage_path is not null
    and (board_id = v_target or v_target = any(referenced_in_board_ids))
    and (blur_hash is not null or preview_path is not null);

  -- navigable boards: the full non-deleted subtree from the published root.
  select coalesce(json_agg(json_build_object('id', t.id, 'name', t.name)), '[]'::json)
    into v_nav
  from (
    with recursive subt as (
      select id, name from boards where id = v_root_id and deleted_at is null
      union all
      select b.id, b.name from boards b join subt s on b.parent_board_id = s.id
      where b.deleted_at is null
    )
    select id, name from subt
  ) t;

  return json_build_object(
    'board', json_build_object(
      'id', v_board.id, 'name', v_board.name, 'view', v_board.view,
      'cover', v_board.cover, 'bg_color', v_board.bg_color
    ),
    'snapshot',          v_snapshot,
    'image_keys',        v_image_keys,
    'image_meta',        v_image_meta,
    'role',              'viewer',
    'root_id',           v_root_id,
    'include_subboards', true,
    'nav_boards',        v_nav
  );
end;
$$;
revoke all on function public.get_public_board_bundle(text, uuid) from public;
grant execute on function public.get_public_board_bundle(text, uuid) to anon, authenticated;

-- ── 7. Admin write RPCs (is_admin()-gated, server-side) ────────────────────
create or replace function public.admin_set_public_board(
  p_slug            text,
  p_board_id        uuid    default null,
  p_share_token     uuid    default null,
  p_seo_title       text    default null,
  p_seo_description text    default null,
  p_seo_body        text    default null,
  p_target_keyword  text    default null,
  p_og_image_key    text    default null,
  p_priority        int     default 0,
  p_published       boolean default false
) returns json language plpgsql security definer set search_path = public as $$
declare
  v_board_id uuid;
  v_slug     text;
begin
  if not is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  v_board_id := p_board_id;
  if v_board_id is null and p_share_token is not null then
    select board_id into v_board_id from public_share_links where token = p_share_token;
  end if;
  if v_board_id is null then
    raise exception 'board not found — pass a board id or a /share/<token> link'
      using errcode = 'P0002';
  end if;
  if not exists (select 1 from boards where id = v_board_id and deleted_at is null) then
    raise exception 'board not found or deleted' using errcode = 'P0002';
  end if;

  v_slug := lower(btrim(coalesce(p_slug, '')));
  if v_slug = '' then
    raise exception 'slug is required' using errcode = '22023';
  end if;

  begin
    insert into public_boards as pb (
      board_id, slug, seo_title, seo_description, seo_body, target_keyword,
      og_image_key, priority, published_at, created_by, updated_at
    ) values (
      v_board_id, v_slug, p_seo_title, p_seo_description, p_seo_body, p_target_keyword,
      p_og_image_key, coalesce(p_priority, 0),
      case when p_published then now() else null end,
      auth.uid(), now()
    )
    on conflict (board_id) do update set
      slug            = excluded.slug,
      seo_title       = excluded.seo_title,
      seo_description = excluded.seo_description,
      seo_body        = excluded.seo_body,
      target_keyword  = excluded.target_keyword,
      og_image_key    = excluded.og_image_key,
      priority        = excluded.priority,
      published_at    = case when p_published then coalesce(pb.published_at, now()) else null end,
      updated_at      = now();
  exception
    when unique_violation then
      raise exception 'that slug is already taken — choose another' using errcode = '23505';
    when check_violation then
      raise exception 'invalid slug — use lowercase letters, numbers and single hyphens (and not a reserved word)'
        using errcode = '23514';
  end;

  return json_build_object('board_id', v_board_id, 'slug', v_slug, 'published', p_published);
end;
$$;
revoke all on function public.admin_set_public_board(text, uuid, uuid, text, text, text, text, text, int, boolean) from public;
grant execute on function public.admin_set_public_board(text, uuid, uuid, text, text, text, text, text, int, boolean) to authenticated;

create or replace function public.admin_unpublish_board(p_board_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  update public_boards set published_at = null, updated_at = now() where board_id = p_board_id;
end;
$$;
revoke all on function public.admin_unpublish_board(uuid) from public;
grant execute on function public.admin_unpublish_board(uuid) to authenticated;

create or replace function public.admin_list_public_boards()
returns json language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return (
    select coalesce(json_agg(json_build_object(
      'board_id',        pb.board_id,
      'board_name',      b.name,
      'slug',            pb.slug,
      'seo_title',       pb.seo_title,
      'seo_description', pb.seo_description,
      'seo_body',        pb.seo_body,
      'target_keyword',  pb.target_keyword,
      'og_image_key',    pb.og_image_key,
      'priority',        pb.priority,
      'published_at',     pb.published_at,
      'is_published',    pb.published_at is not null,
      'deleted',         b.deleted_at is not null,
      'card_count',      b.card_count,
      'thumb_key',       b.thumb_key,
      'updated_at',      pb.updated_at
    ) order by pb.updated_at desc), '[]'::json)
    from public_boards pb
    join boards b on b.id = pb.board_id
  );
end;
$$;
revoke all on function public.admin_list_public_boards() from public;
grant execute on function public.admin_list_public_boards() to authenticated;

-- ── 8. Extend get_share_meta with public_slug (canonical consolidation) ────
-- Verbatim copy of the 0135 body (incl. its intentional non-check of deleted_at
-- so live share behavior is unchanged) + a lookup of the published slug for the
-- resolved board, so the Worker can canonicalize /share/<token> -> /c/<slug>.
create or replace function get_share_meta(p_token uuid, p_board_id uuid default null)
returns json
language plpgsql security definer
set search_path = public as $$
declare
  v_root_id uuid;
  v_include boolean;
  v_allow   boolean;
  v_target  uuid;
  v_board   record;
  v_slug    text;
begin
  select l.board_id, l.include_subboards, l.allow_indexing
    into v_root_id, v_include, v_allow
  from public_share_links l
  where l.token = p_token
    and l.revoked_at is null
    and (l.expires_at is null or l.expires_at > now());
  if v_root_id is null then
    raise exception 'invalid or expired share link' using errcode = 'P0002';
  end if;

  v_target := coalesce(p_board_id, v_root_id);

  if v_target <> v_root_id then
    if not coalesce(v_include, false) then
      raise exception 'sub-boards are not shared by this link' using errcode = 'P0002';
    end if;
    if not exists (
      with recursive chain as (
        select id, parent_board_id from boards where id = v_target
        union all
        select b.id, b.parent_board_id
        from boards b join chain c on b.id = c.parent_board_id
      )
      select 1 from chain where id = v_root_id
    ) then
      raise exception 'board is not part of this shared link' using errcode = 'P0002';
    end if;
  end if;

  select b.id, b.name, b.thumb_key, b.thumb_updated_at, b.thumb_version into v_board
  from boards b where b.id = v_target;
  if v_board.id is null then
    raise exception 'invalid or expired share link' using errcode = 'P0002';
  end if;

  -- Canonical slug for this board, if it's a published public board.
  select pb.slug into v_slug
  from public_boards pb
  where pb.board_id = v_target and pb.published_at is not null;

  return json_build_object(
    'board_id', v_board.id,
    'root_id', v_root_id,
    'name', v_board.name,
    'thumb_key', v_board.thumb_key,
    'thumb_updated_at', v_board.thumb_updated_at,
    'thumb_version', v_board.thumb_version,
    'allow_indexing', coalesce(v_allow, false),
    'public_slug', v_slug
  );
end;
$$;
revoke all on function get_share_meta(uuid, uuid) from public;
grant execute on function get_share_meta(uuid, uuid) to anon, authenticated;

-- ── 9. Tighten grants ──────────────────────────────────────────────────────
-- Supabase grants EXECUTE to anon/authenticated by default-privilege (not via
-- PUBLIC), so the `revoke ... from public` above does not remove it. Explicitly
-- lock down the internal resolver (clients never call it directly; the SECURITY
-- DEFINER RPCs above call it in owner context) and bar anon from the admin RPCs
-- (is_admin() already blocks them, but defense-in-depth).
revoke execute on function public._resolve_published_board(text) from anon, authenticated;
revoke execute on function public.admin_set_public_board(text, uuid, uuid, text, text, text, text, text, int, boolean) from anon;
revoke execute on function public.admin_unpublish_board(uuid) from anon;
revoke execute on function public.admin_list_public_boards() from anon;
