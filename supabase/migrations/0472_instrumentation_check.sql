-- 0472 — is each feature still measured, and what kind of address people
-- sign up with (the data-collection pass, 2026-10-20, step 10).
--
-- (1) check_instrumentation(), daily at 15:10 UTC. Nothing noticed when a
--     feature recorded nothing: Messages shipped its engine without one event,
--     and an event that stops firing after a refactor looks exactly like
--     people losing interest. So each event that matters is set against the
--     durable rows the same activity leaves behind — messages against
--     msg_send, import_jobs against import_job's start, clusters against
--     cluster_create, link joins against the claim's result, first cards
--     against onboarding_first_card, and the heartbeat's people against their
--     events at all and against session_context. Over the last 48 hours:
--       * the activity went on (three or more people) and its event, which
--         arrived in the fortnight before, did not arrive once → paged;
--       * a feature is in use and its event has never arrived in 16 days →
--         an alert, not paged (a build without it, or every row diverting);
--       * the event still arrives at under half its usual rate against the
--         activity → an alert, not paged (one way in lost its log call).
--     The team's accounts are left out of both sides (_internal_user_ids,
--     which since 0470 includes every preview signup), so preview traffic,
--     whose events divert, cannot read as loss. _instrumentation_pairs(p_at)
--     returns the numbers it judges; run it by hand to see them.
--
-- (2) admin_event_coverage gains four rows, per person over the same cohort
--     (agreed with the admin session, which owns admin_*): first_cluster,
--     first_message, first_import, joined_by_link. A feature nobody has used
--     yet reads 0 of 0 with a null coverage_pct, and still shows, so the
--     owner can see it is wired. The rest of the body is 0461's, byte for byte.
--
-- (3) _email_kind(email): consumer | school | custom_domain | ours | unknown,
--     and _email_school_domain(email), the institution for a school address
--     and null for everything else (a company's own domain can name the one
--     person at it). Read-time from auth.users, so it covers every account
--     ever made. Higher education only, by the suffixes reserved for it —
--     .edu, .edu.xx, .ac.xx — never a K-12 pattern. The consumer list is
--     boards/src/lib/mailboxLink.js's, pattern for pattern, which
--     emailKind.test.mjs holds it to. Internal only: no client role can call
--     either.

-- ── (1) Is each feature still measured? ────────────────────────────────────
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
    ('cluster_create',  false, 'Clusters made (boards with a parent)',                   'cluster_create events',                                  4),
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

revoke all on function public._instrumentation_pairs(timestamptz) from public, anon, authenticated;
grant execute on function public._instrumentation_pairs(timestamptz) to service_role;
comment on function public._instrumentation_pairs(timestamptz) is
  'The numbers check_instrumentation() judges (0472): per pair, durable truth against the event that should record it, '
  'over the 48 hours to p_at and the 14 days before, the team''s accounts left out of both. Run it by hand to see them.';

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
      if public.ops_alert_raise('instrumentation', 'Events stopped arriving: ' || r.pair,
           v_facts || E'\n\nThe activity is still happening, since its rows exist, but its events stopped '
             || 'arriving. Look at the latest deploy for a log call that was removed or now throws, and at '
             || 'analytics_events_synthetic for rows being diverted.',
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
      if public.ops_alert_raise('instrumentation', 'Events thinning: ' || r.pair,
           v_facts || E'\n\nThe event still arrives, but at under half its usual rate against the activity. '
             || 'One way into it has probably lost its log call: a new door, one platform, a failing branch.',
           false, 'instrumentation:thin:' || r.pair, interval '20 hours', null) is not null then
        v_n := v_n + 1;
      end if;
    end if;
  end loop;
  return v_n;
end;
$$;

revoke all on function public.check_instrumentation() from public, anon, authenticated;
grant execute on function public.check_instrumentation() to service_role;
comment on function public.check_instrumentation() is
  'Daily, cron instrumentation-daily (0472): an ops alert when a feature''s events stop arriving while the activity '
  'goes on (paged), when it is in use and never measured (not paged), or when they thin to under half their usual rate '
  '(not paged). The numbers are _instrumentation_pairs(now()).';

select cron.schedule('instrumentation-daily', '10 15 * * *', $$ select public.check_instrumentation(); $$);

-- ── (2) admin_event_coverage: four more rows ────────────────────────────────
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
           'cluster_create'
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

-- ── (3) What kind of address ────────────────────────────────────────────────
create or replace function public._email_kind(p_email text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  -- The part after the last @, trimmed and lowercased, as mailboxLink.js
  -- domainOf reads it.
  with d as (select lower(btrim(substring(p_email from '@([^@]*)$'))) as dom)
  select case
    when dom is null or dom !~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$' then 'unknown'
    when public._email_domain_is_ours(dom) then 'ours'
    -- Before the consumer list, whose mail.* pattern would take mail.harvard.edu.
    when dom ~ '(^|\.)edu$|\.(edu|ac)\.[a-z]{2}$' then 'school'
    when dom ~ any (array[
      '^(gmail|googlemail)\.com$',
      '^(outlook|hotmail|live|msn)\.[a-z.]+$',
      '^yahoo\.co\.jp$',
      '^(yahoo|ymail)\.[a-z.]+$',
      '^(icloud|me|mac)\.com$',
      '^(proton\.me|protonmail\.(com|ch)|pm\.me)$',
      '^(aol|gmx|web|yandex|mail|inbox|list|bk|rambler|qq|163|126|yeah|sina|sohu|naver|daum|hanmail|kakao|nate|libero|virgilio|tiscali|alice|orange|free|laposte|sfr|wanadoo|bol|uol|terra|ig|rediffmail|zoho|tutanota|tuta|fastmail|hey|mailbox|posteo|seznam|wp|o2|onet|interia|t-online|freenet|bluewin|telenet|skynet|shaw|rogers|sympatico|bigpond|optusnet|comcast|verizon|att|sbcglobal|cox|charter|earthlink|btinternet|sky|virginmedia|talktalk|ntlworld|ziggo|kpn|home|planet|telia|xs4all)\.[a-z.]+$'
    ]) then 'consumer'
    else 'custom_domain'
  end
  from d;
$$;

create or replace function public._email_school_domain(p_email text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  -- The institution, not the department or the mail host: umn.edu for
  -- stu.umn.edu, ox.ac.uk for cs.ox.ac.uk.
  select case when public._email_kind(p_email) = 'school' then
    substring(lower(btrim(substring(p_email from '@([^@]*)$')))
              from '([a-z0-9-]+\.(?:edu|(?:edu|ac)\.[a-z]{2}))$')
  end;
$$;

revoke all on function public._email_kind(text) from public, anon, authenticated;
revoke all on function public._email_school_domain(text) from public, anon, authenticated;
grant execute on function public._email_kind(text) to service_role;
grant execute on function public._email_school_domain(text) to service_role;
comment on function public._email_kind(text) is
  'consumer | school | custom_domain | ours | unknown, for an address (0472). The consumer patterns are '
  'boards/src/lib/mailboxLink.js''s (emailKind.test.mjs). School is higher education only: .edu, .edu.xx, .ac.xx.';
comment on function public._email_school_domain(text) is
  'The institution''s domain for a school address (0472), null for every other kind: a company''s own domain can name '
  'the one person at it.';

-- ── Proof ───────────────────────────────────────────────────────────────────
do $proof$
declare
  v_bad   text := '';
  v_fn    text;
  v_rows  integer;
  v_pairs integer;
  v_def   text;
begin
  -- Internal, every one: no client role reaches them, and the cron's role and
  -- service_role do.
  foreach v_fn in array array['public._instrumentation_pairs(timestamptz)', 'public.check_instrumentation()',
                              'public._email_kind(text)', 'public._email_school_domain(text)'] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      v_bad := v_bad || ' ' || v_fn || ' is reachable by a client role;';
    end if;
    if not has_function_privilege('service_role', v_fn, 'execute') then
      v_bad := v_bad || ' ' || v_fn || ' is not executable by service_role;';
    end if;
  end loop;

  -- create or replace kept admin_event_coverage's grant, and its gate.
  if has_function_privilege('anon', 'public.admin_event_coverage(integer,boolean,boolean)', 'execute') then
    v_bad := v_bad || ' admin_event_coverage is reachable by anon;';
  end if;
  if not has_function_privilege('authenticated', 'public.admin_event_coverage(integer,boolean,boolean)', 'execute') then
    v_bad := v_bad || ' admin_event_coverage lost its grant to authenticated;';
  end if;
  v_def := pg_get_functiondef('public.admin_event_coverage(integer,boolean,boolean)'::regprocedure);
  if v_def not like '%perform public._require_admin();%'
     or v_def not like '%public._admin_entered_code()%'
     or v_def not like '%''first_cluster''%' or v_def not like '%''first_message''%'
     or v_def not like '%''first_import''%'  or v_def not like '%''joined_by_link''%' then
    v_bad := v_bad || ' admin_event_coverage lost its gate, its signup rule, or a new row;';
  end if;

  -- Seven pairs, each once, and it runs.
  select count(*), count(distinct p.pair) into v_rows, v_pairs from public._instrumentation_pairs(now()) p;
  if v_rows <> 7 or v_pairs <> 7 then
    v_bad := v_bad || ' _instrumentation_pairs returned ' || v_rows || ' rows for ' || v_pairs || ' pairs, not 7;';
  end if;

  if not exists (select 1 from cron.job
                  where jobname = 'instrumentation-daily' and active and schedule = '10 15 * * *'
                    and command like '%public.check_instrumentation()%') then
    v_bad := v_bad || ' instrumentation-daily is not scheduled;';
  end if;

  if public._email_kind('a@gmail.com') is distinct from 'consumer'
     or public._email_kind(' A@Hotmail.co.uk ') is distinct from 'consumer'
     or public._email_kind('a@gmx.de') is distinct from 'consumer'
     or public._email_kind('a@stu.umn.edu') is distinct from 'school'
     or public._email_kind('a@cs.ox.ac.uk') is distinct from 'school'
     or public._email_kind('a@mail.harvard.edu') is distinct from 'school'
     or public._email_kind('a@acme.io') is distinct from 'custom_domain'
     or public._email_kind('a@k12.ca.us') is distinct from 'custom_domain'
     or public._email_kind('a@soleilpictures.com') is distinct from 'ours'
     or public._email_kind('not-an-address') is distinct from 'unknown'
     or public._email_kind('a@edu') is distinct from 'unknown'
     or public._email_kind(null) is distinct from 'unknown'
     or public._email_school_domain('a@cs.ox.ac.uk') is distinct from 'ox.ac.uk'
     or public._email_school_domain('a@stu.umn.edu') is distinct from 'umn.edu'
     or public._email_school_domain('a@student.unimelb.edu.au') is distinct from 'unimelb.edu.au'
     or public._email_school_domain('a@acme.io') is not null
     or public._email_school_domain('a@gmail.com') is not null then
    v_bad := v_bad || ' _email_kind or _email_school_domain gets a sample wrong;';
  end if;

  if v_bad <> '' then
    raise exception '0472:%', v_bad;
  end if;
end $proof$;

notify pgrst, 'reload schema';
