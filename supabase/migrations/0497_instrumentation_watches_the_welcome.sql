-- 0497 — The daily instrumentation check watches the welcome email too.
--
-- From 2026-09-06 to 09-16 no welcome email went out while accounts kept
-- coming due it, and nothing said so: the Emails tab shows the gap now, but
-- only to someone looking. check_instrumentation() (0472) already pages when
-- an activity's record stops arriving, so the welcome becomes one more pair.
--
--   truth  accounts due the welcome, by lifecycle_due_welcome_board's own
--          rule: a confirmed address, not banned, not the team, the
--          lifecycle emails left on, an unsubscribe token, and a cluster of
--          their own with a picture and cards;
--   record of them, the ones lifecycle_email_log says were sent it.
--
-- An account is due 12 to 72 hours after signing up and then waits up to a
-- day for its send hour, so the recent cohort is the accounts that signed up
-- 36 to 108 hours before the check: each has had every chance to be sent it,
-- and three days of signups reach the check's floor of three people sooner
-- than two would. The base is the 14 days of signups before that. Run over
-- every day since 2026-07-20 against the live data, this pair would have paged
-- on each day from 09-12 to 09-16 that met that floor, and on no other day,
-- and the stall never read as thinning.
--
-- The paging rule is 0472's, unchanged. Only the words differ for this pair:
-- its alert names the welcome and points at the lifecycle cron, since an
-- email that stops is not a log call that went missing.
--
-- Both bodies are the live ones (0475's _instrumentation_pairs, 0472's
-- check_instrumentation; md5-checked against pg_proc before writing) with
-- only those lines changed. create or replace keeps both ACLs, which the
-- proof checks.

begin;

set local lock_timeout = '3s';

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
           p_at - interval '108 hours' as wl_since,
           p_at - interval '36 hours'  as wl_until,
           p_at - interval '108 hours' - interval '14 days' as wl_base,
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
    ('link_claim',      false, 'Workspace joins through an invite link',                 'workspace_link_claim_result events with status joined', 7),
    ('welcome',         true,  'Accounts due the welcome email, signed up 36 to 108 hours before', 'sent it (lifecycle_email_log)',           8)
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
    union all
    -- The welcome (0497): who lifecycle_due_welcome_board would have found,
    -- against the log's sent rows. Due 12 to 72 hours after signing up, then
    -- up to a day for the send hour, so the cohort ends 36 hours back.
    select 'welcome', wl.recent, not wl.recent, wl.recent and wl.sent, (not wl.recent) and wl.sent
      from (select u.created_at >= w.wl_since as recent,
                   exists (select 1 from public.lifecycle_email_log l
                            where l.user_id = u.id and l.email_type = 'welcome_board'
                              and l.status = 'sent' and l.sent_at < p_at) as sent
              from auth.users u
              join public.profiles p on p.user_id = u.id
              cross join win w
             where u.created_at >= w.wl_base and u.created_at < w.wl_until
               and u.email_confirmed_at is not null and u.email is not null
               and p.banned_at is null
               and exists (select 1 from public.email_unsub_tokens t where t.user_id = u.id)
               and public._email_pref_enabled(u.id, 'email_lifecycle')
               and exists (select 1 from public.boards b
                            where b.created_by = u.id and b.deleted_at is null
                              and b.thumb_key is not null and coalesce(b.card_count, 0) > 0)
               and not exists (select 1 from internal i where i.user_id = u.id)) wl
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
         case when l.pair in ('active', 'session_context') then w.t_since
              when l.pair = 'welcome' then w.wl_since
              else w.since end,
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

create or replace function public.check_instrumentation()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r       record;
  v_n     integer := 0;
  v_now   timestamptz := now();
  v_facts text;
begin
  for r in select * from public._instrumentation_pairs(v_now) loop
    v_facts := r.truth_label || ': ' || r.truth_n
      || case when r.per_person then '' else ' by ' || r.truth_users || ' people' end
      || ', ' || to_char(r.since at time zone 'UTC', 'YYYY-MM-DD HH24:MI')
      || ' to ' || to_char(v_now at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || E' UTC.\n'
      || case when r.per_person then 'Of them, ' || r.event_label else r.event_label || ', same window' end
      || ': ' || r.ev_n || E'.\n'
      || 'The 14 days before: ' || r.base_truth_n || ' against ' || r.base_ev_n || '.';

    if r.truth_users >= 3 and r.ev_n = 0 and r.base_ev_n > 0 then
      if public.ops_alert_raise('instrumentation',
           case when r.pair = 'welcome' then 'Welcome emails stopped' else 'Events stopped arriving: ' || r.pair end,
           v_facts || E'\n\n' || case when r.pair = 'welcome'
             then 'Accounts are still coming due the welcome, but none of them was sent it. Look at the '
               || 'lifecycle-email-hourly cron and what the lifecycle-email-cron function returns for '
               || 'welcome_board (eligible, sent, failed), and at lifecycle_due_welcome_board, which every send waits on.'
             else 'The activity is still happening, since its rows exist, but its events stopped '
               || 'arriving. Look at the latest deploy for a log call that was removed or now throws, and at '
               || 'analytics_events_synthetic for rows being diverted.' end,
           true, 'instrumentation:dark:' || r.pair, interval '20 hours', null) is not null then
        v_n := v_n + 1;
      end if;
    elsif not r.per_person and r.truth_users >= 3 and r.ev_n = 0 and r.base_ev_n = 0 then
      if public.ops_alert_raise('instrumentation', 'Never measured in production: ' || r.pair,
           v_facts || E'\n\nPeople are doing this in production, but its event has not arrived once in 16 days. '
             || 'Either the build they use shipped without it, or every row is being diverted '
             || '(analytics_events_synthetic).',
           false, 'instrumentation:never:' || r.pair, interval '6 days 20 hours', null) is not null then
        v_n := v_n + 1;
      end if;
    elsif r.truth_n >= 10 and r.base_truth_n >= 20 and r.base_ev_n > 0
          and r.ev_n::numeric / r.truth_n < 0.5 * r.base_ev_n::numeric / r.base_truth_n then
      if public.ops_alert_raise('instrumentation',
           case when r.pair = 'welcome' then 'Welcome emails thinning' else 'Events thinning: ' || r.pair end,
           v_facts || E'\n\n' || case when r.pair = 'welcome'
             then 'The welcome still goes out, but to under half its usual share of the accounts due it. Look at what '
               || 'the lifecycle-email-cron function returns for welcome_board: sends failing, or send hours it no longer reaches.'
             else 'The event still arrives, but at under half its usual rate against the activity. '
               || 'One way into it has probably lost its log call: a new door, one platform, a failing branch.' end,
           false, 'instrumentation:thin:' || r.pair, interval '20 hours', null) is not null then
        v_n := v_n + 1;
      end if;
    end if;
  end loop;
  return v_n;
end;
$$;

-- ── Proof ───────────────────────────────────────────────────────────────────
do $proof$
declare
  v_fn    text;
  v_n     integer;
  v_pp    boolean;
  v_truth integer;
  v_ev    integer;
  v_since timestamptz;
begin
  -- The 0311 habit: create or replace kept each ACL; prove it, don't trust it.
  foreach v_fn in array array['public._instrumentation_pairs(timestamptz)', 'public.check_instrumentation()'] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute')
       or not has_function_privilege('service_role', v_fn, 'execute') then
      raise exception '0497: % is not service_role''s alone', v_fn;
    end if;
  end loop;

  -- It took: eight pairs, the welcome last and per person, counting exactly
  -- the accounts due it that signed up 36 to 108 hours ago.
  select count(*)::int,
         bool_and(per_person) filter (where pair = 'welcome'),
         max(truth_n) filter (where pair = 'welcome'),
         max(ev_n) filter (where pair = 'welcome'),
         max(since) filter (where pair = 'welcome')
    into v_n, v_pp, v_truth, v_ev, v_since
    from public._instrumentation_pairs(now());
  if v_n <> 8 or v_pp is not true or v_since is distinct from now() - interval '108 hours' then
    raise exception '0497: _instrumentation_pairs did not take (% pairs, per person %, since %)', v_n, v_pp, v_since;
  end if;
  if v_truth <> (select count(*)::int
                   from auth.users u join public.profiles p on p.user_id = u.id
                  where u.created_at >= now() - interval '108 hours' and u.created_at < now() - interval '36 hours'
                    and u.email_confirmed_at is not null and u.email is not null and p.banned_at is null
                    and exists (select 1 from public.email_unsub_tokens t where t.user_id = u.id)
                    and public._email_pref_enabled(u.id, 'email_lifecycle')
                    and exists (select 1 from public.boards b where b.created_by = u.id and b.deleted_at is null
                                  and b.thumb_key is not null and coalesce(b.card_count, 0) > 0)
                    and not exists (select 1 from public._internal_user_ids() i where i.user_id = u.id))
     or v_ev > v_truth then
    raise exception '0497: the welcome''s truth is not the accounts due it (% due, % sent)', v_truth, v_ev;
  end if;

  if (select p.prosrc from pg_proc p where p.oid = 'public.check_instrumentation()'::regprocedure)
       not like '%if r.truth_users >= 3 and r.ev_n = 0 and r.base_ev_n > 0 then%' then
    raise exception '0497: check_instrumentation''s paging rule moved';
  end if;
  if not exists (select 1 from cron.job where jobname = 'instrumentation-daily'
                    and command like '%public.check_instrumentation()%') then
    raise exception '0497: instrumentation-daily is not scheduled';
  end if;
end $proof$;

commit;
