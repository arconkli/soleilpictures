-- 0520: the 10-editor limit on Free and Creator — who holds a place, and the
-- check every door makes.
--
-- STATUS: written 2026-10-21; notice copy and the owner's list reworked the same
-- day for the owner's pick (B). NOT APPLIED until the owner says go.
--
-- The owner (2026-10-20): a personal account, Free or Creator, can have at most
-- 10 people who can edit; a group that needs more buys a Team (design:
-- docs/superpowers/specs/2026-10-21-team-plan-and-editor-limit-design.md).
--
-- Counted per ACCOUNT, across every workspace it owns (workspaces.created_by,
-- which every limit already follows). The places:
--   * the owner;
--   * members who can edit (owner, coowner, admin, editor);
--   * editor shares on live clusters;
--   * editor invites still waiting on an address with no account.
-- One place per person. Service accounts (0375) and banned accounts don't
-- count; nor, ever, do viewers.
--
-- Off until launch: app_config.editor_limit = {"enforced": false,
-- "test_owner_ids": []}. With it off, _editor_admit answers 'ok' before it
-- counts anything, so the doors 0521 checks behave exactly as before. An
-- owner listed in test_owner_ids gets the real limit (preview test accounts).
--
-- 0521 puts _editor_admit in every door an editor comes in through.

begin;

-- ── 1. The switch ───────────────────────────────────────────────────────────

insert into public.app_config (key, value)
values ('editor_limit', '{"enforced": false, "test_owner_ids": []}'::jsonb)
on conflict (key) do nothing;

create or replace function public._editor_limit()
returns integer
language sql
immutable
set search_path = public
as $$
  select 10;
$$;

-- On for everyone once launched, or for an owner listed for testing. A
-- malformed row reads as off: a typo here must never lock every door.
create or replace function public._editor_limit_on(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select (c.value ->> 'enforced' = 'true')
        or (jsonb_typeof(c.value -> 'test_owner_ids') = 'array'
            and (c.value -> 'test_owner_ids') ? (p_owner::text))
      from public.app_config c
     where c.key = 'editor_limit'
  ), false);
$$;

-- ── 2. Who holds a place ────────────────────────────────────────────────────

-- Every grant of editing in the account, one row per grant: the owner, each
-- editing membership, each editor share on a live cluster, and each editor
-- invite still waiting on an address. _account_editor_slots folds these to one
-- place per person; list_my_account_editors says where each one edits.
create or replace function public._account_editor_grants(p_owner uuid)
returns table (user_id uuid, email text, source text, workspace_id uuid, board_id uuid,
               role text, invite_id uuid, sent_at timestamptz)
language sql
stable
security definer
set search_path = public, auth
as $$
  with ws as (
    select w.id from public.workspaces w where w.created_by = p_owner
  ),
  people as (
    select p_owner as user_id, 'owner'::text as source,
           null::uuid as workspace_id, null::uuid as board_id, 'owner'::text as role
    union all
    select m.user_id, 'member', m.workspace_id, null::uuid, m.role::text
      from public.workspace_members m
     where m.workspace_id in (select ws.id from ws)
       and m.role in ('owner', 'coowner', 'admin', 'editor')
    union all
    select s.user_id, 'share', b.workspace_id, s.board_id, s.role::text
      from public.board_shares s
      join public.boards b on b.id = s.board_id
     where b.workspace_id in (select ws.id from ws)
       and b.deleted_at is null
       and s.role = 'editor'
  )
  select u.id, lower(u.email), pp.source, pp.workspace_id, pp.board_id, pp.role,
         null::uuid, null::timestamptz
    from people pp
    join auth.users u on u.id = pp.user_id
   where not public._user_banned(u.id)
     and not public._is_service_identity(u.id)
  union all
  -- An invite holds its place until it is claimed, expires or is cancelled.
  -- One the outbound breaker holds (0369), or one sent by an account that is
  -- now suspended, will never be delivered, so it holds nothing. Its id and
  -- date let the owner's list revoke it and say when it went.
  select null::uuid, lower(pi.email), 'pending', pi.workspace_id, pi.board_id, pi.role::text,
         pi.id, pi.created_at
    from public.pending_invites pi
   where pi.workspace_id in (select ws.id from ws)
     and pi.role in ('editor', 'workspace')
     and pi.claimed_at is null
     and pi.expires_at > now()
     and pi.held_at is null
     and not public._sharer_suspended(pi.invited_by)
     and (pi.board_id is null
          or exists (select 1 from public.boards b
                      where b.id = pi.board_id and b.deleted_at is null));
$$;

-- One place per person: an account once, however many places it can edit; a
-- waiting invite once per address, and not at all when an account with that
-- address already holds a place.
create or replace function public._account_editor_slots(p_owner uuid)
returns table (slot_key text, user_id uuid, email text, source text)
language sql
stable
security definer
set search_path = public
as $$
  with g as (
    select * from public._account_editor_grants(p_owner)
  ),
  accounts as (
    select distinct on (g.user_id) g.user_id, g.email, g.source
      from g
     where g.user_id is not null
     order by g.user_id, case g.source when 'owner' then 0 when 'member' then 1 else 2 end
  )
  select 'u:' || a.user_id::text, a.user_id, a.email, a.source
    from accounts a
  union all
  select distinct 'e:' || g.email, null::uuid, g.email, 'pending'::text
    from g
   where g.user_id is null
     and not exists (select 1 from accounts a where a.email = g.email);
$$;

create or replace function public._account_editor_count(p_owner uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer from public._account_editor_slots(p_owner);
$$;

-- ── 3. The check every door makes ───────────────────────────────────────────

-- 'ok' to let one more person edit in this workspace's account; 'already' when
-- they hold a place (an account by id or address, an address by its invite);
-- 'full' when the account has no room. That one comparison is the whole rule,
-- freeze included: an account that ends up over the limit (a transfer, a
-- restore) keeps everyone it has and admits nobody new until it is under.
-- It takes a workspace, not an owner, so a Team's seats (S2a) branch here
-- without touching a door.
create or replace function public._editor_admit(p_workspace uuid, p_user uuid, p_email text default null)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_owner uuid;
  v_email text := lower(nullif(btrim(p_email), ''));
  v_used  integer;
  v_held  boolean;
begin
  select w.created_by into v_owner from public.workspaces w where w.id = p_workspace;
  if v_owner is null or not public._editor_limit_on(v_owner) then
    return 'ok';
  end if;

  if v_email is null and p_user is not null then
    select lower(u.email) into v_email from auth.users u where u.id = p_user;
  end if;

  -- One admission at a time per account, so two invites can't both take the
  -- last place. Held until the door's transaction ends.
  perform pg_advisory_xact_lock(hashtext('editor_slots:' || v_owner::text));

  select count(*)::integer,
         coalesce(bool_or((p_user is not null and s.user_id = p_user)
                          or (v_email is not null and s.email = v_email)), false)
    into v_used, v_held
    from public._account_editor_slots(v_owner) s;

  if v_held then
    return 'already';
  end if;
  if v_used >= public._editor_limit() then
    return 'full';
  end if;
  return 'ok';
end;
$$;

-- The refusal, worded for whoever is asking. The hint is the stable key the
-- app reads:
--   * 'editor_limit': the caller is the account's owner, who can make room;
--   * 'editor_limit_ask_owner': anyone else, who can ask the owner.
create or replace function public._editor_refuse(p_workspace uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select w.created_by into v_owner from public.workspaces w where w.id = p_workspace;
  if v_owner is not null and v_owner = auth.uid() then
    raise exception 'editor limit reached: you have % people who can edit across your workspaces, the most a personal plan allows',
      public._editor_limit()
      using errcode = '42501', hint = 'editor_limit';
  end if;
  raise exception 'editor limit reached: this account already has % people who can edit',
    public._editor_limit()
    using errcode = '42501', hint = 'editor_limit_ask_owner';
end;
$$;

-- ── 4. Notices ──────────────────────────────────────────────────────────────

-- The account owner's first name, for "Alex’s plan" in the notices a co-owner
-- and a joiner read. Null for no name, or a name that is an address.
create or replace function public._editor_limit_owner_first_name(p_owner uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif(split_part(btrim(p.display_name), ' ', 1), '')
    from public.profiles p
   where p.user_id = p_owner
     and p.display_name not like '%@%';
$$;

-- The owner, and the workspace's co-owners (who manage its people), hear when
-- someone couldn't be made an editor because the account is full: an edit
-- link let someone in as a viewer, or someone asked for room.
--   * Never the person who caused it.
--   * Once a day per (recipient, who, how).
-- A notice must never break the door that sends it. The words are the owner's
-- pick (B, 2026-10-21): the owner reads "Your plan", a co-owner whose plan.
create or replace function public._notify_editor_limit(p_workspace uuid, p_board uuid, p_actor uuid, p_via text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_owner uuid;
  v_ws    text;
  v_board text;
  v_name  text;
  v_where text;
  v_first text;
  v_plan  text;
  r       record;
begin
  select w.created_by, nullif(btrim(w.name), '') into v_owner, v_ws
    from public.workspaces w where w.id = p_workspace;
  if v_owner is null or not public._editor_limit_on(v_owner) then
    return;
  end if;
  if p_board is not null then
    select nullif(btrim(b.name), '') into v_board from public.boards b where b.id = p_board;
  end if;
  v_where := coalesce('“' || coalesce(v_board, v_ws) || '”', 'your workspace');
  select coalesce(nullif(btrim(p.display_name), ''), u.email, 'Someone')
    into v_name
    from auth.users u left join public.profiles p on p.user_id = u.id
   where u.id = p_actor;
  v_name := coalesce(v_name, 'Someone');
  v_first := public._editor_limit_owner_first_name(v_owner);

  for r in
    select v_owner as user_id
    union
    select m.user_id from public.workspace_members m
     where m.workspace_id = p_workspace and m.role = 'coowner'
  loop
    continue when r.user_id is not distinct from p_actor;
    continue when exists (
      select 1 from public.notifications n
       where n.user_id = r.user_id
         and n.kind = 'editors.limit_reached'
         and n.actor_id is not distinct from p_actor
         and n.data ->> 'via' = p_via
         and n.created_at > now() - interval '24 hours');
    v_plan := case when r.user_id = v_owner then 'Your plan'
                   else coalesce(v_first || '’s plan', 'The owner’s plan') end;
    insert into public.notifications (user_id, kind, workspace_id, board_id, actor_id, title, body, data)
    values (
      r.user_id, 'editors.limit_reached', p_workspace, p_board, p_actor,
      case p_via
        when 'ask' then format('%s asked for room to add an editor', v_name)
        else format('%s joined %s as a viewer', v_name, v_where)
      end,
      case p_via
        when 'ask' then format('%s has %s people who can edit, the most it allows.', v_plan, public._editor_limit())
        else format('%s already has %s people who can edit.', v_plan, public._editor_limit())
      end,
      jsonb_build_object('via', p_via, 'editor_limit', public._editor_limit(),
                         'account_owner', r.user_id = v_owner));
  end loop;
exception when others then
  raise warning '_notify_editor_limit failed for %: %', p_workspace, sqlerrm;
end;
$$;

-- The person an edit link let in as a viewer learns why. It lands in their
-- notifications, and as a toast while the app is open. App also shows it once
-- on the next load, because a link is claimed before the app subscribes. Once
-- a day per place. The toast reads "<title>. <body>" (lib/editorLimit.js
-- noticeToastText), naming the owner by first name where there is one.
create or replace function public._notify_joined_as_viewer(p_user uuid, p_workspace uuid, p_board uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_place text;
  v_owner uuid;
  v_first text;
begin
  if exists (select 1 from public.notifications n
              where n.user_id = p_user
                and n.kind = 'editors.joined_as_viewer'
                and n.workspace_id = p_workspace
                and n.board_id is not distinct from p_board
                and n.created_at > now() - interval '24 hours') then
    return;
  end if;
  select coalesce(nullif(btrim(b.name), ''), nullif(btrim(w.name), '')), w.created_by
    into v_place, v_owner
    from public.workspaces w
    left join public.boards b on b.id = p_board
   where w.id = p_workspace;
  v_first := public._editor_limit_owner_first_name(v_owner);
  insert into public.notifications (user_id, kind, workspace_id, board_id, title, body, data)
  values (
    p_user, 'editors.joined_as_viewer', p_workspace, p_board,
    format('You joined %s as a viewer', coalesce('“' || v_place || '”', 'a workspace')),
    format('%s already has %s people who can edit, so you can view for now. We told %s.',
           coalesce(v_first || '’s plan', 'Its owner’s plan'), public._editor_limit(),
           coalesce(v_first, 'the owner')),
    jsonb_build_object('editor_limit', public._editor_limit()));
exception when others then
  raise warning '_notify_joined_as_viewer failed for %: %', p_user, sqlerrm;
end;
$$;

-- An edit link let someone in as a viewer because the account was full. Send
-- both notices and log editor_limit_viewer_fallback, so the read can tell how
-- often the limit turns someone away. Never raises.
create or replace function public._editor_limit_fallback(p_workspace uuid, p_board uuid, p_joiner uuid, p_via text, p_upgrade boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._notify_editor_limit(p_workspace, p_board, p_joiner, p_via);
  perform public._notify_joined_as_viewer(p_joiner, p_workspace, p_board);
  begin
    insert into public.analytics_events (user_id, event, props)
    values (p_joiner, 'editor_limit_viewer_fallback',
            jsonb_build_object('via', p_via, 'upgrade', p_upgrade,
                               'workspace_id', p_workspace, 'board_id', p_board));
  exception when others then null;
  end;
end;
$$;

-- ── 5. What the app can ask ─────────────────────────────────────────────────

-- The numbers for the share panel and Members:
--   * is the limit on for this account;
--   * how many places are taken, and how many of those by waiting invites;
--   * is it full;
--   * is the caller the account's owner (who can make room; anyone else asks).
-- Numbers only, never who. `subject` is 'account' for now; a Team will say
-- 'team' (S2a).
create or replace function public.get_editor_capacity(p_board_id uuid default null, p_workspace_id uuid default null)
returns table (enforced boolean, editor_limit integer, used integer, pending integer,
               is_full boolean, i_am_account_owner boolean, subject text)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_ws    uuid := p_workspace_id;
  v_owner uuid;
  v_on    boolean;
  v_used  integer;
  v_pend  integer;
begin
  if auth.uid() is null or not public._actor_active() then
    raise exception 'sign in to see this' using errcode = '42501';
  end if;
  if p_board_id is not null then
    select b.workspace_id into v_ws from public.boards b
     where b.id = p_board_id and b.deleted_at is null;
    if v_ws is null or not public.can_write_board(p_board_id) then
      raise exception 'you do not have access to this cluster' using errcode = '42501';
    end if;
  elsif v_ws is null
     or not (public.can_manage_workspace(v_ws) or public._workspace_member_can_write(v_ws)) then
    raise exception 'you do not have access to this workspace' using errcode = '42501';
  end if;

  select w.created_by into v_owner from public.workspaces w where w.id = v_ws;
  v_on := v_owner is not null and public._editor_limit_on(v_owner);
  select (count(*) filter (where s.source <> 'pending'))::integer,
         (count(*) filter (where s.source = 'pending'))::integer
    into v_used, v_pend
    from public._account_editor_slots(v_owner) s;

  return query select v_on, public._editor_limit(), v_used, v_pend,
                      v_on and v_used + v_pend >= public._editor_limit(),
                      v_owner is not distinct from auth.uid(),
                      'account'::text;
end;
$$;

-- Someone who isn't the owner, turned away by the limit, asks the owner (and
-- co-owners) to make room. A door that refuses rolls back everything it did,
-- its notices included, so asking is a call of its own. It returns:
--   * 'sent';
--   * 'already_sent': they asked within the last day;
--   * 'not_full': there's room after all, or the limit is off for the account;
--   * 'owner': it is their own account.
create or replace function public.ask_owner_for_editor_slot(p_board_id uuid default null, p_workspace_id uuid default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws    uuid := p_workspace_id;
  v_owner uuid;
begin
  if auth.uid() is null or not public._actor_active() then
    raise exception 'sign in to do this' using errcode = '42501';
  end if;
  if p_board_id is not null then
    select b.workspace_id into v_ws from public.boards b
     where b.id = p_board_id and b.deleted_at is null;
    if v_ws is null or not public.can_write_board(p_board_id) then
      raise exception 'you do not have access to this cluster' using errcode = '42501';
    end if;
  elsif v_ws is null
     or not (public.can_manage_workspace(v_ws) or public._workspace_member_can_write(v_ws)) then
    raise exception 'you do not have access to this workspace' using errcode = '42501';
  end if;

  select w.created_by into v_owner from public.workspaces w where w.id = v_ws;
  if v_owner = auth.uid() then
    return 'owner';
  end if;
  if not public._editor_limit_on(v_owner)
     or public._account_editor_count(v_owner) < public._editor_limit() then
    return 'not_full';
  end if;
  if exists (select 1 from public.notifications n
              where n.user_id = v_owner
                and n.kind = 'editors.limit_reached'
                and n.actor_id = auth.uid()
                and n.data ->> 'via' = 'ask'
                and n.created_at > now() - interval '24 hours') then
    return 'already_sent';
  end if;
  perform public._notify_editor_limit(v_ws, p_board_id, auth.uid(), 'ask');
  return 'sent';
end;
$$;

-- The owner's own list: everyone holding a place, plus the invites still
-- waiting, each with every grant that holds it (where, at what role, and for
-- an invite its id and date), so Members can say where someone edits and
-- free the place: make them a viewer, remove them, or revoke the invite.
-- The grants are read once (materialized), not once per row.
create or replace function public.list_my_account_editors()
returns table (slot_key text, user_id uuid, email text, display_name text, source text,
               grants jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if auth.uid() is null or not public._actor_active() then
    raise exception 'sign in to see this' using errcode = '42501';
  end if;
  return query
  with g as materialized (
    select * from public._account_editor_grants(auth.uid())
  )
  select s.slot_key, s.user_id, s.email,
         (select nullif(btrim(p.display_name), '') from public.profiles p where p.user_id = s.user_id),
         s.source,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'source', g.source, 'role', g.role,
                    'workspace_id', g.workspace_id, 'workspace_name', w.name,
                    'board_id', g.board_id, 'board_name', b.name,
                    'invite_id', g.invite_id, 'sent_at', g.sent_at)
                  order by g.source, w.name, b.name)
             from g
             left join public.workspaces w on w.id = g.workspace_id
             left join public.boards b on b.id = g.board_id
            where (s.user_id is not null and g.user_id = s.user_id)
               or (s.user_id is null and g.user_id is null and g.email = s.email)
         ), '[]'::jsonb)
    from public._account_editor_slots(auth.uid()) s
   order by (s.source = 'owner') desc, (s.source = 'pending'), s.email;
end;
$$;

-- ── 6. Grants (0311) ────────────────────────────────────────────────────────

revoke execute on function public._editor_limit() from public, anon, authenticated;
revoke execute on function public._editor_limit_on(uuid) from public, anon, authenticated;
revoke execute on function public._editor_limit_owner_first_name(uuid) from public, anon, authenticated;
revoke execute on function public._account_editor_grants(uuid) from public, anon, authenticated;
revoke execute on function public._account_editor_slots(uuid) from public, anon, authenticated;
revoke execute on function public._account_editor_count(uuid) from public, anon, authenticated;
revoke execute on function public._editor_admit(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public._editor_refuse(uuid) from public, anon, authenticated;
revoke execute on function public._notify_editor_limit(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public._notify_joined_as_viewer(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public._editor_limit_fallback(uuid, uuid, uuid, text, boolean) from public, anon, authenticated;

revoke execute on function public.get_editor_capacity(uuid, uuid) from public, anon;
revoke execute on function public.ask_owner_for_editor_slot(uuid, uuid) from public, anon;
revoke execute on function public.list_my_account_editors() from public, anon;
grant execute on function public.get_editor_capacity(uuid, uuid) to authenticated;
grant execute on function public.ask_owner_for_editor_slot(uuid, uuid) to authenticated;
grant execute on function public.list_my_account_editors() to authenticated;

-- ── 7. Proofs (the 0311 habit: a REVOKE reporting success proves nothing) ──

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public._editor_limit()', 'public._editor_limit_on(uuid)',
    'public._editor_limit_owner_first_name(uuid)',
    'public._account_editor_grants(uuid)', 'public._account_editor_slots(uuid)',
    'public._account_editor_count(uuid)', 'public._editor_admit(uuid,uuid,text)',
    'public._editor_refuse(uuid)', 'public._notify_editor_limit(uuid,uuid,uuid,text)',
    'public._notify_joined_as_viewer(uuid,uuid,uuid)',
    'public._editor_limit_fallback(uuid,uuid,uuid,text,boolean)'] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0520: % is client-executable', v_fn;
    end if;
  end loop;

  foreach v_fn in array array[
    'public.get_editor_capacity(uuid,uuid)',
    'public.ask_owner_for_editor_slot(uuid,uuid)',
    'public.list_my_account_editors()'] loop
    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception '0520: % is callable signed out', v_fn;
    end if;
    if not has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0520: % is not callable signed in', v_fn;
    end if;
  end loop;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('get_editor_capacity', 'ask_owner_for_editor_slot',
                                  'list_my_account_editors', '_editor_admit',
                                  '_account_editor_slots', '_account_editor_grants')
              group by p.proname having count(*) > 1) then
    raise exception '0520: an overload exists (PGRST203)';
  end if;

  -- Applying this changes nothing for anyone: the switch is off and lists nobody.
  if public._editor_limit_on(gen_random_uuid()) then
    raise exception '0520: the limit is on for an owner nobody listed';
  end if;
end $$;

commit;
