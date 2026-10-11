-- 0405 — Undo after "Remove access" puts the share back as it was (audit
-- SHARE-5), and a sub-cluster's Share panel can say who has access through a
-- parent (audit SHARE-14).
--
-- SHARE-5. The toast's Undo called share_board again. The row was already
-- gone, so it took the new-share path: it spent an invite from the daily
-- budget and inserted a share_notifications row, which emails "X shared Y
-- with you" to the person you meant to leave alone. Once the budget was spent
-- the Undo failed with "invite limit reached", and the removal could not be
-- reversed. It also reset invited_by to whoever clicked Undo.
--
-- A removed share is now remembered (board_share_removals, written by an
-- AFTER DELETE trigger so every path that removes access is covered), and
-- restore_board_share puts back exactly that row — role, inviter, link,
-- original date — with no budget and no email. Only the person who removed it
-- may put it back, only for 15 minutes, and only while they can still manage
-- the cluster's access; anything else is a new share and goes through
-- share_board.
--
-- SHARE-14. list_board_shares returns direct shares only, while access
-- cascades to sub-clusters (my_readable_board_ids, can_write_board walk the
-- parent chain). list_inherited_board_shares returns the ancestors' shares,
-- nearest first, each naming the cluster it comes from, for people who have
-- no share of their own on this one. Same gate as list_board_shares (0391).
-- A sibling RPC rather than a new column, so the shipped client is untouched.

begin;

create table if not exists public.board_share_removals (
  board_id       uuid        not null,
  user_id        uuid        not null,
  role           text        not null,
  invited_by     uuid,
  via_link_token uuid,
  shared_at      timestamptz not null,
  removed_by     uuid,
  removed_at     timestamptz not null default now(),
  primary key (board_id, user_id)
);
-- Read and written only by the definer functions below.
alter table public.board_share_removals enable row level security;
revoke all on table public.board_share_removals from public, anon, authenticated;

create or replace function public._tg_board_share_removed()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- A share removed because its cluster or its person is being deleted has
  -- nothing to come back to.
  if not exists (select 1 from public.boards b where b.id = old.board_id)
     or not exists (select 1 from auth.users u where u.id = old.user_id) then
    return old;
  end if;
  insert into public.board_share_removals
         (board_id, user_id, role, invited_by, via_link_token, shared_at, removed_by, removed_at)
  values (old.board_id, old.user_id, old.role, old.invited_by, old.via_link_token, old.created_at, auth.uid(), now())
  on conflict (board_id, user_id) do update
     set role = excluded.role,
         invited_by = excluded.invited_by,
         via_link_token = excluded.via_link_token,
         shared_at = excluded.shared_at,
         removed_by = excluded.removed_by,
         removed_at = excluded.removed_at;
  return old;
end $function$;

revoke execute on function public._tg_board_share_removed() from public, anon, authenticated;

create or replace trigger board_shares_remember_removal
  after delete on public.board_shares
  for each row execute function public._tg_board_share_removed();

create or replace function public.restore_board_share(p_board_id uuid, p_user_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r            public.board_share_removals%rowtype;
  v_is_manager boolean;
begin
  if not public._actor_active() then
    raise exception 'this account is suspended' using errcode = '42501';
  end if;

  select * into r from public.board_share_removals s
   where s.board_id = p_board_id and s.user_id = p_user_id;
  -- An undo, not a share: the remover, while the undo is on screen.
  if not found or r.removed_by is distinct from auth.uid()
     or r.removed_at < now() - interval '15 minutes' then
    raise exception 'that access can no longer be put back' using errcode = '42501';
  end if;

  select public.can_manage_workspace(b.workspace_id) into v_is_manager
    from public.boards b where b.id = p_board_id and b.deleted_at is null;
  if not found then
    raise exception 'board % not found', p_board_id using errcode = '42704';
  end if;
  if not coalesce(v_is_manager, false) and not public.can_write_board(p_board_id) then
    raise exception 'you do not have permission to manage this board''s access'
      using errcode = '42501';
  end if;

  -- No _invite_budget_take and no share_notifications row: nothing is sent.
  insert into public.board_shares (board_id, user_id, role, invited_by, created_at, via_link_token)
  values (r.board_id, r.user_id, r.role,
          (select u.id from auth.users u where u.id = r.invited_by),
          r.shared_at,
          (select l.token from public.public_share_links l where l.token = r.via_link_token))
  on conflict (board_id, user_id) do nothing;
  return 'restored';
end $function$;

revoke execute on function public.restore_board_share(uuid, uuid) from public, anon;

create or replace function public.list_inherited_board_shares(p_board_id uuid)
returns table(user_id uuid, email text, role text, via_board_id uuid, via_board_name text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_is_owner boolean;
begin
  select public.can_manage_workspace(b.workspace_id) into v_is_owner
  from boards b where b.id = p_board_id;
  if not coalesce(v_is_owner, false) and not can_write_board(p_board_id) then
    raise exception 'you do not have permission to view this board''s access'
      using errcode = '42501';
  end if;

  return query
  with recursive up(id, depth) as (
    select b.parent_board_id, 1
      from boards b where b.id = p_board_id and b.parent_board_id is not null
    union all
    select b.parent_board_id, up.depth + 1
      from boards b join up on b.id = up.id
     where b.parent_board_id is not null and up.depth < 64
  )
  select distinct on (s.user_id) s.user_id, u.email::text, s.role, s.board_id, pb.name
    from up
    join board_shares s on s.board_id = up.id
    join boards pb      on pb.id = s.board_id
    join auth.users u   on u.id = s.user_id
   where not exists (select 1 from board_shares d
                      where d.board_id = p_board_id and d.user_id = s.user_id)
   order by s.user_id, up.depth;
end $function$;

revoke execute on function public.list_inherited_board_shares(uuid) from public, anon;

do $$
declare f text;
begin
  foreach f in array array[
    'public.restore_board_share(uuid,uuid)',
    'public.list_inherited_board_shares(uuid)'
  ] loop
    if has_function_privilege('anon', f, 'execute')
       or not has_function_privilege('authenticated', f, 'execute') then
      raise exception '0405: grants are wrong on %', f;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'public._tg_board_share_removed()', 'execute')
     or has_function_privilege('anon', 'public._tg_board_share_removed()', 'execute') then
    raise exception '0405: grants are wrong on _tg_board_share_removed';
  end if;
  if has_table_privilege('authenticated', 'public.board_share_removals', 'select')
     or has_table_privilege('anon', 'public.board_share_removals', 'select')
     or has_table_privilege('authenticated', 'public.board_share_removals', 'insert') then
    raise exception '0405: board_share_removals is reachable by a client';
  end if;
end $$;

commit;
