-- 0886 — search and AI pipeline alerts get their own kind, and stay one row
-- until someone has seen them.
--
-- _discovery_alert (0335, 0364, 0369) writes two things for every rule that
-- fires in check_discovery_pipelines(): a client_errors row (kind
-- 'discovery_pipeline', the one Admin > Issues and the Overview markers read)
-- and an ops_alerts row (the one Settings > Security lists). Every ops row was
-- filed under kind 'email_health', whether the rule was about sign-in email or
-- about Google, the AI crawlers or the ChatGPT answer check. And each rule
-- raised a new ops row every morning it stayed true, so "Google dropped
-- /vs/..." sat in the list several times over with nothing marked as seen.
--
-- What changes, in _discovery_alert only:
--
--   * Kind. The four sign-in and app email rules keep 'email_health' (they
--     page, and the alert email's subject is chosen by kind). Every other rule
--     is filed under 'discovery'. ops_alerts.kind has no check constraint, and
--     Settings > Security lists the last 50 alerts of any kind, so both keep
--     working with no change.
--
--   * No re-raise while one is open. A 'discovery' alert is not raised again
--     while an earlier one with the same dedupe key (discovery:<name>) has not
--     been marked Seen and is less than 7 days old. An unseen row holds the
--     rule for those 7 days and keeps the latest text (its body is rewritten
--     each morning the rule is still true); after 7 days the rule raises a
--     fresh row. Mark it Seen and the rule raises a fresh row the next
--     morning it is still true. Only rows of kind 'discovery' count as open:
--     the older rows filed as 'email_health' are left as they are, none of
--     them marked as seen, and they do not hold a new alert back. So after
--     this ships each rule that is still firing raises one row under the new
--     kind and then stays quiet.
--     The email rules are NOT held back this way: they page, and a page must
--     not depend on someone having clicked Seen on an older one. They keep the
--     20-hour window.
--
--   * The client_errors row is untouched: still one a day while the rule is
--     true (20-hour window), so Admin > Issues and the "(n days)" on an
--     Overview marker still show how long a rule has been firing.
--
-- admin_markers (0372) leaves 'email_health' out of its ops markers because
-- each of those rows twins a discovery marker. It now leaves 'discovery' out
-- for the same reason; without that every pipeline alert would be marked
-- twice. Its body is 0372's with that one kind added and the comment beside it.
--
-- No rows are written or changed here.

begin;

create or replace function public._discovery_alert(p_name text, p_message text)
returns boolean
language plpgsql security definer
set search_path = public as $$
declare
  -- 0886: the rules that page. Everything else is a search or AI pipeline rule.
  v_page boolean := p_name in ('App email volume spike', 'Sign-in email bounces spiked',
                               'Sign-in email opens collapsed', 'Sign-in email rows missing');
begin
  -- 0364: only server-written rows count (clients can no longer insert this
  -- kind), and a row from the future is never "already fired".
  if exists (select 1 from public.client_errors
              where kind = 'discovery_pipeline' and name = p_name
                and occurred_at > now() - interval '20 hours'
                and occurred_at <= now() + interval '5 minutes') then
    return false;
  end if;
  insert into public.client_errors (kind, name, message, path)
  values ('discovery_pipeline', left(p_name, 120), left(p_message, 500), '/discovery-pipelines');
  -- 0369: the email-health rules reach a person, not only /admin. The SEO
  -- pipeline rules stay on /admin (they are not urgent and would be noise).
  if v_page then
    perform public.ops_alert_raise('email_health', p_name, p_message, true,
      'discovery:' || p_name, interval '20 hours');
  -- 0886: a pipeline rule has its own kind, and is one row until it is seen,
  -- for at most 7 days. An unseen row younger than that keeps the latest text
  -- and nothing new is raised; an older one no longer holds the rule.
  elsif exists (select 1 from public.ops_alerts a
                 where a.dedupe_key = 'discovery:' || p_name
                   and a.kind = 'discovery'
                   and a.acked_at is null
                   and a.created_at > now() - interval '7 days') then
    update public.ops_alerts a
       set body = left(coalesce(p_message, ''), 4000)
     where a.dedupe_key = 'discovery:' || p_name
       and a.kind = 'discovery'
       and a.acked_at is null
       and a.created_at > now() - interval '7 days';
  else
    perform public.ops_alert_raise('discovery', p_name, p_message, false,
      'discovery:' || p_name, interval '20 hours');
  end if;
  return true;
end;
$$;

revoke execute on function public._discovery_alert(text, text) from public, anon, authenticated;

create or replace function public.admin_markers(p_since date default null)
returns table (
  day    date,
  kind   text,
  label  text,
  source text,
  ref_id bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_since date;
begin
  perform public._require_admin();

  v_since := coalesce(p_since, current_date - 120);

  return query
  with
  notes as (
    select n.day, n.kind, n.label, 'note'::text as source, n.id as ref_id
      from public.admin_notes n
     where n.deleted_at is null
       and n.day >= v_since
  ),
  -- A discovery alert re-fires daily while its pipeline stays broken (0335,
  -- deduped over 20 hours). One marker per name per run of consecutive UTC
  -- days, at the run's first day: a day minus its rank within its name is
  -- constant across a run (gaps and islands). Clients cannot write this kind
  -- (0364); the coalesce only keeps a label from ever being null.
  -- client_errors is purged nightly after 90 days (0108), so this branch never
  -- looks further back than that; a run that began before the horizon counts
  -- only its days since.
  disc_days as (
    select distinct coalesce(ce.name, 'discovery_pipeline') as name,
           (ce.occurred_at at time zone 'utc')::date as day
      from public.client_errors ce
     where ce.kind = 'discovery_pipeline'
       and ce.occurred_at >= greatest(v_since, current_date - 90)
  ),
  disc_runs as (
    select d.name, d.day,
           d.day - (row_number() over (partition by d.name order by d.day))::int as grp
      from disc_days d
  ),
  disc as (
    select min(r.day) as day,
           'alert'::text as kind,
           case when count(*) = 1 then r.name
                else r.name || ' (' || count(*) || ' days)' end as label,
           'discovery'::text as source,
           null::bigint as ref_id
      from disc_runs r
     group by r.name, r.grp
  ),
  -- Not markers: the Monday heartbeat and the test button would put one on
  -- every week, held-mail reminders repeat daily while mail is held, the
  -- signup spike is the signups line itself, and email_health is raised by
  -- _discovery_alert for every discovery row (0369), so it would twin each
  -- discovery marker. 0886: so is discovery, the kind the search and AI
  -- pipeline rules moved to; it is left out for the same reason.
  -- The rest collapse into runs per kind, and per dedupe key
  -- only for the 0374 invariants: their seven checks share kind 'invariant'
  -- with one key each, so two different failures stay two markers. No other
  -- kind is split by key, because 0369 keys its hold, budget and member alerts
  -- per account: a breaker trip that holds N senders is one marker, not N.
  -- Runs are not strictly consecutive: a stuck 0374 invariant re-raises from
  -- a daily cron through a 24-hour dedupe, so whenever a run starts a moment
  -- earlier than the day before it is suppressed, and the alert lands every
  -- day or two at random. A run therefore bridges gaps of up to 2 days, and
  -- its (n days) is the span from its first alert day to its last.
  ops_days as (
    select case when oa.kind = 'invariant' then coalesce(oa.dedupe_key, oa.kind) else oa.kind end as k,
           (oa.created_at at time zone 'utc')::date as day,
           min(oa.title) as title
      from public.ops_alerts oa
     where oa.created_at >= v_since
       and oa.kind not in ('heartbeat', 'test', 'held_reminder', 'signups', 'email_health', 'discovery')
     group by case when oa.kind = 'invariant' then coalesce(oa.dedupe_key, oa.kind) else oa.kind end,
              (oa.created_at at time zone 'utc')::date
  ),
  -- 1 where a new run starts: more than 2 days after this key's previous alert
  -- day. lag() is null on a key's first day, so its first run is run 0. (Two
  -- steps, because window calls cannot be nested.)
  ops_gaps as (
    select o.k, o.day, o.title,
           case when o.day - lag(o.day) over (partition by o.k order by o.day) > 2 then 1 else 0 end as starts
      from ops_days o
  ),
  ops_runs as (
    select g.k, g.day, g.title,
           sum(g.starts) over (partition by g.k order by g.day rows unbounded preceding) as grp
      from ops_gaps g
  ),
  ops as (
    select min(r.day) as day,
           'alert'::text as kind,
           case when max(r.day) = min(r.day) then min(r.title)
                else min(r.title) || ' (' || (max(r.day) - min(r.day) + 1) || ' days)' end as label,
           'ops'::text as source,
           null::bigint as ref_id
      from ops_runs r
     group by r.k, r.grp
  )
  select m.day, m.kind, m.label, m.source, m.ref_id
    from (select * from notes
          union all select * from disc
          union all select * from ops) m
   order by m.day, m.source, m.label;
end;
$$;

revoke all on function public.admin_markers(date) from public, anon;
grant execute on function public.admin_markers(date) to authenticated, service_role;

comment on function public.admin_markers(date) is
  'Admin. Dated markers since p_since (default 120 days ago), oldest first: live notes '
  '(source note, ref_id = admin_notes.id), discovery-pipeline alerts collapsed per name '
  '(source discovery), and ops alerts collapsed per kind (source ops), without heartbeat, '
  'test, held_reminder, signups, email_health and discovery. '
  'Ops runs are per dedupe key only for the 0374 invariants, whose seven checks share one kind; '
  'every other kind is one marker per run regardless of how many accounts it touched. '
  'email_health and discovery (0886) are left out because _discovery_alert raises one of '
  'the two beside its discovery row (0369), so each would twin a discovery marker. A collapsed alert is one marker per run, '
  'at the run''s first day, labelled with its name or min(title) plus (n days) when the run '
  'spans more than one day; alerts carry kind alert and no ref_id. '
  'A discovery run is consecutive UTC days: its 20-hour dedupe re-fires daily. '
  'An ops run bridges gaps of up to 2 days and its n is the span from first to last alert '
  'day: 0374''s invariants re-raise from a daily cron through a 24-hour dedupe, so '
  'start-time jitter suppresses some days at random, and a strictly consecutive run would '
  'break at each. client_errors is purged after 90 days (0108), so discovery markers '
  'cannot reach further back than ~90 days, and a run that began before that horizon '
  'shows a shortened (n days).';

-- Proof (0311 habit): assert the grants rather than trust the statements.
do $proof$
begin
  if has_function_privilege('anon', 'public._discovery_alert(text, text)', 'execute')
     or has_function_privilege('authenticated', 'public._discovery_alert(text, text)', 'execute') then
    raise exception '0886: _discovery_alert(text, text) is executable by a client';
  end if;
  if has_function_privilege('anon', 'public.admin_markers(date)', 'execute') then
    raise exception '0886: admin_markers(date) is executable by anon';
  end if;
  if not has_function_privilege('authenticated', 'public.admin_markers(date)', 'execute')
     or not has_function_privilege('service_role', 'public.admin_markers(date)', 'execute') then
    raise exception '0886: admin_markers(date) lost EXECUTE for authenticated or service_role';
  end if;
  -- The kind must stay free text: a check constraint on it would refuse the new kind.
  if exists (select 1 from pg_constraint c
              where c.conrelid = 'public.ops_alerts'::regclass and c.contype = 'c'
                and pg_get_constraintdef(c.oid) ilike '%kind%') then
    raise exception '0886: ops_alerts.kind has a check constraint; add discovery to it first';
  end if;
end $proof$;

commit;
