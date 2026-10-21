-- 0473 — a day spent sending messages is a working day (owner, 2026-10-20).
--
-- did_work has meant "the person changed the contents of a cluster": a
-- trigger on card_index stamps it from the server (0248, 0347), and the
-- client's WORK_EVENTS stamps the work that never touches a card — documents,
-- comments, tags, arrows. A day spent only in Messages read as presence. The
-- owner's call: writing to the people you work with is work.
--
-- (1) messages_active_day: a sent message stamps its sender's day as work, the
--     way a card does — from the server, so an ad blocker or an old client
--     cannot lose it, and only for a message that was actually stored. A
--     failure here must never cost anyone their message, so it warns and lets
--     the insert through.
-- (2) The days already behind us, from the first day did_work was ever stamped
--     (the tracking floor) on: each day someone sent a message reads as work,
--     work_ops counting the messages, as the trigger would have. Days before
--     the floor stay unmeasured, so the admin series keep their floor — the
--     block refuses to commit if it moved.
-- (3) _admin_engaged_visits counts msg_send inside a visit as work, matching
--     WORK_EVENTS, which gains EV.MSG_SEND in the same commit. A send that
--     reported ok:false never arrived and is not work, the rule the client
--     applies too (isWorkEvent). The rest of the body is 0347's, byte for byte.

-- ── 1. A sent message is work ───────────────────────────────────────────────
create or replace function public._stamp_active_day_message()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.kind is distinct from 'user' or new.sender_id is null then
    return new;
  end if;

  begin
    insert into public.user_active_day (user_id, day, did_work, work_ops)
      values (new.sender_id, current_date, true, 1)
      on conflict (user_id, day) do update
        set did_work = true,
            work_ops = public.user_active_day.work_ops + 1;
  exception when others then
    raise warning '_stamp_active_day_message: % %', sqlstate, sqlerrm;
  end;
  return new;
end $$;

revoke all on function public._stamp_active_day_message() from public, anon, authenticated;

-- ── 2. The message days already behind us ───────────────────────────────────
-- Before the trigger exists, so no message is counted twice.
do $backfill$
declare
  v_floor date;
  v_after date;
begin
  select min(day) into v_floor from public.user_active_day where did_work;
  if v_floor is null then
    return;
  end if;

  insert into public.user_active_day (user_id, day, did_work, work_ops)
  select m.sender_id, (m.created_at at time zone 'UTC')::date, true, count(*)::int
    from public.messages m
   where m.kind = 'user'
     and m.sender_id is not null
     and (m.created_at at time zone 'UTC')::date >= v_floor
   group by 1, 2
  on conflict (user_id, day) do update
    set did_work = true,
        work_ops = public.user_active_day.work_ops + excluded.work_ops;

  select min(day) into v_after from public.user_active_day where did_work;
  if v_after is distinct from v_floor then
    raise exception '0473: the did_work floor moved from % to %', v_floor, v_after;
  end if;
end $backfill$;

create or replace trigger messages_active_day
  after insert on public.messages
  for each row execute function public._stamp_active_day_message();

-- ── 3. A visit holding only messages is a visit that worked ─────────────────
create or replace function public._admin_engaged_visits(
  p_since date,
  p_exclude_internal boolean,
  p_verified_only boolean,
  p_merge_hours int
)
returns table (
  user_id uuid,
  k int,
  ek int,
  day date,
  first_at timestamptz,
  last_at timestamptz,
  active_s int,
  worked boolean,
  engaged boolean
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with v as (
    select * from public._admin_visits(p_since, p_exclude_internal, p_verified_only, p_merge_hours)
  ),
  a as (
    select v.user_id, v.k, v.day, v.first_at, v.last_at,
           coalesce((
             select sum(s.active_seconds)
               from public.usage_session s
              where s.user_id = v.user_id
                and s.started_at between v.first_at - interval '5 minutes'
                                     and v.last_at + interval '5 minutes'
           ), 0)::int as active_s,
           exists (
             select 1
               from public.analytics_events e
              where e.user_id = v.user_id
                and e.occurred_at between v.first_at and v.last_at
                and e.event in (
                  'card_placed', 'card_edit', 'doc_edit', 'arrow_created', 'remix_clone',
                  'tag_manual_apply', 'tag_confirm', 'tag_merge', 'tag_candidate_promote',
                  'tag_set_type', 'comment_create', 'msg_send'
                )
                and coalesce(e.props->>'ok', '') <> 'false'
           ) as worked
      from v
  ),
  e as (
    select a.*, (a.active_s > 0 or a.worked) as engaged from a
  )
  select e.user_id, e.k,
         case when e.engaged
              then (row_number() over (partition by e.user_id, e.engaged order by e.first_at))::int
         end as ek,
         e.day, e.first_at, e.last_at, e.active_s, e.worked, e.engaged
    from e
$$;

-- ── 4. Prove it (a REVOKE that reports success proves nothing) ──────────────
do $proof$
declare
  v_bad text := '';
  v_role text;
  v_def text;
  v_floor date;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_function_privilege(v_role, 'public._stamp_active_day_message()', 'execute') then
      v_bad := v_bad || ' ' || v_role || ' can execute _stamp_active_day_message;';
    end if;
    if has_function_privilege(v_role, 'public._admin_engaged_visits(date, boolean, boolean, int)', 'execute') then
      v_bad := v_bad || ' ' || v_role || ' can execute _admin_engaged_visits;';
    end if;
  end loop;

  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'public.messages'::regclass
                    and t.tgname = 'messages_active_day'
                    and t.tgfoid = 'public._stamp_active_day_message()'::regprocedure
                    and t.tgenabled = 'O'
                    and (t.tgtype & 2) = 0          -- AFTER
                    and (t.tgtype & 4) <> 0) then   -- INSERT
    v_bad := v_bad || ' messages_active_day is not an enabled after-insert trigger;';
  end if;

  v_def := pg_get_functiondef('public._admin_engaged_visits(date, boolean, boolean, int)'::regprocedure);
  if v_def not like '%''comment_create'', ''msg_send''%'
     or v_def not like '%coalesce(e.props->>''ok'', '''') <> ''false''%' then
    v_bad := v_bad || ' _admin_engaged_visits does not count msg_send, or counts a failed one;';
  end if;

  -- Every message day from the floor on now reads as work.
  select min(day) into v_floor from public.user_active_day where did_work;
  if exists (select 1 from public.messages m
              where m.kind = 'user' and m.sender_id is not null
                and (m.created_at at time zone 'UTC')::date >= v_floor
                and not exists (select 1 from public.user_active_day u
                                 where u.user_id = m.sender_id
                                   and u.day = (m.created_at at time zone 'UTC')::date
                                   and u.did_work)) then
    v_bad := v_bad || ' a day with a sent message still reads as no work;';
  end if;

  if v_bad <> '' then
    raise exception '0473:%', v_bad;
  end if;
end $proof$;

notify pgrst, 'reload schema';
