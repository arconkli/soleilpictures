-- 0475 — an import's clusters are the import's to record (the data-collection
-- pass, 2026-10-21).
--
-- Bulk import (0430) makes its clusters on the server, in
-- import_create_clusters, and the client logs import_job for them, never
-- cluster_create, which records a cluster someone made by hand. 0472 set every
-- board with a parent against cluster_create. No import has run in production
-- yet, so the two agreed; once bulk import opens there, one import of a dozen
-- folders inside 48 hours would read as cluster_create thinning to under half
-- its rate, and a person whose only clusters came from an import would read as
-- one the event missed.
--
-- (1) _instrumentation_pairs: the cluster_create pair leaves out the boards an
--     import made. import_folders names each one exactly, and 0440 purges it
--     only 45 days after its job last changed, well past the 16 days the check
--     reads (instrumentationCheck.test.mjs holds the two apart). The pair's
--     label says what it now counts.
--
-- (2) admin_event_coverage: first_cluster counts people, over a cohort that can
--     reach past that purge, so it keeps every cluster as the server's truth and
--     takes either event as the client's: cluster_create, or an import's start
--     ('cluster_made' in ev).
--
-- Both bodies are the live ones, 0472's byte for byte (md5-checked against
-- pg_proc before writing), with only those lines changed. create or replace
-- keeps both ACLs, which the proof at the end checks.


create or replace function public._instrumentation_pairs(p_at timestamptz default now())
returns table (
  pair         text,
  per_person   boolean,
  truth_label  text,
  event_label  text,
  since        timestamptz,
  truth_n      integer,
  truth_users  integer,
  ev_n         integer,
  base_truth_n integer,
  base_ev_n    integer
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with win as (
    select p_at - interval '48 hours' as since,
           p_at - interval '16 days'  as base_since,
           d.d_since, d.d_base, d.d_until,
           d.d_since::timestamp at time zone 'UTC' as t_since,
           d.d_base::timestamp  at time zone 'UTC' as t_base
      from (select ((p_at - interval '48 hours') at time zone 'UTC')::date as d_since,
                   ((p_at - interval '16 days')  at time zone 'UTC')::date as d_base,
                   (p_at at time zone 'UTC')::date                         as d_until) d
  ),
  internal as (select i.user_id from public._internal_user_ids() i),
  labels (pair, per_person, truth_label, event_label, ord) as (values
    ('active',          true,  'People active in the app (the heartbeat)',               'with any event',                                         1),
    ('session_context', true,  'People active in the app (the heartbeat)',               'with a session_context row',                             2),
    ('first_card',      true,  'People whose first card landed (profiles.first_card_at)', 'with onboarding_first_card within a day of it',         3),
    ('cluster_create',  false, 'Clusters made by hand (boards with a parent, none from an import)', 'cluster_create events',                    4),
    ('msg_send',        false, 'Messages sent (messages, kind user)',                    'msg_send events with ok',                                5),
    ('import_job',      false, 'Imports started (import_jobs)',                          'import_job events with phase start',                     6),
    ('link_claim',      false, 'Workspace joins through an invite link',                 'workspace_link_claim_result events with status joined', 7)
  ),

  -- People. The heartbeat writes user_active_day for auth.uid() only (0470),
  -- by day, so these windows run from midnight UTC.
  act as (
    select d.user_id,
           bool_or(d.day >= w.d_since) as recent,
           bool_or(d.day <  w.d_since) as base
      from public.user_active_day d cross join win w
     where d.day between w.d_base and w.d_until
       and not exists (select 1 from internal i where i.user_id = d.user_id)
     group by d.user_id
  ),
  people as (
    select 'active'::text as pair, a.recent, a.base,
           a.recent and exists (select 1 from public.analytics_events e
                                 where e.user_id = a.user_id
                                   and e.occurred_at >= w.t_since and e.occurred_at < p_at) as ev_recent,
           a.base and exists (select 1 from public.analytics_events e
                               where e.user_id = a.user_id
                                 and e.occurred_at >= w.t_base and e.occurred_at < w.t_since) as ev_base
      from act a cross join win w
    union all
    select 'session_context', a.recent, a.base,
           a.recent and exists (select 1 from public.analytics_events e
                                 where e.user_id = a.user_id and e.event = 'session_context'
                                   and e.occurred_at >= w.t_since and e.occurred_at < p_at),
           a.base and exists (select 1 from public.analytics_events e
                               where e.user_id = a.user_id and e.event = 'session_context'
                                 and e.occurred_at >= w.t_base and e.occurred_at < w.t_since)
      from act a cross join win w
    union all
    -- The server's stamp against the client's event, within a day of it
    -- either way, since occurred_at is the device's clock.
    select 'first_card', f.recent, not f.recent, f.recent and f.has_ev, (not f.recent) and f.has_ev
      from (select p.first_card_at >= w.since as recent,
                   exists (select 1 from public.analytics_events e
                            where e.user_id = p.user_id and e.event = 'onboarding_first_card'
                              and e.occurred_at between p.first_card_at - interval '1 day'
                                                    and p.first_card_at + interval '1 day') as has_ev
              from public.profiles p cross join win w
             where p.first_card_at >= w.base_since and p.first_card_at < p_at
               and not exists (select 1 from internal i where i.user_id = p.user_id)) f
  ),
  people_counts as (
    select x.pair,
           count(*) filter (where x.recent)::int    as truth_n,
           count(*) filter (where x.ev_recent)::int as ev_n,
           count(*) filter (where x.base)::int      as base_truth_n,
           count(*) filter (where x.ev_base)::int   as base_ev_n
      from people x
     group by x.pair
  ),

  -- Rows: what the activity left behind, against the events that say it happened.
  rows_truth as (
    select 'cluster_create'::text as pair, b.created_by as uid, b.created_at >= w.since as recent
      from public.boards b cross join win w
     where b.parent_board_id is not null and b.created_by is not null
       and b.created_at >= w.base_since and b.created_at < p_at
       and not exists (select 1 from internal i where i.user_id = b.created_by)
       -- An import makes its own clusters and logs import_job for them (0475).
       and not exists (select 1 from public.import_folders f where f.board_id = b.id)
    union all
    select 'msg_send', m.sender_id, m.created_at >= w.since
      from public.messages m cross join win w
     where m.kind = 'user' and m.sender_id is not null
       and m.created_at >= w.base_since and m.created_at < p_at
       and not exists (select 1 from internal i where i.user_id = m.sender_id)
    union all
    select 'import_job', j.owner_id, j.created_at >= w.since
      from public.import_jobs j cross join win w
     where j.owner_id is not null
       and j.created_at >= w.base_since and j.created_at < p_at
       and not exists (select 1 from internal i where i.user_id = j.owner_id)
    union all
    select 'link_claim', l.user_id, l.joined_at >= w.since
      from public.workspace_invite_link_joins l cross join win w
     where l.user_id is not null
       and l.joined_at >= w.base_since and l.joined_at < p_at
       and not exists (select 1 from internal i where i.user_id = l.user_id)
  ),
  truth_counts as (
    select t.pair,
           count(*) filter (where t.recent)::int              as truth_n,
           count(distinct t.uid) filter (where t.recent)::int as truth_users,
           count(*) filter (where not t.recent)::int          as base_truth_n
      from rows_truth t
     group by t.pair
  ),
  event_counts as (
    select k.pair,
           count(*) filter (where k.recent)::int     as ev_n,
           count(*) filter (where not k.recent)::int as base_ev_n
      from (select case
                     when e.event = 'cluster_create' then 'cluster_create'
                     when e.event = 'msg_send' and e.props->>'ok' = 'true' then 'msg_send'
                     when e.event = 'import_job' and e.props->>'phase' = 'start' then 'import_job'
                     when e.event = 'workspace_link_claim_result' and e.props->>'status' = 'joined' then 'link_claim'
                   end as pair,
                   e.occurred_at >= w.since as recent
              from public.analytics_events e cross join win w
             where e.event in ('cluster_create', 'msg_send', 'import_job', 'workspace_link_claim_result')
               and e.occurred_at >= w.base_since and e.occurred_at < p_at
               and e.user_id is not null
               and not exists (select 1 from internal i where i.user_id = e.user_id)) k
     where k.pair is not null
     group by k.pair
  )
  select l.pair, l.per_person, l.truth_label, l.event_label,
         case when l.pair in ('active', 'session_context') then w.t_since else w.since end,
         coalesce(pc.truth_n, tc.truth_n, 0),
         coalesce(pc.truth_n, tc.truth_users, 0),
         coalesce(pc.ev_n, ec.ev_n, 0),
         coalesce(pc.base_truth_n, tc.base_truth_n, 0),
         coalesce(pc.base_ev_n, ec.base_ev_n, 0)
    from labels l
    cross join win w
    left join people_counts pc on pc.pair = l.pair
    left join truth_counts  tc on tc.pair = l.pair
    left join event_counts  ec on ec.pair = l.pair
   order by l.ord;
$$;

create or replace function public.admin_event_coverage(p_days integer default 90, p_exclude_internal boolean default true, p_verified_only boolean default true)
returns table(milestone text, server_truth integer, client_event integer, coverage_pct numeric)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare v_since timestamptz;
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 36500));
  v_since := now() - (p_days || ' days')::interval;
  return query
  with eligible as (
    select u.id as uid from auth.users u
     where (not p_verified_only or (u.id in (select ec.entered_id from public._admin_entered_code() ec)))
       and u.created_at >= v_since
       and (not p_exclude_internal or u.id not in (select iu.user_id from public._internal_user_ids() iu))
  ),
  prof as (select p.* from public.profiles p where p.user_id in (select uid from eligible)),
  -- An event by its name, or name:value for the rows that count one outcome
  -- of it (0472).
  ev as (
    select case
             when event = 'msg_send' and props->>'ok' = 'true' then 'msg_send:ok'
             when event = 'import_job' and props->>'phase' = 'start' then 'import_job:start'
             when event = 'workspace_link_claim_result' and props->>'status' = 'joined'
               then 'workspace_link_claim_result:joined'
             else event
           end as event,
           count(distinct user_id) as users
      from public.analytics_events
     where user_id in (select uid from eligible) and occurred_at >= v_since
     group by 1
    union all
    -- 0475: a cluster made either way, by hand (cluster_create) or by an import
    -- (its start), so a person whose clusters all came from an import counts.
    select 'cluster_made', count(distinct user_id)
      from public.analytics_events
     where user_id in (select uid from eligible) and occurred_at >= v_since
       and (event = 'cluster_create' or (event = 'import_job' and props->>'phase' = 'start'))
  ),
  m as (
    select 'first_card'::text as milestone,
           (select count(*) from prof where first_card_at is not null)::int as server_truth,
           'onboarding_first_card'::text as ev_name
    union all
    select 'populated_board',
           (select count(*) from prof where first_populated_board_at is not null)::int, 'activated'
    union all
    select 'first_share',
           (select count(*) from prof where first_share_at is not null)::int, 'share_open'
    union all
    select 'first_paid',
           (select count(*) from prof where first_paid_at is not null)::int, 'checkout_success'
    union all
    -- 0472: the features shipping with the sidebar release, per person.
    select 'first_cluster',
           (select count(distinct b.created_by) from public.boards b
             where b.created_by in (select uid from eligible) and b.parent_board_id is not null)::int,
           'cluster_made'
    union all
    select 'first_message',
           (select count(distinct ms.sender_id) from public.messages ms
             where ms.sender_id in (select uid from eligible) and ms.kind = 'user')::int,
           'msg_send:ok'
    union all
    select 'first_import',
           (select count(distinct ij.owner_id) from public.import_jobs ij
             where ij.owner_id in (select uid from eligible))::int,
           'import_job:start'
    union all
    select 'joined_by_link',
           (select count(distinct lj.user_id) from public.workspace_invite_link_joins lj
             where lj.user_id in (select uid from eligible))::int,
           'workspace_link_claim_result:joined'
  )
  select m.milestone, m.server_truth,
         coalesce((select e.users from ev e where e.event = m.ev_name), 0)::int as client_event,
         round(coalesce((select e.users from ev e where e.event = m.ev_name), 0)::numeric
               / nullif(m.server_truth, 0), 4) as coverage_pct
    from m
   order by m.milestone;
end $function$;

-- ── Proof ───────────────────────────────────────────────────────────────────
do $proof$
declare
  v_n     integer;
  v_label text;
  v_truth integer;
begin
  -- The 0311 habit: create or replace kept each ACL; prove it, don't trust it.
  if has_function_privilege('anon', 'public._instrumentation_pairs(timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public._instrumentation_pairs(timestamptz)', 'execute')
     or not has_function_privilege('service_role', 'public._instrumentation_pairs(timestamptz)', 'execute') then
    raise exception '0475: _instrumentation_pairs is not service_role''s alone';
  end if;
  if has_function_privilege('anon', 'public.admin_event_coverage(integer, boolean, boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.admin_event_coverage(integer, boolean, boolean)', 'execute') then
    raise exception '0475: admin_event_coverage grants moved';
  end if;

  -- It took: seven pairs, cluster_create under its new label, counting exactly
  -- the boards with a parent that no import made, over the same 48 hours.
  select count(*)::int,
         max(truth_label) filter (where pair = 'cluster_create'),
         max(truth_n) filter (where pair = 'cluster_create')
    into v_n, v_label, v_truth
    from public._instrumentation_pairs(now());
  if v_n <> 7 or v_label is distinct from 'Clusters made by hand (boards with a parent, none from an import)' then
    raise exception '0475: _instrumentation_pairs did not take (% pairs, label %)', v_n, v_label;
  end if;
  if v_truth <> (select count(*)::int from public.boards b
                  where b.parent_board_id is not null and b.created_by is not null
                    and b.created_at >= now() - interval '48 hours' and b.created_at < now()
                    and not exists (select 1 from public._internal_user_ids() i where i.user_id = b.created_by)
                    and not exists (select 1 from public.import_folders f where f.board_id = b.id)) then
    raise exception '0475: cluster_create''s truth is not the hand-made clusters (%)', v_truth;
  end if;

  if (select p.prosrc from pg_proc p
       where p.oid = 'public.admin_event_coverage(integer, boolean, boolean)'::regprocedure)
     not like '%select ''cluster_made'', count(distinct user_id)%' then
    raise exception '0475: admin_event_coverage did not take';
  end if;
end $proof$;
