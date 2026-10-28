-- 0740 — Who added a workspace member (sharing insight, Phase 1 #1).
--
-- A workspace_members row says who is in, never how they got there. A claimed
-- invite leaves its pending_invites row and a link join its
-- workspace_invite_link_joins row, but someone a manager added by hand leaves
-- nothing, so the admin can't say who brought most of the people working in
-- someone else's workspace.
--
--   1. workspace_member_adds: one row per member row inserted from now on, how
--      they joined (joined_via) and, when a person did it, who (added_by). A
--      table of its own rather than columns on workspace_members, which every
--      co-member can read; no client reads this one.
--   2. _tg_workspace_member_added, AFTER INSERT on workspace_members, fills
--      it. AFTER INSERT sees the rows an upsert inserts and none it updates (a
--      role change isn't a new member), so no join function is restated. Its
--      body runs in an exception block of its own: the bookkeeping can fail,
--      the join can't. First match wins:
--        service         role 'service' (0360's service identities)
--        system          the workspace's creator, role 'owner', or a row
--                        written under soleil.quiet_member_email (0532: a team
--                        move, a team workspace's creation, an approval)
--        workspace_link  under soleil.ws_link_join (0450, 0521); the link's
--                        creator is read from workspace_invite_link_joins,
--                        not stamped here
--        direct_add      a signed-in person put someone else in:
--                        added_by = auth.uid()
--        email_invite    the unclaimed workspace invitation to their address
--                        (0606's claims insert the member, then mark the
--                        invitation claimed): added_by = invited_by
--        other           anything else
--      No backfill: a member who joined before this reads "not recorded".
--   3. Proof: closed to clients, and three joins exercised, then undone.

set local lock_timeout = '3s';

-- ── 1. The table ─────────────────────────────────────────────────────────────
create table if not exists public.workspace_member_adds (
  id           bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text,
  joined_via   text not null check (joined_via in
                 ('system', 'service', 'workspace_link', 'direct_add', 'email_invite', 'other')),
  added_by     uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists workspace_member_adds_member_idx
  on public.workspace_member_adds (workspace_id, user_id, created_at desc);
create index if not exists workspace_member_adds_added_by_idx
  on public.workspace_member_adds (added_by) where added_by is not null;

alter table public.workspace_member_adds enable row level security;
revoke all on table public.workspace_member_adds from public, anon, authenticated;

-- ── 2. The trigger ───────────────────────────────────────────────────────────
create or replace function public._tg_workspace_member_added()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_actor   uuid;
  v_creator uuid;
  v_via     text;
  v_by      uuid;
begin
  begin
    v_actor := auth.uid();

    if new.role = 'service' then
      v_via := 'service';
    else
      select w.created_by into v_creator from public.workspaces w where w.id = new.workspace_id;

      if new.role = 'owner'
         or new.user_id = v_creator
         or current_setting('soleil.quiet_member_email', true) = '1' then
        v_via := 'system';
      elsif current_setting('soleil.ws_link_join', true) = '1' then
        v_via := 'workspace_link';
      elsif v_actor is not null and v_actor <> new.user_id then
        v_via := 'direct_add';
        v_by  := v_actor;
      else
        select pi.invited_by into v_by
          from public.pending_invites pi
         where pi.workspace_id = new.workspace_id
           and pi.board_id is null
           and pi.claimed_at is null
           and lower(pi.email) = (select lower(u.email) from auth.users u where u.id = new.user_id)
         order by pi.created_at desc
         limit 1;
        v_via := case when found then 'email_invite' else 'other' end;
      end if;
    end if;

    insert into public.workspace_member_adds (workspace_id, user_id, role, joined_via, added_by)
    values (new.workspace_id, new.user_id, new.role, v_via, v_by);
  exception when others then
    raise warning '_tg_workspace_member_added: % (%)', sqlerrm, sqlstate;
  end;
  return new;
end;
$$;

revoke execute on function public._tg_workspace_member_added() from public, anon, authenticated;

create or replace trigger workspace_member_added_trigger
  after insert on public.workspace_members
  for each row execute function public._tg_workspace_member_added();

-- ── 3. Proof ─────────────────────────────────────────────────────────────────
do $proof$
declare
  v_who    text;
  v_ws     uuid;
  v_owner  uuid;
  v_people uuid[];
  v_via    text;
  v_by     uuid;
  v_inv    uuid;
begin
  foreach v_who in array array['public', 'anon', 'authenticated'] loop
    if has_table_privilege(v_who, 'public.workspace_member_adds', 'select, insert, update, delete') then
      raise exception '0740: % can reach workspace_member_adds', v_who;
    end if;
    if has_function_privilege(v_who, 'public._tg_workspace_member_added()', 'execute') then
      raise exception '0740: % can execute _tg_workspace_member_added()', v_who;
    end if;
  end loop;
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'public.workspace_members'::regclass
                    and t.tgname = 'workspace_member_added_trigger'
                    and t.tgenabled = 'O') then
    raise exception '0740: workspace_member_added_trigger is missing or disabled';
  end if;

  -- An internal workspace, and three internal accounts that aren't in it.
  select w.id, w.created_by into v_ws, v_owner
    from public.workspaces w
   where w.created_by in (select i.user_id from public._internal_user_ids() i)
   order by (select count(*) from public.workspace_members m where m.workspace_id = w.id), w.created_at
   limit 1;
  select array_agg(i.user_id order by i.user_id) into v_people
    from public._internal_user_ids() i
   where i.user_id is distinct from v_owner
     and exists (select 1 from auth.users u where u.id = i.user_id and u.email is not null)
     and not exists (select 1 from public.workspace_members m
                      where m.workspace_id = v_ws and m.user_id = i.user_id);
  if v_ws is null or coalesce(cardinality(v_people), 0) < 3 then
    raise notice '0740: no internal workspace with three internal outsiders; the joins were not exercised';
    return;
  end if;

  begin
    -- A manager puts someone in by hand.
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    insert into public.workspace_members (workspace_id, user_id, role) values (v_ws, v_people[1], 'viewer');
    select a.joined_via, a.added_by into v_via, v_by
      from public.workspace_member_adds a where a.workspace_id = v_ws and a.user_id = v_people[1];
    if v_via is distinct from 'direct_add' or v_by is distinct from v_owner then
      raise exception '0740: a hand add read as % by %', v_via, v_by;
    end if;

    -- Someone joins through the workspace's invite link (0450 sets the flag, then clears it).
    perform set_config('request.jwt.claims', json_build_object('sub', v_people[2], 'role', 'authenticated')::text, true);
    perform set_config('soleil.ws_link_join', '1', true);
    insert into public.workspace_members (workspace_id, user_id, role) values (v_ws, v_people[2], 'editor');
    perform set_config('soleil.ws_link_join', '', true);
    select a.joined_via, a.added_by into v_via, v_by
      from public.workspace_member_adds a where a.workspace_id = v_ws and a.user_id = v_people[2];
    if v_via is distinct from 'workspace_link' or v_by is not null then
      raise exception '0740: a link join read as % by %', v_via, v_by;
    end if;

    -- Someone claims an invitation to their address.
    insert into public.pending_invites (email, workspace_id, role, invited_by)
    select u.email, v_ws, 'editor', v_owner from auth.users u where u.id = v_people[3]
    on conflict do nothing;
    select pi.invited_by into v_inv
      from public.pending_invites pi
     where pi.workspace_id = v_ws and pi.board_id is null and pi.claimed_at is null
       and lower(pi.email) = (select lower(u.email) from auth.users u where u.id = v_people[3]);
    perform set_config('request.jwt.claims', json_build_object('sub', v_people[3], 'role', 'authenticated')::text, true);
    insert into public.workspace_members (workspace_id, user_id, role) values (v_ws, v_people[3], 'editor');
    select a.joined_via, a.added_by into v_via, v_by
      from public.workspace_member_adds a where a.workspace_id = v_ws and a.user_id = v_people[3];
    if v_via is distinct from 'email_invite' or v_by is distinct from v_inv then
      raise exception '0740: an invitation claim read as % by %', v_via, v_by;
    end if;

    raise exception '0740: proven' using errcode = 'SL740';
  exception when sqlstate 'SL740' then
    null;   -- every write above is undone
  end;
end
$proof$;
