-- 0347 — work means work, and a visit means somebody did something.
--
-- (0341–0344 are reserved by the card-index derived-table spec,
-- docs/superpowers/specs/2026-09-29-card-index-derived-table-design.md, and
-- 0345/0346 by the 2026-10-01 conversion work. Hence the gap.)
--
-- Two instruments under every retention read were reporting habit that was not
-- there:
--
-- 1. user_active_day.did_work was stamped on every page load. The browser
--    upserts card_index (boardsApi.js syncCardIndex), and that function's
--    change-detection cache lives in memory and starts EMPTY on every load, so
--    the first sync after a board opens re-sends every card on it, unchanged.
--    The AFTER INSERT OR UPDATE trigger below fired once per no-op row and
--    marked the day as work — and it stamped the board's CREATOR, so a
--    collaborator merely opening someone's board gave the owner a work day.
--    "did_work" read as "opened a populated board".
--
--    The fix lives in the trigger only. Stamp on INSERT, or on an UPDATE that
--    changed something a person can see: kind, title, body, meta (which carries
--    x/y, so moving a card is still work), weight or board. Stamp whoever did it
--    (auth.uid()); fall back to the board's creator only when no session is
--    present (a service-role write). syncCardIndex itself is not touched here:
--    the derived-table spec owns it, and its Phase C makes a service-role
--    reconciler card_index's ONLY writer — once that lands, every write this
--    trigger sees is the reconciler's, and did_work must move to a source that
--    still knows the person (the WORK_EVENTS emitter, or the board_state path).
--
-- 2. _admin_visits (0322) counts a page load whose only events are app_open and
--    return_session as a visit. By the sixth visit most visits are exactly that,
--    and most of THOSE are long-lived tabs nobody touched (open for hours, zero
--    input). 0322 stays as it is — the deck reads it, and a page load is a real
--    fact. This adds an ENGAGED read beside it: a visit that holds input-credited
--    time (usage_session.active_seconds > 0) or a WORK_EVENTS event. Nothing that
--    exists is dropped or re-created, so nothing that calls it can break.
--
--    usage_session starts 2026-08-17. Before that a visit can only count as
--    engaged by holding a work event, so the engaged reads default to that date.
--    A second-screen reference wall (visible, never touched) is NOT engaged on
--    this definition; the client now reports visible_ms/focused_ms on
--    session_summary so that case can be measured on its own rather than
--    guessed at.

-- ── 1. did_work: only real changes, credited to whoever made them ──────────
create or replace function public._stamp_active_day_work()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor uuid;
begin
  if new.card_id like 'onb-%' then return new; end if;

  -- A re-sync that changed nothing a person can see is not work.
  if tg_op = 'UPDATE'
     and (new.kind, new.title, new.body, new.meta, new.weight, new.board_id)
         is not distinct from
         (old.kind, old.title, old.body, old.meta, old.weight, old.board_id) then
    return new;
  end if;

  -- The person who did it. The board's creator only when there is no session.
  v_actor := auth.uid();
  if v_actor is null then
    select b.created_by into v_actor from public.boards b where b.id = new.board_id;
  end if;
  v_actor := coalesce(v_actor,
    (select w.created_by from public.workspaces w where w.id = new.workspace_id));
  if v_actor is null then return new; end if;

  insert into public.user_active_day (user_id, day, did_work, work_ops)
    values (v_actor, current_date, true, 1)
    on conflict (user_id, day) do update
      set did_work = true,
          work_ops = public.user_active_day.work_ops + 1;
  return new;
end $$;

-- ── 2. The engaged visit ───────────────────────────────────────────────────
-- Every honest visit from 0322, with what happened in it. `engaged` = input-
-- credited time or a work event; `ek` numbers the engaged visits only, so
-- "engaged visit 2" means the second time the person actually did something.
-- The work list mirrors WORK_EVENTS in boards/src/lib/analyticsEvents.js;
-- engagedVisitsMigration.test.mjs fails if the two drift.
create function public._admin_engaged_visits(
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
                  'tag_set_type', 'comment_create'
                )
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

revoke execute on function public._admin_engaged_visits(date, boolean, boolean, int)
  from public, anon, authenticated;

comment on function public._admin_engaged_visits(date, boolean, boolean, int) is
  'Internal. Every _admin_visits row with active_s (input-credited usage_session '
  'seconds), worked (a WORK_EVENTS event inside the visit) and engaged (either). '
  'ek numbers the engaged visits only. usage_session starts 2026-08-17; before '
  'that only worked visits can be engaged. Not callable by clients.';

-- ── 3. Engaged fixed-horizon return ────────────────────────────────────────
-- 0322's fixed-horizon read, on engaged visits: of people whose first engaged
-- visit is at least the horizon old, how many made a second ENGAGED visit
-- inside it. Same dimensions as admin_return_fixed_horizon so the two can be
-- read side by side.
create function public.admin_engaged_return(
  p_since date default '2026-08-17',
  p_horizon_days int default 7,
  p_exclude_internal boolean default true,
  p_verified_only boolean default true,
  p_merge_hours int default 2,
  p_weeks int default 12
)
returns table (
  dim text,
  n int,
  returned int,
  pct numeric
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_since date := coalesce(p_since, '2026-08-17'::date);
  v_h int      := least(greatest(coalesce(p_horizon_days, 7), 1), 90);
  v_merge int  := least(greatest(coalesce(p_merge_hours, 2), 0), 12);
  v_weeks int  := least(greatest(coalesce(p_weeks, 12), 1), 52);
begin
  perform public._require_admin();

  return query
  with v as (
    select * from public._admin_engaged_visits(v_since, p_exclude_internal, p_verified_only, v_merge)
     where engaged
  ),
  ret as (
    select f.user_id, f.first_at, f.day,
           exists (
             select 1 from v v2
              where v2.user_id = f.user_id and v2.ek = 2
                and v2.first_at <= f.first_at + make_interval(days => v_h)
           ) as returned
      from v f
     where f.ek = 1
       and f.day <= current_date - v_h
  ),
  d1 as (
    select r.user_id, count(e.id)::int as cards
      from ret r
      join auth.users usr on usr.id = r.user_id
      left join public.analytics_events e
        on e.user_id = r.user_id
       and e.event = 'card_placed'
       and e.occurred_at < usr.created_at + interval '24 hours'
     group by r.user_id
  ),
  dev as (
    select r.user_id, mode() within group (order by e.props->>'device_type') as device
      from ret r
      join auth.users usr on usr.id = r.user_id
      join public.analytics_events e
        on e.user_id = r.user_id
       and e.props ? 'device_type'
       and e.occurred_at < usr.created_at + interval '24 hours'
     group by r.user_id
  ),
  src as (
    select r.user_id,
           case
             when p.first_source->>'referrer_host' ilike '%chatgpt%'
               or p.first_source->>'utm_source' in ('chatgpt.com', 'openai')          then 'chatgpt'
             when p.first_source->>'share_token' is not null
               or p.first_source->>'utm_source' in ('share_link', 'public_board')
               or p.first_source->>'landing_path' like '/share/%'                    then 'share'
             when p.first_source->>'landing_path' like '/vs/%'
               or p.first_source->>'landing_path' like '/best/%'
               or p.first_source->>'landing_path' like '/tools/%'                    then 'seo'
             when p.first_source->>'referrer_host' ilike '%google.%'                then 'google'
             when p.first_source->>'referrer_host' ilike '%reddit%'                 then 'reddit'
             when coalesce(p.first_source->>'referrer_host', '') = ''               then 'direct'
             else 'other'
           end as source
      from ret r
      left join public.profiles p on p.user_id = r.user_id
  ),
  rows_ as (
    select 'all'::text as dim, r.returned from ret r
    union all
    select 'device:' || coalesce(d.device, 'unknown'), r.returned
      from ret r left join dev d on d.user_id = r.user_id
    union all
    select 'source:' || s.source, r.returned
      from ret r join src s on s.user_id = r.user_id
    union all
    select 'band:' || case
             when c.cards = 0 then '0' when c.cards <= 2 then '1-2'
             when c.cards <= 5 then '3-5' when c.cards <= 12 then '6-12' else '13+' end,
           r.returned
      from ret r join d1 c on c.user_id = r.user_id
    union all
    select 'week:' || to_char(date_trunc('week', r.day), 'YYYY-MM-DD'), r.returned
      from ret r
     where r.day >= current_date - (7 * v_weeks)
  )
  select x.dim,
         count(*)::int,
         sum(x.returned::int)::int,
         round(sum(x.returned::int)::numeric / nullif(count(*), 0), 4)
    from rows_ x
   group by x.dim
   order by x.dim;
end $$;

revoke all on function public.admin_engaged_return(date, int, boolean, boolean, int, int)
  from public, anon;
grant execute on function public.admin_engaged_return(date, int, boolean, boolean, int, int)
  to authenticated;

comment on function public.admin_engaged_return(date, int, boolean, boolean, int, int) is
  'admin_return_fixed_horizon on ENGAGED visits (input-credited time or a work '
  'event): of first engaged visits at least p_horizon_days old, the share whose '
  'second engaged visit began inside the horizon, split the same ways. Defaults '
  'to 2026-08-17, the usage_session epoch. Admin only.';

-- ── 4. Engaged survival ────────────────────────────────────────────────────
-- P(engaged visit k+1 | engaged visit k), grace-censored per visit as 0279/0322
-- do: someone whose k-th engaged visit was yesterday has not failed yet.
create function public.admin_engaged_survival(
  p_since date default '2026-08-17',
  p_grace_days int default 14,
  p_max_visits int default 10,
  p_exclude_internal boolean default true,
  p_verified_only boolean default true,
  p_merge_hours int default 2
)
returns table (
  visit int,
  reached int,
  continued int,
  pct numeric
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_since date := coalesce(p_since, '2026-08-17'::date);
  v_grace int  := least(greatest(coalesce(p_grace_days, 14), 0), 365);
  v_max   int  := least(greatest(coalesce(p_max_visits, 10), 2), 60);
  v_merge int  := least(greatest(coalesce(p_merge_hours, 2), 0), 12);
begin
  perform public._require_admin();

  return query
  with v as (
    select * from public._admin_engaged_visits(v_since, p_exclude_internal, p_verified_only, v_merge)
     where engaged
  ),
  atrisk as (
    select v.ek, v.user_id,
           exists (select 1 from v v2 where v2.user_id = v.user_id and v2.ek = v.ek + 1) as continued
      from v
     where v.day <= current_date - v_grace
       and v.ek <= v_max
  )
  select a.ek,
         count(*)::int,
         sum(a.continued::int)::int,
         round(sum(a.continued::int)::numeric / nullif(count(*), 0), 4)
    from atrisk a
   group by a.ek
   order by a.ek;
end $$;

revoke all on function public.admin_engaged_survival(date, int, int, boolean, boolean, int)
  from public, anon;
grant execute on function public.admin_engaged_survival(date, int, int, boolean, boolean, int)
  to authenticated;

comment on function public.admin_engaged_survival(date, int, int, boolean, boolean, int) is
  'Conditional survival on ENGAGED visits: of people whose k-th engaged visit is '
  'at least p_grace_days old, the share who made a (k+1)-th. Admin only.';

-- ── 5. The "all the time" north star ───────────────────────────────────────
-- As of p_asof: among accounts at least 28 days old, how many held an engaged
-- visit in each number (0-4) of the four trailing 7-day windows. 'habitual' is
-- 3 or more of 4. pct is against every eligible account.
create function public.admin_engaged_weeks(
  p_asof date default current_date,
  p_since date default '2026-08-17',
  p_exclude_internal boolean default true,
  p_verified_only boolean default true,
  p_merge_hours int default 2
)
returns table (
  dim text,
  n int,
  pct numeric
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_asof  date := coalesce(p_asof, current_date);
  v_since date := coalesce(p_since, '2026-08-17'::date);
  v_merge int  := least(greatest(coalesce(p_merge_hours, 2), 0), 12);
begin
  perform public._require_admin();

  return query
  with eligible as (
    select usr.id as user_id
      from auth.users usr
     where usr.created_at >= v_since
       and usr.created_at < (v_asof - 28)::timestamptz
       and (not p_verified_only
            or (usr.email_confirmed_at is not null and usr.last_sign_in_at is not null))
       and (not p_exclude_internal
            or usr.id not in (select iu.user_id from public._internal_user_ids() iu))
  ),
  wk as (
    select el.user_id,
           count(distinct ((v_asof - 1 - v.day) / 7)) as weeks
      from eligible el
      join public._admin_engaged_visits(v_since, p_exclude_internal, p_verified_only, v_merge) v
        on v.user_id = el.user_id
       and v.engaged
       and v.day >= v_asof - 28
       and v.day < v_asof
     group by el.user_id
  ),
  per as (
    select el.user_id, coalesce(wk.weeks, 0)::int as weeks
      from eligible el left join wk on wk.user_id = el.user_id
  ),
  tot as (select count(*)::numeric as t from per),
  rows_ as (
    select 'eligible'::text as dim, count(*)::int as n from per
    union all
    select 'weeks:' || g.w, (select count(*)::int from per where per.weeks = g.w)
      from generate_series(0, 4) as g(w)
    union all
    select 'habitual', count(*)::int from per where per.weeks >= 3
  )
  select r.dim, r.n, round(r.n::numeric / nullif((select t from tot), 0), 4)
    from rows_ r;
end $$;

revoke all on function public.admin_engaged_weeks(date, date, boolean, boolean, int)
  from public, anon;
grant execute on function public.admin_engaged_weeks(date, date, boolean, boolean, int)
  to authenticated;

comment on function public.admin_engaged_weeks(date, date, boolean, boolean, int) is
  'The "all the time" north star. As of p_asof, among accounts at least 28 days '
  'old (signed up on or after p_since), the count holding an engaged visit in 0-4 '
  'of the four trailing 7-day windows; habitual = 3 or more of 4. Admin only.';

-- ── 6. Prove the grants (a REVOKE that reports success proves nothing) ────
do $$
begin
  if has_function_privilege('anon', 'public._admin_engaged_visits(date, boolean, boolean, int)', 'execute')
     or has_function_privilege('authenticated', 'public._admin_engaged_visits(date, boolean, boolean, int)', 'execute') then
    raise exception '0347: _admin_engaged_visits is callable by a client role';
  end if;
  if has_function_privilege('anon', 'public.admin_engaged_return(date, int, boolean, boolean, int, int)', 'execute')
     or not has_function_privilege('authenticated', 'public.admin_engaged_return(date, int, boolean, boolean, int, int)', 'execute') then
    raise exception '0347: admin_engaged_return grants are wrong';
  end if;
  if has_function_privilege('anon', 'public.admin_engaged_survival(date, int, int, boolean, boolean, int)', 'execute')
     or not has_function_privilege('authenticated', 'public.admin_engaged_survival(date, int, int, boolean, boolean, int)', 'execute') then
    raise exception '0347: admin_engaged_survival grants are wrong';
  end if;
  if has_function_privilege('anon', 'public.admin_engaged_weeks(date, date, boolean, boolean, int)', 'execute')
     or not has_function_privilege('authenticated', 'public.admin_engaged_weeks(date, date, boolean, boolean, int)', 'execute') then
    raise exception '0347: admin_engaged_weeks grants are wrong';
  end if;
  if has_function_privilege('anon', 'public._stamp_active_day_work()', 'execute') then
    raise exception '0347: _stamp_active_day_work is callable by anon';
  end if;
end $$;
