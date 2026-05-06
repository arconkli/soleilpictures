-- 0018_public_share_links.sql — anonymous, revocable read-only links
-- to a board.
--
-- Owner generates a token via create_public_link → SPA copies the
-- URL https://boards.soleilpictures.com/share/<token>. Anyone with
-- the URL (no account required) can open and view the board snapshot
-- via get_share_bundle (anon-callable, security definer).
--
-- v1 scope: viewer role only. Static snapshot (no realtime). Token
-- can be revoked at any time by the workspace owner.

create table if not exists public_share_links (
  token       uuid primary key default gen_random_uuid(),
  board_id    uuid not null references boards on delete cascade,
  role        text not null check (role = 'viewer'),
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz,
  revoked_at  timestamptz
);
create index if not exists public_share_links_board_idx
  on public_share_links(board_id);

alter table public_share_links enable row level security;

-- Workspace owner manages. No public select on the table itself —
-- anonymous viewers go through get_share_bundle (which validates the
-- token internally, security definer style).
create policy "public_links manage by owner" on public_share_links
  for all using (
    exists (
      select 1 from boards b join workspaces w on w.id = b.workspace_id
      where b.id = board_id and w.created_by = auth.uid()
    )
  ) with check (
    exists (
      select 1 from boards b join workspaces w on w.id = b.workspace_id
      where b.id = board_id and w.created_by = auth.uid()
    )
  );

-- ── RPCs ──────────────────────────────────────────────────────────────

create or replace function create_public_link(
  p_board_id uuid, p_expires_at timestamptz default null
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

  insert into public_share_links (board_id, role, created_by, expires_at)
  values (p_board_id, 'viewer', auth.uid(), p_expires_at)
  returning token into v_token;
  return v_token;
end;
$$;
revoke all on function create_public_link(uuid, timestamptz) from public;
grant execute on function create_public_link(uuid, timestamptz) to authenticated;

create or replace function revoke_public_link(p_token uuid)
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
    raise exception 'only the workspace owner can revoke this link'
      using errcode = '42501';
  end if;
  update public_share_links set revoked_at = now() where token = p_token;
end;
$$;
revoke all on function revoke_public_link(uuid) from public;
grant execute on function revoke_public_link(uuid) to authenticated;

create or replace function list_public_links(p_board_id uuid)
returns table(
  token uuid, role text, created_by uuid,
  created_at timestamptz, expires_at timestamptz, revoked_at timestamptz
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
  select l.token, l.role, l.created_by, l.created_at, l.expires_at, l.revoked_at
  from public_share_links l
  where l.board_id = p_board_id
  order by l.created_at desc;
end;
$$;
revoke all on function list_public_links(uuid) from public;
grant execute on function list_public_links(uuid) to authenticated;

-- Anonymous-callable. Returns the board snapshot + the list of image
-- keys referenced on the board. The worker (party/upload.ts) calls
-- this to validate the token and then presigns the image keys before
-- returning the bundle to the anonymous browser.
create or replace function get_share_bundle(p_token uuid)
returns json
language plpgsql security definer
set search_path = public as $$
declare
  v_board record;
  v_snapshot text;
  v_image_keys text[];
begin
  select b.id, b.name, b.view, b.cover, b.bg_color into v_board
  from public_share_links l
  join boards b on b.id = l.board_id
  where l.token = p_token
    and l.revoked_at is null
    and (l.expires_at is null or l.expires_at > now());
  if v_board.id is null then
    raise exception 'invalid or expired share link' using errcode = 'P0002';
  end if;

  select doc into v_snapshot from board_state where board_id = v_board.id;
  select coalesce(array_agg(storage_path), '{}'::text[]) into v_image_keys
  from images where board_id = v_board.id and storage_path is not null;

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
    'role', 'viewer'
  );
end;
$$;
revoke all on function get_share_bundle(uuid) from public;
grant execute on function get_share_bundle(uuid) to anon, authenticated;
