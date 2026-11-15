-- 0897: finishing Team (make-teams-even-better, 15 Nov).
--
-- 1. get_team_billing (0538) also returns seat_perk, so Seats & billing can
--    show the "People's own workspaces" switch that set_team_seat_perk (0537)
--    already saves and _seat_perk_on (0537) already enforces. The body is
--    live's, unchanged apart from that one key.
-- 2. Admins hear when people join: team.joined, one unread notice per admin
--    per team that counts up for 24 hours ("Lena Fischer and 2 others joined
--    Northlight Films"). A deferred constraint trigger on org_members, so it
--    runs once the joining function has finished:
--      - the team's own creation (joined_via 'create') never counts;
--      - a join that also left a pending request (a domain join with no seat
--        free) is skipped, because team.join_request already told the admins;
--      - the person who made it happen (an admin approving a request) and
--        the person who joined are not told.
--    A count-up rewrites the unread row in place and sends it on the same
--    socket notifications_broadcast (0242) uses, so the bell's words change
--    without a second row.
-- 3. Someone an admin keeps as a viewer hears it: team.kept_viewer, from an
--    AFTER UPDATE trigger on org_join_requests (pending -> kept, written by
--    keep_team_request_viewer, 0534). It names the cluster or workspace they
--    asked about and opens the cluster when there is one.
-- Triggers, not re-created RPC bodies, so the 0532-0534 functions stay as
-- they are. Both trigger functions catch their own errors: a notice must
-- never undo a join or a decision. data carries every name the words use, so
-- notificationWords.js can say them in the person's language.

begin;

create or replace function public.get_team_billing(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  o     public.organizations%rowtype;
  s     public.org_subscriptions%rowtype;
begin
  if v_uid is null or not public._actor_active() then
    raise exception 'sign in to do this' using errcode = '42501';
  end if;
  if not public._org_is_admin(p_org_id, v_uid) then
    raise exception 'only the team''s owner or an admin can see its plan' using errcode = '42501',
      hint = case when public._org_role(p_org_id, v_uid) is null then 'team_not_member' else 'team_not_admin' end;
  end if;
  select * into o from public.organizations where id = p_org_id and closed_at is null;
  if not found then
    raise exception 'team not found' using errcode = 'P0002';
  end if;
  select * into s from public.org_subscriptions where org_id = p_org_id;
  return jsonb_build_object(
    'status',                o.status,
    'is_owner',              o.owner_id = v_uid,
    'seats',                 o.seats,
    'seats_used',            public._team_seats_used(p_org_id),
    'seat_ceiling',          o.seat_ceiling,
    'when_full',             o.when_full,
    'auto_monthly_limit',    o.auto_monthly_limit,
    'auto_added_this_month', public._team_auto_added_this_month(p_org_id),
    'first_paid_at',         o.first_paid_at,
    'view_only_since',       o.view_only_since,
    'storage_blocks',        o.storage_blocks,
    'storage_used_bytes',    public._org_storage_used_bytes(p_org_id),
    'storage_quota_bytes',   public._org_storage_quota_bytes(p_org_id),
    'seat_perk',             o.seat_perk,
    'plan',                  s.plan,
    'subscription_status',   s.status,
    'seats_billed',          s.seats_billed,
    'current_period_end',    s.current_period_end,
    'cancel_at_period_end',  coalesce(s.cancel_at_period_end, false),
    'trial_end',             s.trial_end,
    'past_due_since',        s.past_due_since,
    'grace_ends_at',         s.past_due_since + make_interval(days => public._team_grace_days()));
end;
$$;

revoke execute on function public.get_team_billing(uuid) from public, anon;
grant execute on function public.get_team_billing(uuid) to authenticated;

commit;

begin;

-- team.joined: one unread notice per admin per team, counting up for 24 hours.
create or replace function public._tg_team_note_joined()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_team  text;
  v_name  text;
  v_admin uuid;
  v_row   public.notifications%rowtype;
  v_have  boolean;
  v_count integer;
  v_title text;
  v_body  text;
  v_data  jsonb;
begin
  if new.joined_via = 'create' then return null; end if;
  -- Still in the team now the joining function is done, and not waiting on a
  -- request the admins were already told about.
  if not exists (select 1 from public.org_members m
                  where m.org_id = new.org_id and m.user_id = new.user_id) then
    return null;
  end if;
  if exists (select 1 from public.org_join_requests r
              where r.org_id = new.org_id and r.user_id = new.user_id and r.status = 'pending') then
    return null;
  end if;
  select o.name into v_team from public.organizations o
   where o.id = new.org_id and o.closed_at is null;
  if v_team is null then return null; end if;
  v_name := public._team_person_name(new.user_id, true);

  for v_admin in
    select m.user_id from public.org_members m
     where m.org_id = new.org_id and m.role in ('owner', 'admin')
       and m.user_id <> new.user_id
       and m.user_id is distinct from v_actor
  loop
    begin
      select * into v_row from public.notifications n
       where n.user_id = v_admin and n.kind = 'team.joined'
         and n.data ->> 'org_id' = new.org_id::text
         and n.read_at is null
         and coalesce((n.data ->> 'since')::timestamptz, n.created_at) > now() - interval '24 hours'
       order by n.created_at desc
       limit 1
       for update;
      v_have := found;
      v_count := case when v_have then greatest(coalesce((v_row.data ->> 'count')::integer, 1), 1) + 1 else 1 end;
      v_title := case
        when v_count = 1 then format('%s joined %s', v_name, v_team)
        when v_count = 2 then format('%s and 1 other joined %s', v_name, v_team)
        else format('%s and %s others joined %s', v_name, v_count - 1, v_team) end;
      v_body := case
        when v_count > 1 then 'See who in People.'
        else case new.joined_via
               when 'invite'  then 'They accepted an invite.'
               when 'link'    then 'They joined through the team link.'
               when 'domain'  then 'They joined with their work email.'
               when 'request' then 'An admin approved their request.'
               else 'They joined the team.' end
             || case when new.role = 'viewer' then ' They can view.' else ' They can edit.' end
        end;
      v_data := jsonb_build_object(
        'org_id', new.org_id, 'team_name', v_team, 'name', v_name, 'count', v_count,
        'via', new.joined_via, 'role', new.role,
        'since', case when v_have then coalesce(v_row.data ->> 'since', v_row.created_at::text) else now()::text end);
      if v_have then
        update public.notifications
           set title = v_title, body = v_body, data = v_data, actor_id = new.user_id, created_at = now()
         where id = v_row.id;
        -- notifications_broadcast fires on insert only: send the new words.
        begin
          perform realtime.send(
            jsonb_build_object(
              'id', v_row.id, 'kind', 'team.joined', 'workspace_id', null,
              'board_id', null, 'context_board_id', null,
              'actor_id', new.user_id, 'title', v_title, 'body', v_body,
              'data', v_data, 'created_at', now()),
            'schedule-ping', 'user:' || v_admin::text, true);
        exception when others then
          raise warning '_tg_team_note_joined broadcast failed for %: %', v_row.id, sqlerrm;
        end;
      else
        insert into public.notifications (user_id, kind, actor_id, title, body, data)
        values (v_admin, 'team.joined', new.user_id, v_title, v_body, v_data);
      end if;
    exception when others then
      raise warning '_tg_team_note_joined failed for admin % in %: %', v_admin, new.org_id, sqlerrm;
    end;
  end loop;
  return null;
exception when others then
  raise warning '_tg_team_note_joined failed for % in %: %', new.user_id, new.org_id, sqlerrm;
  return null;
end;
$$;

revoke execute on function public._tg_team_note_joined() from public, anon, authenticated;

drop trigger if exists org_members_note_joined_trg on public.org_members;
create constraint trigger org_members_note_joined_trg
  after insert on public.org_members
  deferrable initially deferred
  for each row
  execute function public._tg_team_note_joined();

commit;

begin;

-- team.kept_viewer: the person an admin kept as a viewer.
create or replace function public._tg_team_note_kept()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team   text;
  v_target text;
  v_ws     uuid;
  v_board  uuid;
begin
  select o.name into v_team from public.organizations o
   where o.id = new.org_id and o.closed_at is null;
  if v_team is null then return null; end if;
  if new.board_id is not null then
    select b.name, b.workspace_id, b.id into v_target, v_ws, v_board
      from public.boards b where b.id = new.board_id and b.deleted_at is null;
  end if;
  if v_target is null and new.workspace_id is not null then
    select w.name, w.id into v_target, v_ws from public.workspaces w where w.id = new.workspace_id;
  end if;
  v_target := coalesce(nullif(btrim(v_target), ''), v_team);
  insert into public.notifications (user_id, kind, workspace_id, board_id, actor_id, title, body, data)
  values (new.user_id, 'team.kept_viewer', v_ws, v_board, new.decided_by,
          format('You can keep viewing “%s”', v_target),
          format('An admin of %s kept you as a viewer for now.', v_team),
          jsonb_build_object('org_id', new.org_id, 'team_name', v_team, 'target_name', v_target,
                             'request_id', new.id));
  return null;
exception when others then
  raise warning '_tg_team_note_kept failed for request %: %', new.id, sqlerrm;
  return null;
end;
$$;

revoke execute on function public._tg_team_note_kept() from public, anon, authenticated;

drop trigger if exists org_join_requests_note_kept_trg on public.org_join_requests;
create trigger org_join_requests_note_kept_trg
  after update of status on public.org_join_requests
  for each row
  when (old.status = 'pending' and new.status = 'kept')
  execute function public._tg_team_note_kept();

-- The 0311 habit: prove the grants, and that both triggers are in place.
do $$
declare
  v_fn text;
begin
  if has_function_privilege('anon', 'public.get_team_billing(uuid)', 'execute') then
    raise exception '0897: anon can run get_team_billing';
  end if;
  if not has_function_privilege('authenticated', 'public.get_team_billing(uuid)', 'execute') then
    raise exception '0897: signed-in people lost get_team_billing';
  end if;
  foreach v_fn in array array['public._tg_team_note_joined()', 'public._tg_team_note_kept()'] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0897: % is callable from outside', v_fn;
    end if;
  end loop;
  if not exists (select 1 from pg_trigger t
                  where t.tgname = 'org_members_note_joined_trg'
                    and t.tgrelid = 'public.org_members'::regclass
                    and t.tgdeferrable and t.tginitdeferred) then
    raise exception '0897: the deferred join trigger is missing';
  end if;
  if not exists (select 1 from pg_trigger t
                  where t.tgname = 'org_join_requests_note_kept_trg'
                    and t.tgrelid = 'public.org_join_requests'::regclass) then
    raise exception '0897: the kept-as-viewer trigger is missing';
  end if;
end $$;

commit;
