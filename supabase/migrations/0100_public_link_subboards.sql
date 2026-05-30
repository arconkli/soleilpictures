-- 0098_public_link_subboards.sql — opt-in sub-board access for public links.
--
-- Until now a public share link served exactly ONE board: get_share_bundle
-- returned that board's snapshot + images, and the public viewer had no way
-- to reach sub-boards. This adds a per-link `include_subboards` flag. When
-- set, anonymous viewers can navigate into the shared board's DESCENDANT
-- subtree; the boundary is enforced server-side here (a board is reachable
-- only if it is the link's root or a descendant of it), so client-side
-- navigation can't escape the subtree or cross into other workspaces.

alter table public_share_links
  add column if not exists include_subboards boolean not null default false;

-- ── create_public_link: now takes the sub-boards flag ──────────────────
drop function if exists create_public_link(uuid, timestamptz);
create or replace function create_public_link(
  p_board_id uuid,
  p_expires_at timestamptz default null,
  p_include_subboards boolean default false
) returns uuid
language plpgsql security definer
set search_path = public as $$
declare v_owner uuid; v_token uuid;
begin
  select w.created_by into v_owner
  from boards b join workspaces w on w.id = b.workspace_id
  where b.id = p_board_id;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'only the workspace owner can create public links'
      using errcode = '42501';
  end if;

  insert into public_share_links (board_id, role, created_by, expires_at, include_subboards)
  values (p_board_id, 'viewer', auth.uid(), p_expires_at, coalesce(p_include_subboards, false))
  returning token into v_token;
  return v_token;
end;
$$;
revoke all on function create_public_link(uuid, timestamptz, boolean) from public;
grant execute on function create_public_link(uuid, timestamptz, boolean) to authenticated;

-- ── set_public_link_subboards: flip the flag on an existing link ───────
create or replace function set_public_link_subboards(p_token uuid, p_include boolean)
returns void
language plpgsql security definer
set search_path = public as $$
declare v_owner uuid;
begin
  select w.created_by into v_owner
  from public_share_links l
  join boards b on b.id = l.board_id
  join workspaces w on w.id = b.workspace_id
  where l.token = p_token;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'only the workspace owner can update this link'
      using errcode = '42501';
  end if;
  update public_share_links set include_subboards = coalesce(p_include, false)
  where token = p_token;
end;
$$;
revoke all on function set_public_link_subboards(uuid, boolean) from public;
grant execute on function set_public_link_subboards(uuid, boolean) to authenticated;

-- ── list_public_links: surface the flag (RETURNS TABLE change → recreate) ─
drop function if exists list_public_links(uuid);
create or replace function list_public_links(p_board_id uuid)
returns table(
  token uuid, role text, created_by uuid,
  created_at timestamptz, expires_at timestamptz, revoked_at timestamptz,
  include_subboards boolean
)
language plpgsql security definer
set search_path = public as $$
declare v_owner uuid;
begin
  select w.created_by into v_owner
  from boards b join workspaces w on w.id = b.workspace_id
  where b.id = p_board_id;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'only the workspace owner can list links'
      using errcode = '42501';
  end if;
  return query
  select l.token, l.role, l.created_by, l.created_at, l.expires_at, l.revoked_at, l.include_subboards
  from public_share_links l
  where l.board_id = p_board_id
  order by l.created_at desc;
end;
$$;
revoke all on function list_public_links(uuid) from public;
grant execute on function list_public_links(uuid) to authenticated;

-- ── get_share_bundle: now takes an optional board id within the link ────
-- p_board_id null → the link's root board (legacy behavior). Otherwise the
-- board must be the root or, when the link shares sub-boards, a descendant
-- of it. Returns the target board's snapshot + image keys PLUS the set of
-- navigable boards (id+name) so the viewer can make sub-board cards
-- clickable and label them, plus the root id + include_subboards flag.
drop function if exists get_share_bundle(uuid);
create or replace function get_share_bundle(p_token uuid, p_board_id uuid default null)
returns json
language plpgsql security definer
set search_path = public as $$
declare
  v_root_id uuid;
  v_include boolean;
  v_target uuid;
  v_board record;
  v_snapshot text;
  v_image_keys text[];
  v_nav json;
begin
  -- Resolve the link (active / not revoked / not expired).
  select l.board_id, l.include_subboards into v_root_id, v_include
  from public_share_links l
  where l.token = p_token
    and l.revoked_at is null
    and (l.expires_at is null or l.expires_at > now());
  if v_root_id is null then
    raise exception 'invalid or expired share link' using errcode = 'P0002';
  end if;

  v_target := coalesce(p_board_id, v_root_id);

  -- Authorize a non-root target: the link must share sub-boards AND the
  -- target must be a descendant of the root (walk UP from the target).
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

  select b.id, b.name, b.view, b.cover, b.bg_color into v_board
  from boards b where b.id = v_target;
  if v_board.id is null then
    raise exception 'invalid or expired share link' using errcode = 'P0002';
  end if;

  select doc into v_snapshot from board_state where board_id = v_target;
  select coalesce(array_agg(storage_path), '{}'::text[]) into v_image_keys
  from images where board_id = v_target and storage_path is not null;

  -- Navigable boards reachable via this link. Sub-boards off → just the
  -- root. On → root + all non-deleted descendants (walk DOWN).
  if coalesce(v_include, false) then
    select coalesce(json_agg(json_build_object('id', t.id, 'name', t.name)), '[]'::json)
      into v_nav
    from (
      with recursive sub as (
        select id, name from boards where id = v_root_id
        union all
        select b.id, b.name
        from boards b join sub s on b.parent_board_id = s.id
        where b.deleted_at is null
      )
      select id, name from sub
    ) t;
  else
    select json_build_array(json_build_object('id', b.id, 'name', b.name))
      into v_nav
    from boards b where b.id = v_root_id;
  end if;

  return json_build_object(
    'board', json_build_object(
      'id', v_board.id,
      'name', v_board.name,
      'view', v_board.view,
      'cover', v_board.cover,
      'bg_color', v_board.bg_color
    ),
    'snapshot', v_snapshot,
    'image_keys', v_image_keys,
    'role', 'viewer',
    'root_id', v_root_id,
    'include_subboards', coalesce(v_include, false),
    'nav_boards', v_nav
  );
end;
$$;
revoke all on function get_share_bundle(uuid, uuid) from public;
grant execute on function get_share_bundle(uuid, uuid) to anon, authenticated;
