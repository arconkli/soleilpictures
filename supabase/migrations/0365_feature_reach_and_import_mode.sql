-- 0365 — two reads for the product-education pass (2026-10-06).
--
-- The pass tested "people don't come back because they don't know how much
-- Clusters can do". Day-one breadth did not predict return inside any depth
-- band; what did line up every directional signal was HOW the day-one material
-- arrived: a board placed by hand, card by card, versus one that landed in a
-- burst (a folder drop, a multi-file pick, an import). Neither existing read
-- can show that, and nothing reports which features a signup week has reached
-- by day fourteen — the quantity the Help menu and the hints (0366+) exist to
-- move. Both are new functions: 0322's visit helper and RPCs stay 0322's
-- (retentionVisitsMigration.test.mjs pins their bodies on purpose).
--
-- Not done here, deliberately: dropping tab-restore visits (an app_open with
-- restored:true and nothing else) from _admin_visits. They inflate the
-- any-visit read at visit five and beyond, but the engaged and built reads
-- (0347, 0361) already exclude them — no active seconds, no work — and those
-- are the headline. The any-visit panel keeps its 0322 meaning and its caveat.
--
-- 1. admin_feature_reach — per signup week, among people who placed at least
--    one genuine card inside two weeks: the share that touched each feature on
--    day one, and the share that had touched it by day fourteen (only cohorts
--    old enough to have answered count toward the fourteen-day column).
--    Reach, not lift: admin_feature_adoption already prints the association
--    with return, and its own panel says why that must not be read as cause.
-- 2. admin_return_by_mode — the fixed-horizon return (any / engaged / built)
--    split by import mode. burst = at least half of the day-one placements
--    arrived inside two seconds of the previous one, where a batch event
--    (card_placed with n > 1) is n placements landing at once. Day one is the
--    first 24 hours after signup, as in 0322 and 0361, so the band column
--    matches theirs.

-- ── 1. admin_feature_reach ─────────────────────────────────────────────────
create or replace function public.admin_feature_reach(
  p_since date default '2026-08-17'::date,
  p_weeks int default 12,
  p_exclude_internal boolean default true,
  p_verified_only boolean default true
) returns table(cohort text, feature text, n int, d1 int, d14_n int, d14 int)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_since date := coalesce(p_since, '2026-08-17'::date);
  v_weeks int  := least(greatest(coalesce(p_weeks, 12), 1), 52);
begin
  perform public._require_admin();

  return query
  with u as (
    select usr.id as user_id, usr.created_at
      from auth.users usr
     where usr.created_at >= greatest(v_since, current_date - (7 * v_weeks))
       -- a day-one window still open cannot be read
       and usr.created_at <= now() - interval '24 hours'
       and (not p_verified_only
            or (usr.email_confirmed_at is not null and usr.last_sign_in_at is not null))
       and (not p_exclude_internal
            or usr.id not in (select iu.user_id from public._internal_user_ids() iu))
  ),
  -- The cohort: placed something real within two weeks. Reach among people
  -- who never placed a card is reach among people who never saw the canvas.
  placed as (
    select u.user_id, u.created_at
      from u
     where exists (
       select 1 from public.analytics_events e
        where e.user_id = u.user_id
          and e.event = 'card_placed'
          and coalesce(e.props->>'actor', 'user') not in ('seed', 'template', 'system')
          and e.occurred_at >= u.created_at
          and e.occurred_at <  u.created_at + interval '14 days'
     )
  ),
  feat(feature, event, kinds, view_eq) as (values
    ('list_view',   'list_browser_view',   null::text[],                                  null::text),
    ('list_view',   'view_mode_switch',    null,                                          'list'),
    ('writing',     'card_placed',         array['note', 'doc'],                          null),
    ('doc',         'doc_edit',            null,                                          null),
    ('doc',         'card_placed',         array['doc'],                                  null),
    ('grid',        'card_placed',         array['grid'],                                 null),
    ('cluster',     'card_placed',         array['board'],                                null),
    ('cluster',     'cluster_create',      null,                                          null),
    ('files_links', 'card_placed',         array['pdf', 'video', 'audio', 'file', 'link'], null),
    ('import',      'import_batch',        null,                                          null),
    ('share',       'share_open',          null,                                          null),
    ('share',       'share_link_created',  null,                                          null),
    ('share',       'share_link_copied',   null,                                          null),
    ('share',       'invite_sent',         null,                                          null),
    ('share',       'invite_link_created', null,                                          null),
    ('search',      'search_run',          null,                                          null),
    ('download',    'file_download',       null,                                          null),
    ('arrows',      'arrow_created',       null,                                          null),
    ('comments',    'comment_create',      null,                                          null),
    ('tags',        'tag_manual_apply',    null,                                          null),
    ('tags',        'tag_confirm',         null,                                          null),
    ('tags',        'tag_set_type',        null,                                          null),
    ('tags',        'tag_candidate_promote', null,                                        null),
    -- the education surfaces this read exists to grade (catalogued in
    -- boards/src/lib/analyticsEvents.js; zero until their client ships)
    ('help',        'help_open',           null,                                          null),
    ('docs_site',   'docs_open',           null,                                          null)
  ),
  hits as (
    select p.user_id, f.feature, min(e.occurred_at) as first_at
      from placed p
      join public.analytics_events e
        on e.user_id = p.user_id
       and e.occurred_at >= p.created_at
       and e.occurred_at <  p.created_at + interval '14 days'
      join feat f
        on f.event = e.event
       and (f.kinds is null or e.props->>'kind' = any (f.kinds))
       and (f.view_eq is null or e.props->>'view' = f.view_eq)
     group by p.user_id, f.feature
  ),
  -- A second cluster is the second project; card_placed{kind:'board'} is the
  -- durable record of a cluster being made (cluster_create only says which door).
  second as (
    select x.user_id, 'second_cluster'::text as feature, min(x.occurred_at) as first_at
      from (
        select p.user_id, e.occurred_at,
               row_number() over (partition by p.user_id order by e.occurred_at) as rn
          from placed p
          join public.analytics_events e
            on e.user_id = p.user_id
           and e.event = 'card_placed'
           and e.props->>'kind' = 'board'
           and coalesce(e.props->>'actor', 'user') not in ('seed', 'template', 'system')
           and e.occurred_at >= p.created_at
           and e.occurred_at <  p.created_at + interval '14 days'
      ) x
     where x.rn = 2
     group by x.user_id
  ),
  allhits as (select * from hits union all select * from second),
  features as (select distinct f.feature from feat f union all select 'second_cluster'),
  cohorts as (
    select p.user_id, p.created_at, 'all'::text as cohort from placed p
    union all
    select p.user_id, p.created_at, to_char(date_trunc('week', p.created_at), 'YYYY-MM-DD') from placed p
  ),
  joined as (
    select c.cohort, fe.feature, c.user_id,
           (c.created_at <= now() - interval '14 days') as matured,
           (h.first_at is not null and h.first_at < c.created_at + interval '24 hours') as on_d1,
           (h.first_at is not null) as by_d14
      from cohorts c
      cross join features fe
      left join allhits h on h.user_id = c.user_id and h.feature = fe.feature
  )
  select j.cohort, j.feature,
         count(distinct j.user_id)::int,
         count(distinct j.user_id) filter (where j.on_d1)::int,
         count(distinct j.user_id) filter (where j.matured)::int,
         count(distinct j.user_id) filter (where j.matured and j.by_d14)::int
    from joined j
   group by j.cohort, j.feature
   order by j.cohort, j.feature;
end $$;

revoke all on function public.admin_feature_reach(date, int, boolean, boolean)
  from public, anon;
grant execute on function public.admin_feature_reach(date, int, boolean, boolean)
  to authenticated;

comment on function public.admin_feature_reach(date, int, boolean, boolean) is
  'Per signup week (and pooled as cohort=all), among people who placed a genuine '
  'card within 14 days of signup: how many touched each feature on day one (d1) '
  'and, of those old enough to answer (d14_n), by day fourteen (d14). Reach, not '
  'lift — see admin_feature_adoption for the association with return. Admin only.';

-- ── 2. admin_return_by_mode ────────────────────────────────────────────────
create or replace function public.admin_return_by_mode(
  p_since date default '2026-08-17'::date,
  p_horizon_days int default 7,
  p_measure text default 'any',
  p_exclude_internal boolean default true,
  p_verified_only boolean default true,
  p_merge_hours int default 2
) returns table(dim text, n int, returned int, pct numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_since   date := coalesce(p_since, '2026-08-17'::date);
  v_h       int  := least(greatest(coalesce(p_horizon_days, 7), 1), 90);
  v_merge   int  := least(greatest(coalesce(p_merge_hours, 2), 0), 12);
  v_measure text := case when p_measure in ('any', 'engaged', 'built') then p_measure else 'any' end;
begin
  perform public._require_admin();

  return query
  with v as (
    select * from public._admin_engaged_visits(v_since, p_exclude_internal, p_verified_only, v_merge)
  ),
  -- Same at-risk set as 0322/0361: first visits at least the horizon old.
  -- 'any' = a later visit began inside the window (0322); 'engaged' = one that
  -- held input or work (0347); 'built' = one that held work (0361).
  ret as (
    select f.user_id, f.first_at, f.day,
           exists (
             select 1 from v v2
              where v2.user_id = f.user_id and v2.k >= 2
                and v2.first_at <= f.first_at + make_interval(days => v_h)
                and case v_measure
                      when 'built'   then v2.worked
                      when 'engaged' then v2.engaged
                      else true
                    end
           ) as returned
      from v f
     where f.k = 1
       and f.day <= current_date - v_h
  ),
  -- Day-one placements in order, each with the gap to the one before. A batch
  -- event (n > 1) is n placements landing in the same instant.
  pl as (
    select r.user_id,
           case when e.props->>'n' ~ '^[0-9]{1,6}$' then greatest((e.props->>'n')::int, 1) else 1 end as n,
           e.occurred_at - lag(e.occurred_at) over (partition by r.user_id order by e.occurred_at) as gap
      from ret r
      join auth.users usr on usr.id = r.user_id
      join public.analytics_events e
        on e.user_id = r.user_id
       and e.event = 'card_placed'
       and coalesce(e.props->>'actor', 'user') not in ('seed', 'template', 'system')
       and e.occurred_at < usr.created_at + interval '24 hours'
  ),
  mode_ as (
    select r.user_id,
           coalesce(sum(p.n), 0)::int as cards,
           case
             when coalesce(sum(p.n), 0) = 0 then 'none'
             when sum(case when p.n > 1 then p.n
                           when p.gap is not null and p.gap <= interval '2 seconds' then 1
                           else 0 end)::numeric / nullif(sum(p.n), 0) >= 0.5 then 'burst'
             else 'hand'
           end as mode
      from ret r
      left join pl p on p.user_id = r.user_id
     group by r.user_id
  ),
  rows_ as (
    select 'all'::text as dim, r.returned from ret r
    union all
    select 'mode:' || m.mode, r.returned
      from ret r join mode_ m on m.user_id = r.user_id
    union all
    select 'band:' || case
             when m.cards = 0 then '0' when m.cards <= 2 then '1-2'
             when m.cards <= 5 then '3-5' when m.cards <= 12 then '6-12' else '13+' end,
           r.returned
      from ret r join mode_ m on m.user_id = r.user_id
    union all
    select 'mode_band:' || case when m.cards <= 2 then '0-2' when m.cards <= 12 then '3-12' else '13+' end
             || ' · ' || m.mode,
           r.returned
      from ret r join mode_ m on m.user_id = r.user_id
     where m.cards > 0
  )
  select x.dim,
         count(*)::int,
         sum(x.returned::int)::int,
         round(sum(x.returned::int)::numeric / nullif(count(*), 0), 4)
    from rows_ x
   group by x.dim
   order by x.dim;
end $$;

revoke all on function public.admin_return_by_mode(date, int, text, boolean, boolean, int)
  from public, anon;
grant execute on function public.admin_return_by_mode(date, int, text, boolean, boolean, int)
  to authenticated;

comment on function public.admin_return_by_mode(date, int, text, boolean, boolean, int) is
  'Fixed-horizon return (p_measure any|engaged|built, as 0322/0347/0361) split by '
  'day-one import mode: hand (placed card by card), burst (at least half of the '
  'placements within two seconds of the previous one, batch events counting as '
  'their n), none. Also by band and band × mode. Admin only.';

-- ── 3. Proofs (0311 habit) ─────────────────────────────────────────────────
do $proof$
declare
  f text;
begin
  foreach f in array array['public.admin_feature_reach(date, integer, boolean, boolean)',
                           'public.admin_return_by_mode(date, integer, text, boolean, boolean, integer)'] loop
    if has_function_privilege('anon', f, 'execute') then raise exception '% is executable by anon', f; end if;
    if not has_function_privilege('authenticated', f, 'execute') then raise exception '% is not executable by authenticated', f; end if;
  end loop;
end $proof$;
