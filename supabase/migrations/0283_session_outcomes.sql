-- 0283 — the read side of session_summary.
--
-- The event ships with its reader. An emitter without a query is the same
-- failure this repo has already paid for once: a panel that fetches an RPC with
-- no fixture and renders nothing looks exactly like a panel that was never
-- built, and it survived a production promotion that way. A new event with
-- nowhere to read it is that shape with the halves swapped.
--
-- The question it answers is the literal 1->2 question: does the session
-- somebody has just finished look different when they come back than when they
-- do not? ps_* cannot answer it (it covers a new user's FIRST session and
-- closes at activation) and usage_session cannot either (per-surface seconds,
-- no outcome, no ordinal).
--
-- TWO THINGS IT HAS TO GET RIGHT
--
-- 1. ONE ROW PER SESSION. A session that is hidden and then resumed without
--    rotating emits a second, later, more complete row for the same
--    of_session. distinct on (of_session) ... order by occurred_at desc keeps
--    the last. Counting both would count the session twice AND under-report its
--    length on the earlier row.
--
-- 2. A THIN RESULT MUST READ AS YOUNG, NOT AS EMPTY. `since` is the first day
--    the event ever fired, returned on every row, so the panel can say
--    "collecting since <date>" instead of drawing a convincing zero. This table
--    starts the day the event ships and there is no backfill -- the exact trap
--    0277 had to write into two table comments.

create or replace function public.admin_session_outcomes(
  p_days int default 90,
  p_exclude_internal boolean default true
)
returns table (
  bucket text,
  ord int,
  sessions int,
  returned_after int,
  users int,
  since date
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_days int := least(greatest(coalesce(p_days, 90), 1), 3650);
  v_since date;
begin
  perform public._require_admin();

  select min(e.occurred_at)::date into v_since
    from public.analytics_events e where e.event = 'session_summary';

  return query
  with rows_ as (
    select e.user_id,
           e.props->>'of_session' as of_session,
           e.occurred_at,
           coalesce((e.props->>'ms_span')::bigint, 0) as ms_span,
           coalesce((e.props->>'cards_placed')::int, 0) as cards,
           (e.props->>'wrote')::boolean as wrote
      from public.analytics_events e
     where e.event = 'session_summary'
       and e.occurred_at >= now() - (v_days || ' days')::interval
       and e.user_id is not null
       and e.props->>'of_session' is not null
       and (not p_exclude_internal
            or e.user_id not in (select iu.user_id from public._internal_user_ids() iu))
  ),
  -- A session hidden and later resumed emits a second, more complete row for
  -- the same of_session. The last one supersedes; taking them all would count
  -- one session twice and under-report its length both times.
  last_per as (
    select distinct on (r.of_session) r.*
      from rows_ r
     order by r.of_session, r.occurred_at desc
  ),
  scored as (
    select l.*,
           exists (
             select 1 from public.user_active_day a
              where a.user_id = l.user_id
                and a.day > l.occurred_at::date
           ) as came_back
      from last_per l
  ),
  binned as (
    select s.*,
           case when s.ms_span < 60000 then 'under a minute'
                when s.ms_span < 300000 then '1-5 min'
                when s.ms_span < 900000 then '5-15 min'
                when s.ms_span < 3600000 then '15-60 min'
                else 'over an hour' end as bucket,
           case when s.ms_span < 60000 then 1
                when s.ms_span < 300000 then 2
                when s.ms_span < 900000 then 3
                when s.ms_span < 3600000 then 4
                else 5 end as ord
      from scored s
  )
  select b.bucket, b.ord,
         count(*)::int,
         count(*) filter (where b.came_back)::int,
         count(distinct b.user_id)::int,
         v_since
    from binned b
   group by b.bucket, b.ord
   order by b.ord;
end $$;

revoke all on function public.admin_session_outcomes(int, boolean) from public, anon;
grant execute on function public.admin_session_outcomes(int, boolean) to authenticated;

comment on function public.admin_session_outcomes(int, boolean) is
  'Sessions bucketed by length, against whether that user was active on any '
  'LATER day. The read side of the session_summary event, which exists because '
  'ps_* covers only a new user''s first session and nothing summarised the '
  'session preceding visit two — the transition where nearly all the loss is. '
  'Takes the LAST row per of_session: a session hidden and resumed emits a '
  'second, more complete row, and counting both would double-count the session '
  'and under-report its length twice. `since` is the first day the event ever '
  'fired, so a thin result reads as young instrumentation rather than as no '
  'sessions. Admin only.';
