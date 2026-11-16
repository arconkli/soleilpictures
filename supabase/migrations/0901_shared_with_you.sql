-- 0901: Shared with you: what's new, what you took off your list, and what
-- you've shared.
--
-- Applied on 2026-11-15 as 0899_shared_with_you_seen_table, _meta_mark,
-- _hide, _by_me and _grants_proof, before main took 0899 for image variant
-- paths and 0900 for my days back; renumbered to 0901 here, with the body
-- as it was applied (its proof still says 0899).
--
-- The sidebar's Shared with you puts a dot on a cluster someone shared with
-- you until you open it, and lets you take one off your list. Where that is
-- kept:
--
--   board_share_seen   one row per (person, shared cluster) once they have
--                      opened it or taken it off their list. A table of its
--                      own rather than columns on board_shares, because a
--                      cluster's managers can read its board_shares rows
--                      ("board_shares read own or owner"): whether and when
--                      someone opened a cluster, or removed it from their
--                      list, is theirs alone. RLS on, no policies and no
--                      grants, as file_share_seen (0424); only the functions
--                      below read or write it.
--
--   A seen row counts only for the share it came after: an opened_at or a
--   hidden_at older than the share's created_at is ignored, so a cluster
--   that is unshared and shared again shows as new and is back on the list
--   without anyone clearing the old row.
--
--   list_shared_board_meta()       one row per share of mine, the same roots
--                                  as list_shared_boards: shared_at,
--                                  opened_at, hidden_at, via_link. The app
--                                  reads it after boot, so the boot read
--                                  list_shared_boards stays as it is.
--   mark_shared_board_opened(id)   writes only while the share is new or off
--                                  the list; opening it again writes nothing.
--   hide_shared_board(id, hidden)  Remove from my list, and its Undo.
--   list_my_board_shares()         the clusters I shared (I invited someone,
--                                  or made a link that is still live) and can
--                                  still edit: who has each one (name and
--                                  colour, never an email), how many, and
--                                  whether a link is on. For the Shared
--                                  page's By you.
--
-- Shares made before this migration count as opened, so only what is shared
-- from now on gets the dot. Nothing existing changes: no drop, no new column
-- on an existing table, no change to any existing function.

begin;

create table if not exists public.board_share_seen (
  user_id   uuid not null references auth.users(id) on delete cascade,
  board_id  uuid not null references public.boards(id) on delete cascade,
  opened_at timestamptz,
  hidden_at timestamptz,
  primary key (user_id, board_id)
);

alter table public.board_share_seen enable row level security;
revoke all on table public.board_share_seen from public, anon, authenticated;

insert into public.board_share_seen (user_id, board_id, opened_at)
select s.user_id, s.board_id, s.created_at
from public.board_shares s
on conflict (user_id, board_id) do nothing;

create or replace function public.list_shared_board_meta()
returns table (
  board_id  uuid,
  shared_at timestamptz,
  opened_at timestamptz,
  hidden_at timestamptz,
  via_link  boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select s.board_id,
         s.created_at,
         case when v.opened_at >= s.created_at then v.opened_at end,
         case when v.hidden_at >= s.created_at then v.hidden_at end,
         s.via_link_token is not null
  from board_shares s
  join boards b on b.id = s.board_id
  left join board_share_seen v on v.user_id = s.user_id and v.board_id = s.board_id
  where s.user_id = auth.uid()
    and b.deleted_at is null
    and not is_workspace_member(b.workspace_id);
$$;

create or replace function public.mark_shared_board_opened(p_board_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_shared timestamptz;
begin
  if v_uid is null or p_board_id is null then
    return false;
  end if;
  select s.created_at into v_shared
    from board_shares s
   where s.user_id = v_uid and s.board_id = p_board_id;
  if not found then
    return false;
  end if;
  if exists (
    select 1 from board_share_seen v
     where v.user_id = v_uid and v.board_id = p_board_id
       and v.opened_at >= v_shared
       and (v.hidden_at is null or v.hidden_at < v_shared)
  ) then
    return false;
  end if;
  insert into board_share_seen as v (user_id, board_id, opened_at)
  values (v_uid, p_board_id, now())
  on conflict (user_id, board_id)
  do update set opened_at = excluded.opened_at, hidden_at = null;
  return true;
end;
$$;

create or replace function public.hide_shared_board(p_board_id uuid, p_hidden boolean default true)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or p_board_id is null then
    return false;
  end if;
  if not exists (
    select 1 from board_shares s
     where s.user_id = v_uid and s.board_id = p_board_id
  ) then
    return false;
  end if;
  if coalesce(p_hidden, true) then
    insert into board_share_seen as v (user_id, board_id, hidden_at)
    values (v_uid, p_board_id, now())
    on conflict (user_id, board_id)
    do update set hidden_at = excluded.hidden_at;
  else
    update board_share_seen v set hidden_at = null
     where v.user_id = v_uid and v.board_id = p_board_id
       and v.hidden_at is not null;
  end if;
  return true;
end;
$$;

revoke all on function public.list_shared_board_meta() from public, anon;
revoke all on function public.mark_shared_board_opened(uuid) from public, anon;
revoke all on function public.hide_shared_board(uuid, boolean) from public, anon;
grant execute on function public.list_shared_board_meta() to authenticated;
grant execute on function public.mark_shared_board_opened(uuid) to authenticated;
grant execute on function public.hide_shared_board(uuid, boolean) to authenticated;

create or replace function public.list_my_board_shares()
returns table (
  board_id       uuid,
  board_name     text,
  board_cover    text,
  workspace_id   uuid,
  workspace_name text,
  people         jsonb,
  people_count   int,
  link_on        boolean,
  last_shared_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select s.board_id from board_shares s where s.invited_by = auth.uid()
    union
    select l.board_id from public_share_links l
     where l.created_by = auth.uid()
       and l.revoked_at is null
       and (l.expires_at is null or l.expires_at > now())
  ),
  live_links as (
    select l.board_id, max(l.created_at) as made_at
      from public_share_links l
     where l.board_id in (select m.board_id from mine m)
       and l.revoked_at is null
       and (l.expires_at is null or l.expires_at > now())
     group by l.board_id
  )
  select b.id,
         b.name,
         coalesce(b.cover, 'neutral')::text,
         w.id,
         w.name,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'user_id', x.user_id, 'name', x.name,
                    'color', x.color, 'role', x.role)
                  order by x.created_at desc)
             from (
               select s.user_id, s.role, s.created_at,
                      nullif(btrim(p.display_name), '') as name,
                      case when p.color ~ '^#[0-9A-Fa-f]{6}$' then p.color end as color
                 from board_shares s
                 left join profiles p on p.user_id = s.user_id
                where s.board_id = b.id
                order by s.created_at desc
                limit 8
             ) x
         ), '[]'::jsonb),
         (select count(*)::int from board_shares s where s.board_id = b.id),
         ll.board_id is not null,
         greatest((select max(s.created_at) from board_shares s where s.board_id = b.id), ll.made_at)
  from mine m
  join boards b     on b.id = m.board_id
  join workspaces w on w.id = b.workspace_id
  left join live_links ll on ll.board_id = b.id
  where b.deleted_at is null
    and can_write_board(b.id)
  order by 9 desc nulls last, 2 asc
  limit 200;
$$;

revoke all on function public.list_my_board_shares() from public, anon;
grant execute on function public.list_my_board_shares() to authenticated;

-- Proofs (the 0311 habit: a REVOKE reporting success proves nothing)

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.list_shared_board_meta()',
    'public.mark_shared_board_opened(uuid)',
    'public.hide_shared_board(uuid, boolean)',
    'public.list_my_board_shares()'
  ] loop
    if has_function_privilege('anon', f, 'execute') then
      raise exception '0899: % is callable signed out', f;
    end if;
    if not has_function_privilege('authenticated', f, 'execute') then
      raise exception '0899: % is not callable signed in', f;
    end if;
  end loop;
  if has_table_privilege('anon', 'public.board_share_seen', 'select')
     or has_table_privilege('authenticated', 'public.board_share_seen', 'select')
     or has_table_privilege('authenticated', 'public.board_share_seen', 'insert') then
    raise exception '0899: board_share_seen is reachable from the app directly';
  end if;
end $$;

commit;
