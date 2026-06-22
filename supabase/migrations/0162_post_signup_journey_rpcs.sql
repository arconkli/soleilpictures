-- 0162_post_signup_journey_rpcs.sql
--
-- Read/analysis layer for the high-resolution post-signup journey (client emits
-- live via lib/journey.js → public.analytics_events; no new table). Every ps_*
-- event carries the journey ENVELOPE in props:
--   { jid, seq, t_ms, phase, from_phase, tier, onb_seeded, onb_done, ad_pending,
--     boards, gcards, route }
-- plus the auto-merged session/device/source/exp_* from analytics.buildRow. A
-- single ORDER BY (props->>'seq')::bigint reconstructs each new user's exact,
-- ordered, timed path — from OTP-verify to first card, or the precise point they
-- froze and bounced (the LAST ps_pause/ps_heartbeat pins phase + idle_ms).
--
-- The PRIMARY consumption path is an AI running raw SQL via the privileged
-- connection (it bypasses the admin-only RLS on analytics_events). The RPCs below
-- + the convenience view are for the admin dashboard and for convenience; the raw
-- recipes are documented at the bottom of this file.
--
-- Like 0139, these tolerate an empty event stream (return empty/zeros, never
-- error) so they are safe to ship before any ps_* events exist. All are
-- security-definer + _require_admin()-gated, with internal-account exclusion via
-- _internal_session_ids() (session-keyed, so it also catches pre-auth rows).
--
-- jid coalesces to session_id::text when absent, so a plain (non-enveloped)
-- milestone row on the same session still stitches into the journey by session.

-- ── 1. Reconstruct ONE journey (the AI's raw material) ────────────────────────
-- Returns the full ordered trace for a jid, INCLUDING plain (non-enveloped)
-- events from the same session(s) so milestones (otp_verify, onboarding_first_card,
-- activated, …) interleave by time. Ordered by occurred_at so enveloped and plain
-- events stay chronological.
create or replace function public.admin_journey_reconstruct(
  p_jid text,
  p_exclude_internal boolean default true
) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  perform public._require_admin();
  with sess as (
    -- session(s) that carried this jid (so plain same-session events stitch in)
    select distinct e.session_id
    from public.analytics_events e
    where e.props->>'jid' = p_jid and e.session_id is not null
  ),
  ps as (
    select e.session_id, e.user_id, e.event, e.props, e.occurred_at,
           e.props->>'phase'                  as phase,
           nullif(e.props->>'seq','')::bigint  as seq,
           nullif(e.props->>'t_ms','')::bigint as t_ms
    from public.analytics_events e
    where (e.props->>'jid' = p_jid
           or coalesce(e.props->>'jid', e.session_id::text) = p_jid
           or e.session_id in (select session_id from sess))
      and (not p_exclude_internal or e.session_id is null
           or e.session_id not in (select session_id from public._internal_session_ids()))
  )
  select jsonb_build_object(
    'jid',      p_jid,
    'user_id',  (select max(user_id::text) from ps),
    't0_iso',   (select min(occurred_at) from ps),
    'last_iso', (select max(occurred_at) from ps),
    'n_events', (select count(*) from ps),
    -- back-fill the experiment arm from the latest row that carries it (early
    -- pre-seed rows may lack exp_*).
    'arm', (select p.props->>'exp_welcome_showcase' from ps p
              where p.props ? 'exp_welcome_showcase'
              order by p.occurred_at desc limit 1),
    'events', coalesce((
        select jsonb_agg(jsonb_build_object(
            'seq', seq, 't_ms', t_ms, 'phase', phase, 'event', event,
            'occurred_at', occurred_at, 'detail', props
          ) order by occurred_at, seq nulls last, t_ms)
        from ps), '[]'::jsonb)
  ) into v;
  return v;
end $$;

-- All journeys for one user (each as its own ordered trace; enveloped events only,
-- grouped by jid so distinct sessions don't bleed together).
create or replace function public.admin_journey_reconstruct_by_user(
  p_user_id uuid,
  p_exclude_internal boolean default true
) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  perform public._require_admin();
  with ps as (
    select e.event, e.props, e.occurred_at,
           e.props->>'jid'                     as jid,
           e.props->>'phase'                   as phase,
           nullif(e.props->>'seq','')::bigint  as seq,
           nullif(e.props->>'t_ms','')::bigint as t_ms
    from public.analytics_events e
    where e.user_id = p_user_id
      and e.props ? 'jid'
      and (not p_exclude_internal or e.session_id is null
           or e.session_id not in (select session_id from public._internal_session_ids()))
  ),
  per as (
    select jid,
           min(occurred_at) as t0_iso,
           count(*)         as n_events,
           jsonb_agg(jsonb_build_object(
             'seq', seq, 't_ms', t_ms, 'phase', phase, 'event', event,
             'occurred_at', occurred_at, 'detail', props
           ) order by seq nulls last, occurred_at, t_ms) as events
    from ps group by jid
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'jid', jid, 't0_iso', t0_iso, 'n_events', n_events, 'events', events
         ) order by t0_iso), '[]'::jsonb)
  into v from per;
  return v;
end $$;

-- ── 2. Drop-off histogram (the "exact moment they fell off") ──────────────────
-- Per phase: entered / advanced (continued past) / dropped (this was their LAST
-- phase) + p50/p90 time-to-phase-entry + median dwell-in-phase; plus the
-- last_phase_reached distribution and total journeys. Phase-entry = first
-- enveloped row for each (jid, phase). blocked/stuck are off-path side-states, so
-- "dropped" is literally the terminal phase per jid (last by entry time), which
-- naturally surfaces e.g. "N journeys ended in stuck".
create or replace function public.admin_journey_dropoff(
  p_days int default 30,
  p_exclude_internal boolean default true
) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  perform public._require_admin();
  with ps as (
    select coalesce(e.props->>'jid', e.session_id::text) as jid,
           e.props->>'phase'                   as phase,
           nullif(e.props->>'seq','')::bigint  as seq,
           nullif(e.props->>'t_ms','')::bigint as t_ms,
           e.occurred_at
    from public.analytics_events e
    where e.event like 'ps\_%' escape '\'
      and e.props ? 'phase'
      and e.occurred_at >= now() - make_interval(days => greatest(1, least(p_days, 365)))
      and (not p_exclude_internal or e.session_id is null
           or e.session_id not in (select session_id from public._internal_session_ids()))
  ),
  phase_entry as (
    select distinct on (jid, phase) jid, phase, t_ms as entry_t_ms, occurred_at, seq
    from ps where phase is not null
    order by jid, phase, seq nulls last, occurred_at
  ),
  jp as (
    select pe.*,
      lead(entry_t_ms) over (partition by jid order by entry_t_ms, seq nulls last) as next_t_ms,
      row_number() over (partition by jid order by entry_t_ms desc nulls last, seq desc nulls last) as rn_desc
    from phase_entry pe
  ),
  ord(phase, ordn) as (values
    ('signup',1),('boot',2),('tier_gate',3),('waitlist',4),('ad_welcome',5),
    ('app_enter',6),('seed',7),('coachmark',8),('first_intent',9),
    ('blocked',10),('stuck',11),('first_card',12),('nest',13),('populated',14)),
  per_phase as (
    select phase,
      count(*)                              as entered,
      count(*) filter (where rn_desc > 1)   as advanced,
      count(*) filter (where rn_desc = 1)   as dropped,
      percentile_cont(0.5) within group (order by entry_t_ms) as p50_entry_ms,
      percentile_cont(0.9) within group (order by entry_t_ms) as p90_entry_ms,
      percentile_cont(0.5) within group (order by (next_t_ms - entry_t_ms))
        filter (where next_t_ms is not null) as median_dwell_ms
    from jp group by phase
  ),
  last_phase as (
    select phase, count(*) as journeys from jp where rn_desc = 1 group by phase
  )
  select jsonb_build_object(
    'total_journeys', (select count(distinct jid) from ps),
    'phases', (select coalesce(jsonb_agg(jsonb_build_object(
         'phase', o.phase, 'ord', o.ordn,
         'entered',  coalesce(pp.entered, 0),
         'advanced', coalesce(pp.advanced, 0),
         'dropped',  coalesce(pp.dropped, 0),
         'p50_entry_ms',   round(pp.p50_entry_ms),
         'p90_entry_ms',   round(pp.p90_entry_ms),
         'median_dwell_ms', round(pp.median_dwell_ms)
       ) order by o.ordn), '[]'::jsonb)
       from ord o left join per_phase pp on pp.phase = o.phase),
    'last_phase_reached', (select coalesce(jsonb_object_agg(phase, journeys), '{}'::jsonb) from last_phase)
  ) into v;
  return v;
end $$;

-- ── 3. Phase-transition edges (Sankey-able) ───────────────────────────────────
create or replace function public.admin_journey_transitions(
  p_days int default 30,
  p_exclude_internal boolean default true
) returns table(from_phase text, to_phase text, journeys bigint)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform public._require_admin();
  return query
  with ps as (
    select coalesce(e.props->>'jid', e.session_id::text) as jid,
           e.props->>'phase'                   as phase,
           nullif(e.props->>'seq','')::bigint  as seq,
           nullif(e.props->>'t_ms','')::bigint as t_ms,
           e.occurred_at
    from public.analytics_events e
    where e.event like 'ps\_%' escape '\'
      and e.props ? 'phase'
      and e.occurred_at >= now() - make_interval(days => greatest(1, least(p_days, 365)))
      and (not p_exclude_internal or e.session_id is null
           or e.session_id not in (select session_id from public._internal_session_ids()))
  ),
  phase_entry as (
    select distinct on (jid, phase) jid, phase, t_ms as entry_t_ms, occurred_at, seq
    from ps where phase is not null
    order by jid, phase, seq nulls last, occurred_at
  ),
  edges as (
    select jid, phase as to_phase,
           lag(phase) over (partition by jid order by entry_t_ms, seq nulls last) as from_phase
    from phase_entry
  )
  select e.from_phase, e.to_phase, count(distinct e.jid)::bigint as journeys
  from edges e
  where e.from_phase is not null and e.from_phase <> e.to_phase
  group by e.from_phase, e.to_phase
  order by journeys desc;
end $$;

-- ── Convenience view for ad-hoc admin SQL (inherits analytics_events admin RLS) ─
create or replace view public.v_post_signup_events with (security_invoker = on) as
select e.id, e.session_id, e.user_id, e.event, e.occurred_at,
       coalesce(e.props->>'jid', e.session_id::text) as jid,
       nullif(e.props->>'seq','')::bigint  as seq,
       nullif(e.props->>'t_ms','')::bigint as t_ms,
       e.props->>'phase'      as phase,
       e.props->>'from_phase' as from_phase,
       e.props
from public.analytics_events e
where e.event like 'ps\_%' escape '\';

revoke all on function public.admin_journey_reconstruct(text, boolean)         from public;
revoke all on function public.admin_journey_reconstruct_by_user(uuid, boolean) from public;
revoke all on function public.admin_journey_dropoff(int, boolean)              from public;
revoke all on function public.admin_journey_transitions(int, boolean)          from public;
grant execute on function public.admin_journey_reconstruct(text, boolean)         to authenticated;
grant execute on function public.admin_journey_reconstruct_by_user(uuid, boolean) to authenticated;
grant execute on function public.admin_journey_dropoff(int, boolean)              to authenticated;
grant execute on function public.admin_journey_transitions(int, boolean)          to authenticated;

-- ── Raw-SQL recipes for AI analysis (run via the privileged connection) ───────
-- A) Reconstruct one journey, fully ordered:
--    select props->>'seq' seq, props->>'t_ms' t_ms, props->>'phase' phase, event,
--           occurred_at, props
--    from analytics_events
--    where coalesce(props->>'jid', session_id::text) = '<JID>'
--    order by occurred_at, (props->>'seq')::bigint nulls last;
--
-- B) Fall-off location (last phase reached per journey):
--    select last_phase, count(*) from (
--      select coalesce(props->>'jid', session_id::text) jid,
--             (array_agg(props->>'phase' order by (props->>'seq')::bigint desc nulls last))[1] last_phase
--      from analytics_events where event like 'ps\_%' escape '\' and props ? 'phase'
--      group by 1
--    ) t group by last_phase order by 2 desc;
--
-- C) Stall duration before a bounce (idle_ms on the terminal ps_pause/ps_heartbeat):
--    select coalesce(props->>'jid', session_id::text) jid, props->>'phase' phase,
--           max((props->>'idle_ms')::int) max_idle_ms
--    from analytics_events where event in ('ps_pause','ps_heartbeat')
--    group by 1, 2 order by 3 desc;
--
-- D) Seed-skip reasons (silent un-seeded landings):
--    select props->>'gate' gate, count(*) from analytics_events
--    where event = 'ps_seed_skip' group by 1 order by 2 desc;
--
-- E) Firehose: click/scroll/focus sequence just before a drop (unnest ps_trace):
--    select je->>'t' t_ms, je->>'k' kind, je->>'tgt' target
--    from analytics_events e, jsonb_array_elements(e.props->'ev') je
--    where e.event = 'ps_trace' and coalesce(e.props->>'jid', e.session_id::text) = '<JID>'
--    order by (je->>'t')::bigint;
