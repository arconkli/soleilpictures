-- 0862: working live together earns cards.
--
-- The owner (2026-11-04): "roblox has this thing where WHILE friends of yours
-- are active in a game youre playing you get a 10% boost or sometimes more. is
-- there a way we could impliment that where working with friends ACTIVELY gets
-- you something".
--
-- Two or more different people active in the same cluster at the same time
-- each earn bonus cards, the invite reward's currency (profiles.
-- bonus_card_credits), so the free card limit rises with them: 1 card every
-- 2 minutes together with one other person, 2 with two others, 3 with three
-- or more, at most 25 a calendar month (UTC). Creator and Team bank them like
-- invite cards. Nothing here touches the editor or workspace limits.
--
-- WHO is active is the party worker's call (boards/party/board.ts): it alone
-- knows who is connected, by the verified account its door stamps on every
-- socket (never the name a browser announces). Active = an edit, a cursor,
-- caret or selection move, or the app's "here" stamp on real input, within
-- the last 2 minutes. Every 60 s while two or more are active it calls
-- live_together_tick with each person's seconds together since its last call.
--
-- WHAT that earns is this file's call, so a worker bug can't mint cards:
--   * real people only: a confirmed email that is not one of our synthetic
--     addresses (_synthetic_address), not anonymous, not deleted, not a
--     service account, not banned;
--   * at least one OTHER such person in the same call: one person with two
--     tabs is one id, and a second account that never confirmed its email
--     earns nobody anything;
--   * wall-clock dedupe: one call credits a person at most the seconds since
--     their previous credit, so two clusters at once can't earn twice;
--   * the month cap is applied under the person's month row lock.
--
-- Callable by the service role only (the party worker); a signed-in person
-- reads their own month, lifetime count and bonus credits (one snapshot)
-- through get_my_together_stats(). Safe either side of
-- the party deploy: a worker that finds no function here pays nothing.

begin;

create table if not exists public.live_together_months (
  user_id          uuid        not null references auth.users(id) on delete cascade,
  month            date        not null,
  weighted_seconds integer     not null default 0 check (weighted_seconds >= 0),
  cards            integer     not null default 0 check (cards >= 0),
  last_credited_at timestamptz,
  primary key (user_id, month)
);
comment on table public.live_together_months is
  'Seconds spent working live with others (weighted by how many) and the cards they paid, per person per calendar month (UTC). Written only by live_together_tick (0862).';
alter table public.live_together_months enable row level security;
revoke all on public.live_together_months from public, anon, authenticated;

-- p_people: [{"id": "<user uuid>", "s": <seconds>}, …], the active people in
-- one cluster. A tick credits each eligible person min(s, 120, seconds since
-- their last credit) × boost; p_ended marks the end of a stretch (s is then
-- its length) and only records it.
create or replace function public.live_together_tick(
  p_board  uuid,
  p_people jsonb,
  p_ended  boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_card_seconds constant integer := 120;  -- together this long with one other person = 1 card
  c_month_cap    constant integer := 25;   -- cards a calendar month, at most
  c_max_boost    constant integer := 3;    -- with 3 or more others: 3 cards every 2 minutes
  c_max_tick     constant integer := 120;  -- the most one call credits anyone
  c_new_stretch  constant integer := 180;  -- a longer gap starts a new stretch (analytics only)
  c_max_people   constant integer := 100;  -- a bigger list is not a work session: pays nothing
  v_month   date := date_trunc('month', now() at time zone 'utc')::date;
  v_none    jsonb;
  v_ids     uuid[];
  v_secs    integer[];
  v_ok      uuid[];
  v_n       integer;
  v_boost   integer;
  v_results jsonb := '[]'::jsonb;
  r         record;
  v_w       integer;
  v_c       integer;
  v_last    timestamptz;
  v_wall    integer;
  v_credit  integer;
  v_new     integer;
begin
  v_none := jsonb_build_object('people', 0, 'boost', 0, 'cap', c_month_cap,
                               'card_seconds', c_card_seconds, 'results', '[]'::jsonb);
  -- One check at a time: SQL does not promise to evaluate an OR left to right.
  if p_board is null or jsonb_typeof(p_people) is distinct from 'array' then
    return v_none;
  end if;
  if jsonb_array_length(p_people) > c_max_people then
    return v_none;
  end if;
  if not exists (select 1 from public.boards b where b.id = p_board and b.deleted_at is null) then
    return v_none;
  end if;

  -- The list as given: well-formed ids, once each, seconds clamped.
  select coalesce(array_agg(x.id order by x.id), '{}'),
         coalesce(array_agg(x.s order by x.id), '{}')
    into v_ids, v_secs
    from (select distinct on (y.id)
                 y.id,
                 greatest(0, least(case when p_ended then 86400 else c_max_tick end, y.s))::integer as s
            from (select case when (el ->> 'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                              then (el ->> 'id')::uuid end as id,
                         case when jsonb_typeof(el -> 's') = 'number'
                              then floor((el -> 's')::numeric) else 0 end as s
                    from jsonb_array_elements(p_people) el
                   where jsonb_typeof(el) = 'object') y
           where y.id is not null
           order by y.id, y.s desc) x;

  -- Real people only.
  select coalesce(array_agg(u.id order by u.id), '{}')
    into v_ok
    from auth.users u
    join public.profiles p on p.user_id = u.id
   where u.id = any (v_ids)
     and u.email_confirmed_at is not null
     and u.deleted_at is null
     and not u.is_anonymous
     and not public._synthetic_address(u.email)
     and not p.is_service
     and not public._user_banned(u.id);

  v_n := cardinality(v_ok);
  v_boost := case when v_n >= 2 then least(v_n - 1, c_max_boost) else 0 end;

  -- One person at a time, always in id order, so two clusters paying the same
  -- people take their locks in the same order.
  for r in
    select x.id, x.s from unnest(v_ids, v_secs) as x(id, s)
     where x.id = any (v_ok)
     order by x.id
  loop
    v_new := 0;
    if p_ended or v_boost = 0 then
      -- Nothing to pay: report the month as it stands.
      select coalesce(max(m.weighted_seconds), 0), coalesce(max(m.cards), 0) into v_w, v_c
        from public.live_together_months m
       where m.user_id = r.id and m.month = v_month;
      if p_ended then
        insert into public.analytics_events (user_id, event, props)
        values (r.id, 'together_ended',
                jsonb_build_object('board', p_board, 'seconds', r.s, 'people', v_n));
      end if;
    else
      -- One payer per person at a time, across months too: at midnight UTC on
      -- the 1st two clusters would otherwise lock different month rows and
      -- both read the same last stamp.
      perform pg_advisory_xact_lock(hashtextextended('live_together:' || r.id::text, 0));
      insert into public.live_together_months (user_id, month) values (r.id, v_month)
      on conflict (user_id, month) do nothing;
      select m.weighted_seconds, m.cards into v_w, v_c
        from public.live_together_months m
       where m.user_id = r.id and m.month = v_month
         for update;
      -- Read after the lock: a cluster that paid this person a moment ago has
      -- committed by now, and its stamp is what this call may not overlap.
      select max(m.last_credited_at) into v_last
        from public.live_together_months m
       where m.user_id = r.id;
      v_wall := case when v_last is null then c_max_tick
                     else greatest(0, floor(extract(epoch from (now() - v_last))))::integer end;
      v_credit := least(r.s, v_wall);
      if v_credit > 0 then
        if v_last is null or now() - v_last > make_interval(secs => c_new_stretch) then
          insert into public.analytics_events (user_id, event, props)
          values (r.id, 'together_started',
                  jsonb_build_object('board', p_board, 'people', v_n));
        end if;
        v_w := v_w + v_credit * v_boost;
        v_new := greatest(0, least(c_month_cap, v_w / c_card_seconds) - v_c);
        update public.live_together_months
           set weighted_seconds = v_w,
               cards = v_c + v_new,
               last_credited_at = now()
         where user_id = r.id and month = v_month;
        v_c := v_c + v_new;
        if v_new > 0 then
          update public.profiles
             set bonus_card_credits = coalesce(bonus_card_credits, 0) + v_new
           where user_id = r.id;
          insert into public.analytics_events (user_id, event, props)
          values (r.id, 'together_card_earned',
                  jsonb_build_object('board', p_board, 'cards', v_new, 'people', v_n,
                                     'month_cards', v_c));
        end if;
      end if;
    end if;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'id', r.id,
      'eligible', true,
      'earned', v_new,
      'month', v_c,
      'capped', v_c >= c_month_cap,
      'progress', case when v_c >= c_month_cap then 0
                       else round((v_w % c_card_seconds)::numeric / c_card_seconds, 2) end));
  end loop;

  select v_results || coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'eligible', false)
                                         order by x.id), '[]'::jsonb)
    into v_results
    from unnest(v_ids) as x(id)
   where not (x.id = any (v_ok));

  return jsonb_build_object('people', v_n, 'boost', v_boost, 'cap', c_month_cap,
                            'card_seconds', c_card_seconds, 'results', v_results);
end;
$$;
comment on function public.live_together_tick(uuid, jsonb, boolean) is
  'Party worker only: pays together cards to the real people active in one cluster (0862).';
revoke execute on function public.live_together_tick(uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.live_together_tick(uuid, jsonb, boolean) to service_role;

-- Settings › Invite and earn: "Working together: 9 of 25 cards this month".
create or replace function public.get_my_together_stats()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  -- The credits come from the same snapshot as the together count, so the app can
  -- tell cards earned together from a reward that landed beside them (App.jsx).
  select jsonb_build_object(
    'month_cards', coalesce(sum(m.cards) filter (
                     where m.month = date_trunc('month', now() at time zone 'utc')::date), 0),
    'lifetime_cards', coalesce(sum(m.cards), 0),
    'bonus_card_credits', (select p.bonus_card_credits from public.profiles p where p.user_id = auth.uid()))
    from public.live_together_months m
   where m.user_id = auth.uid();
$$;
revoke execute on function public.get_my_together_stats() from public, anon;
grant execute on function public.get_my_together_stats() to authenticated;

-- Proofs (the 0311 habit: a REVOKE reporting success proves nothing)

do $$
declare
  v_tick  constant text := 'public.live_together_tick(uuid,jsonb,boolean)';
  v_stats constant text := 'public.get_my_together_stats()';
  v_priv  text;
begin
  if has_function_privilege('anon', v_tick, 'execute')
     or has_function_privilege('authenticated', v_tick, 'execute') then
    raise exception '0862: live_together_tick is client-executable';
  end if;
  if not has_function_privilege('service_role', v_tick, 'execute') then
    raise exception '0862: the party worker cannot call live_together_tick';
  end if;

  if has_function_privilege('anon', v_stats, 'execute') then
    raise exception '0862: get_my_together_stats is callable signed out';
  end if;
  if not has_function_privilege('authenticated', v_stats, 'execute') then
    raise exception '0862: get_my_together_stats is not callable signed in';
  end if;

  foreach v_priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
    if has_table_privilege('anon', 'public.live_together_months', v_priv)
       or has_table_privilege('authenticated', 'public.live_together_months', v_priv) then
      raise exception '0862: a client can % live_together_months', v_priv;
    end if;
  end loop;
end $$;

commit;
