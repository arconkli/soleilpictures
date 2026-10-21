-- 0494 — Emails › Impact: what each lifecycle email did, week by week.
--
-- One read for the Impact view of the Emails tab (the owner's pick of
-- 2026-10-20, "Over time"). Every series is per UTC week, Monday to Sunday,
-- for the last p_weeks weeks with this week so far last:
--
--   types     per lifecycle email: sent, held back (the group a test keeps
--             out), failed, delivered and opened (Resend's events, joined on
--             resend_id), and how many of the people sent it, or held back,
--             placed or edited a card or edited a doc within 72 hours. `young`
--             counts the sends still inside their 72 hours, whose `made` can
--             still grow. With p_split, opens before and after that day.
--   months    opened per delivered, all lifecycle mail, for this calendar
--             month and the two before it.
--   signups   new accounts per sign-up week, as Analytics counts them (once
--   welcomed  the emailed code is entered), and how many of them got the
--             welcome, so a stall shows as a gap that volume alone would hide.
--   mailbox   delivered and opened per week by mailbox (Gmail, Outlook,
--             iCloud, Yahoo and AOL, everything else). Only the buckets leave
--             the database, never an address.
--   lost      sends that never arrived: failed on our side, bounced, or
--             handed to Resend with no delivery report after 72 hours.
--   arms      every subject and body line under test: sends, opens, clicks,
--             back within a day, made something within 3 days.
--
-- People are the ones Analytics counts: never the team, never a banned
-- account, never a service account. Opens are Resend's tracking pixel, per
-- delivered; a send before tracking began (tracked_from) has no row to join
-- and counts as sent but never as delivered.
--
-- New function, so the 0311 grant habit: EXECUTE for authenticated and
-- service_role only, proved below.

begin;

set local lock_timeout = '3s';

create or replace function public.admin_email_impact(
  p_weeks integer default 18,
  p_split date default null
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_weeks  int  := least(greatest(coalesce(p_weeks, 18), 4), 104);
  v_cur    date := date_trunc('week', now() at time zone 'utc')::date;
  v_first  date;
  v_mo     date := (date_trunc('month', now() at time zone 'utc') - interval '2 months')::date;
  v_from   timestamptz;
  v_split  timestamptz := case when p_split is null then null else (p_split::timestamp at time zone 'utc') end;
  v_out    jsonb;
begin
  perform public._require_admin();

  v_first := v_cur - (v_weeks - 1) * 7;
  v_from  := (least(v_first, v_mo)::timestamp at time zone 'utc');

  -- Timestamps without a zone in, days out, so a session's time zone can never
  -- move a Monday.
  with weeks as (
    select gs::date as wk, (row_number() over (order by gs) - 1)::int as i
      from generate_series(v_first::timestamp, v_cur::timestamp, interval '7 days') gs
  ),
  excluded as (
    select iu.user_id from public._internal_user_ids() iu where iu.user_id is not null
    union
    select bp.user_id from public.profiles bp
     where bp.banned_at is not null or coalesce(bp.is_service, false)
  ),
  lg as (
    select l.email_type, l.status, l.user_id, l.sent_at, l.resend_id, l.subject_arm, l.body_arm,
           lower(split_part(l.recipient_email, '@', 2)) as dom,
           date_trunc('week', l.sent_at at time zone 'utc')::date as wk
      from public.lifecycle_email_log l
     where l.sent_at >= v_from
       and not exists (select 1 from excluded e where e.user_id = l.user_id)
  ),
  j as (
    select g.*, es.id as es_id, es.sent_at as es_sent_at,
           es.delivered_at, es.opened_at, es.clicked_at, es.bounced_at,
           -- Made something: a card placed or edited, or a doc edited, in the
           -- 72 hours after the send (or after the moment a held-back person
           -- would have been sent it).
           g.status in ('sent', 'held_out') and exists (
             select 1 from public.analytics_events a
              where a.user_id = g.user_id
                and a.occurred_at > g.sent_at and a.occurred_at <= g.sent_at + interval '72 hours'
                and a.event in ('card_placed', 'card_edit', 'doc_edit')
                and coalesce(a.props->>'synthetic', '') <> 'true') as made,
           -- Back within a day, as admin_email_arm_stats has always counted a
           -- return: any event at all. Only the test lines read it.
           g.status = 'sent' and (g.subject_arm is not null or g.body_arm is not null) and exists (
             select 1 from public.analytics_events a
              where a.user_id = g.user_id
                and a.occurred_at > g.sent_at and a.occurred_at <= g.sent_at + interval '24 hours'
                and coalesce(a.props->>'synthetic', '') <> 'true') as returned,
           g.sent_at > now() - interval '72 hours' as young
      from lg g
      left join public.email_sends es on es.resend_id = g.resend_id
  ),
  inwin as (
    select j.* from j where j.wk >= v_first
  ),
  per as (
    select i.email_type, i.wk,
           count(*) filter (where i.status = 'sent')                                 as sent,
           count(*) filter (where i.status = 'sent' and i.made)                      as made,
           count(*) filter (where i.status = 'held_out')                             as held,
           count(*) filter (where i.status = 'held_out' and i.made)                  as held_made,
           count(*) filter (where i.status = 'failed')                               as failed,
           count(*) filter (where i.status = 'sent' and i.delivered_at is not null)  as delivered,
           count(*) filter (where i.status = 'sent' and i.delivered_at is not null
                              and i.opened_at is not null)                          as opened,
           count(*) filter (where i.status in ('sent', 'held_out') and i.young)      as young
      from inwin i
     group by 1, 2
  ),
  types as (
    select t.email_type,
           jsonb_build_object(
             'type',      t.email_type,
             'sent',      jsonb_agg(coalesce(pr.sent, 0)      order by wk.i),
             'made',      jsonb_agg(coalesce(pr.made, 0)      order by wk.i),
             'held',      jsonb_agg(coalesce(pr.held, 0)      order by wk.i),
             'held_made', jsonb_agg(coalesce(pr.held_made, 0) order by wk.i),
             'failed',    jsonb_agg(coalesce(pr.failed, 0)    order by wk.i),
             'delivered', jsonb_agg(coalesce(pr.delivered, 0) order by wk.i),
             'opened',    jsonb_agg(coalesce(pr.opened, 0)    order by wk.i),
             'young',     jsonb_agg(coalesce(pr.young, 0)     order by wk.i),
             'before', case when v_split is null then null else (
               select jsonb_build_object(
                        'delivered', count(*) filter (where x.delivered_at is not null),
                        'opened',    count(*) filter (where x.delivered_at is not null and x.opened_at is not null))
                 from inwin x
                where x.email_type = t.email_type and x.status = 'sent' and x.sent_at < v_split) end,
             'after', case when v_split is null then null else (
               select jsonb_build_object(
                        'delivered', count(*) filter (where x.delivered_at is not null),
                        'opened',    count(*) filter (where x.delivered_at is not null and x.opened_at is not null))
                 from inwin x
                where x.email_type = t.email_type and x.status = 'sent' and x.sent_at >= v_split) end,
             -- Ever, not just in view: "last sent the week of" needs the real last.
             'first_sent', (select min(l2.sent_at) from public.lifecycle_email_log l2
                             where l2.email_type = t.email_type and l2.status = 'sent'
                               and not exists (select 1 from excluded e where e.user_id = l2.user_id)),
             'last_sent',  (select max(l2.sent_at) from public.lifecycle_email_log l2
                             where l2.email_type = t.email_type and l2.status = 'sent'
                               and not exists (select 1 from excluded e where e.user_id = l2.user_id))
           ) as row
      from (select distinct i.email_type from inwin i) t
     cross join weeks wk
      left join per pr on pr.email_type = t.email_type and pr.wk = wk.wk
     group by t.email_type
  ),
  months as (
    select ms::date as mo,
           count(j.*) filter (where j.status = 'sent' and j.delivered_at is not null) as delivered,
           count(j.*) filter (where j.status = 'sent' and j.delivered_at is not null and j.opened_at is not null) as opened
      from generate_series(v_mo::timestamp, date_trunc('month', now() at time zone 'utc'), interval '1 month') ms
      left join j on j.sent_at >= (ms at time zone 'utc')
                 and j.sent_at <  ((ms + interval '1 month') at time zone 'utc')
     group by ms
  ),
  people as (
    select ap.user_id, date_trunc('week', ap.created_at at time zone 'utc')::date as wk
      from public._admin_people(true, true) ap
     where ap.created_at >= (v_first::timestamp at time zone 'utc')
       and not exists (select 1 from excluded e where e.user_id = ap.user_id)
  ),
  signups as (
    select wk.i,
           count(pe.user_id) as signups,
           count(pe.user_id) filter (where exists (
             select 1 from public.lifecycle_email_log l3
              where l3.user_id = pe.user_id and l3.email_type = 'welcome_board' and l3.status = 'sent')) as welcomed
      from weeks wk
      left join people pe on pe.wk = wk.wk
     group by wk.i
  ),
  boxed as (
    select i.wk, i.sent_at, i.opened_at,
           case
             when i.dom in ('gmail.com', 'googlemail.com')          then 'gmail'
             when i.dom ~ '^(outlook|hotmail|live|msn)\.'           then 'outlook'
             when i.dom in ('icloud.com', 'me.com', 'mac.com')      then 'icloud'
             when i.dom ~ '^(yahoo|ymail|rocketmail|aol)\.'         then 'yahoo'
             else 'other'
           end as box
      from inwin i
     where i.status = 'sent' and i.delivered_at is not null
  ),
  box_per as (
    select b.box, b.wk, count(*) as delivered, count(*) filter (where b.opened_at is not null) as opened
      from boxed b
     group by 1, 2
  ),
  mailbox as (
    select bx.box,
           jsonb_build_object(
             'box',       bx.box,
             'delivered', jsonb_agg(coalesce(bp.delivered, 0) order by wk.i),
             'opened',    jsonb_agg(coalesce(bp.opened, 0)    order by wk.i),
             'before', case when v_split is null then null else (
               select jsonb_build_object('delivered', count(*), 'opened', count(*) filter (where x.opened_at is not null))
                 from boxed x where x.box = bx.box and x.sent_at < v_split) end,
             'after', case when v_split is null then null else (
               select jsonb_build_object('delivered', count(*), 'opened', count(*) filter (where x.opened_at is not null))
                 from boxed x where x.box = bx.box and x.sent_at >= v_split) end
           ) as row
      from (select distinct b.box from boxed b) bx
     cross join weeks wk
      left join box_per bp on bp.box = bx.box and bp.wk = wk.wk
     group by bx.box
  ),
  lost as (
    select i.email_type, i.wk,
           case when i.status = 'failed'      then 'failed'
                when i.bounced_at is not null then 'bounced'
                else 'no_report' end as reason
      from inwin i
     where i.status = 'failed'
        -- A soft bounce that was delivered on a retry arrived.
        or (i.status = 'sent' and i.es_id is not null and i.bounced_at is not null and i.delivered_at is null)
        or (i.status = 'sent' and i.es_id is not null and i.delivered_at is null and i.bounced_at is null
            and i.opened_at is null and i.sent_at < now() - interval '72 hours')
  ),
  lost_rows as (
    select k.email_type, k.reason,
           sum(coalesce(c.n, 0))::int as n,
           jsonb_agg(coalesce(c.n, 0) order by wk.i) as by_week
      from (select distinct l.email_type, l.reason from lost l) k
     cross join weeks wk
      left join (select l.email_type, l.reason, l.wk, count(*)::int as n from lost l group by 1, 2, 3) c
             on c.email_type = k.email_type and c.reason = k.reason and c.wk = wk.wk
     group by k.email_type, k.reason
  ),
  arms as (
    select i.email_type, f.factor, f.arm,
           count(*)                                                                  as sends,
           count(*) filter (where i.delivered_at is not null)                        as delivered,
           count(*) filter (where i.delivered_at is not null and i.opened_at is not null) as opened,
           count(*) filter (where i.clicked_at is not null)                          as clicked,
           count(*) filter (where i.returned)                                        as returned,
           count(*) filter (where i.made)                                            as made,
           min(i.sent_at)                                                            as first_at,
           max(i.sent_at)                                                            as last_at
      from inwin i
     cross join lateral (values ('subject', i.subject_arm), ('body', i.body_arm)) as f(factor, arm)
     where i.status = 'sent' and f.arm is not null
     group by 1, 2, 3
  )
  select jsonb_build_object(
    'weeks',        (select jsonb_agg(wk.wk order by wk.i) from weeks wk),
    'today',        (now() at time zone 'utc')::date,
    'split',        p_split,
    'tracked_from', (select min(j.es_sent_at) from j where j.status = 'sent'),
    'types',        (select coalesce(jsonb_agg(t.row order by t.email_type), '[]'::jsonb) from types t),
    'months',       (select jsonb_agg(jsonb_build_object('month', m.mo, 'delivered', m.delivered, 'opened', m.opened)
                                      order by m.mo) from months m),
    'signups',      (select jsonb_agg(s.signups order by s.i) from signups s),
    'welcomed',     (select jsonb_agg(s.welcomed order by s.i) from signups s),
    'mailbox',      (select coalesce(jsonb_agg(mb.row order by mb.box), '[]'::jsonb) from mailbox mb),
    'lost',         (select coalesce(jsonb_agg(jsonb_build_object(
                                       'type', lr.email_type, 'reason', lr.reason, 'n', lr.n, 'by_week', lr.by_week)
                                       order by lr.n desc, lr.email_type, lr.reason), '[]'::jsonb) from lost_rows lr),
    'arms',         (select coalesce(jsonb_agg(jsonb_build_object(
                                       'type', a.email_type, 'factor', a.factor, 'arm', a.arm,
                                       'sends', a.sends, 'delivered', a.delivered, 'opened', a.opened,
                                       'clicked', a.clicked, 'returned', a.returned, 'made', a.made,
                                       'first', (a.first_at at time zone 'utc')::date,
                                       'last',  (a.last_at at time zone 'utc')::date)
                                       order by a.email_type, a.factor, a.arm), '[]'::jsonb) from arms a)
  )
  into v_out;

  return v_out;
end $function$;

comment on function public.admin_email_impact(integer, date) is
  'Emails › Impact (0494): every lifecycle email per UTC week for the last p_weeks weeks (sent, held back, failed, delivered, opened, and who placed or edited a card or edited a doc within 72 hours), opens before and after p_split, opened per delivered by calendar month, welcomes per new account by sign-up week, opens by mailbox, sends that never arrived, and every subject and body line under test. The team, banned and service accounts left out.';

revoke execute on function public.admin_email_impact(integer, date) from public, anon;
grant execute on function public.admin_email_impact(integer, date) to authenticated, service_role;

-- ── Proof ───────────────────────────────────────────────────────────────────
do $proof$
declare
  v_sig constant text := 'public.admin_email_impact(integer,date)';
  v_def text;
begin
  if to_regprocedure(v_sig) is null then
    raise exception '0494: % is missing', v_sig;
  end if;
  if has_function_privilege('anon', v_sig, 'execute') then
    raise exception '0494: % is reachable signed out', v_sig;
  end if;
  if not has_function_privilege('authenticated', v_sig, 'execute')
     or not has_function_privilege('service_role', v_sig, 'execute') then
    raise exception '0494: % lost its grant', v_sig;
  end if;
  if obj_description(v_sig::regprocedure, 'pg_proc') not like 'Emails › Impact (0494)%' then
    raise exception '0494: % has no comment', v_sig;
  end if;
  v_def := pg_get_functiondef(v_sig::regprocedure);
  if v_def not like '%perform public._require_admin();%'
     or v_def not like '%bp.banned_at is not null%'
     or v_def not like '%public._internal_user_ids()%' then
    raise exception '0494: % lost its gate or the people it leaves out', v_sig;
  end if;
  if (select count(*) from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname = 'admin_email_impact') <> 1 then
    raise exception '0494: an overload sits beside admin_email_impact';
  end if;
end $proof$;

notify pgrst, 'reload schema';

commit;
