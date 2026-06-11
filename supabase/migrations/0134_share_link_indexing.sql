-- 0134_share_link_indexing.sql — per-link opt-in search indexing for public
-- share links.
--
-- The Worker noindexes every /share/<token> page unconditionally. Marketing
-- boards shared via public links should be able to rank in search, so links
-- gain an allow_indexing flag (default OFF — ordinary user-shared links stay
-- out of search engines). The Worker reads the flag via get_share_meta and
-- only omits the <meta name="robots" content="noindex"> tag when it is true;
-- the flag reveals nothing else.

alter table public_share_links
  add column if not exists allow_indexing boolean not null default false;

-- ── set_public_link_indexing: flip the flag on an existing link ─────────
-- Clone of set_public_link_subboards (0100) with the column swapped.
create or replace function set_public_link_indexing(p_token uuid, p_allow boolean)
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
  update public_share_links set allow_indexing = coalesce(p_allow, false)
  where token = p_token;
end;
$$;
revoke all on function set_public_link_indexing(uuid, boolean) from public;
grant execute on function set_public_link_indexing(uuid, boolean) to authenticated;

-- ── list_public_links: surface the flag (RETURNS TABLE change → recreate) ─
drop function if exists list_public_links(uuid);
create or replace function list_public_links(p_board_id uuid)
returns table(
  token uuid, role text, created_by uuid,
  created_at timestamptz, expires_at timestamptz, revoked_at timestamptz,
  include_subboards boolean, allow_indexing boolean
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
  select l.token, l.role, l.created_by, l.created_at, l.expires_at, l.revoked_at,
         l.include_subboards, l.allow_indexing
  from public_share_links l
  where l.board_id = p_board_id
  order by l.created_at desc;
end;
$$;
revoke all on function list_public_links(uuid) from public;
grant execute on function list_public_links(uuid) to authenticated;

-- ── get_share_meta: expose allow_indexing for the Worker's robots tag ────
-- IMPORTANT: the token-validation + sub-board-authorization logic below is a
-- verbatim copy of get_share_bundle's (migration 0128). The two must stay in
-- lockstep — anything this function reveals (board name, thumbnail) must be
-- exactly what the bundle would reveal for the same (token, board) pair.
create or replace function get_share_meta(p_token uuid, p_board_id uuid default null)
returns json
language plpgsql security definer
set search_path = public as $$
declare
  v_root_id uuid;
  v_include boolean;
  v_allow boolean;
  v_target uuid;
  v_board record;
begin
  -- Resolve the link (active / not revoked / not expired).
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

  -- Authorize a non-root target: link must share sub-boards AND target must be a
  -- descendant of the root (walk UP from the target).
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

  select b.id, b.name, b.thumb_key, b.thumb_updated_at into v_board
  from boards b where b.id = v_target;
  if v_board.id is null then
    raise exception 'invalid or expired share link' using errcode = 'P0002';
  end if;

  return json_build_object(
    'board_id', v_board.id,
    'root_id', v_root_id,
    'name', v_board.name,
    'thumb_key', v_board.thumb_key,
    'thumb_updated_at', v_board.thumb_updated_at,
    'allow_indexing', coalesce(v_allow, false)
  );
end;
$$;

revoke all on function get_share_meta(uuid, uuid) from public;
grant execute on function get_share_meta(uuid, uuid) to anon, authenticated;
