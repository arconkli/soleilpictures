-- 0212_email_sending_domain.sql — make the email dashboard read Clusters only,
-- and expose send-hour response.
--
-- The Resend account this project's webhook is wired to also carries a DIFFERENT
-- product: 2,013 of 2,763 tracked emails (73%) are auth mail from
-- updates.bountyos.com. ingest_email_event's stub-row path (0175) files all of
-- it as template='unknown', category='external' — indistinguishable in the admin
-- Emails tab from our own untagged mail, and it drags every blended rate with
-- it (that stream opens at 5.9%; Clusters lifecycle opens at 40.2%).
--
-- Fix: record the sending domain from the webhook payload (verified present as
-- data.from on every event) and default every admin read to our own domains.
--
-- NULL sending_domain means "pre-logged by send-transactional-email and no
-- webhook event has landed yet" — that path is our own choke point, so NULL is
-- always ours and is never filtered out.

alter table public.email_sends
  add column if not exists sending_domain text;

create index if not exists email_sends_sending_domain_idx
  on public.email_sends (sending_domain);

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Domain helpers. `from` arrives as a full header ("Clusters
--    <hello@updates.soleilpictures.com>"), so take what's between @ and >.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public._email_from_domain(p_from text)
returns text language sql immutable set search_path = public as $$
  select nullif(lower(trim(substring(coalesce(p_from,'') from '@([^>[:space:]]+)'))), '');
$$;

-- Exact host or a subdomain of it — NOT `like '%soleilpictures.com'`, which
-- would also match a lookalike domain such as notsoleilpictures.com.
create or replace function public._email_domain_is_ours(p_domain text)
returns boolean language sql immutable set search_path = public as $$
  select p_domain is null
      or p_domain = 'soleilpictures.com'
      or p_domain like '%.soleilpictures.com';
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Webhook ingest records the domain — on the stub insert AND on the update,
--    so rows we pre-logged (which have no domain yet) get one on first event.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.ingest_email_event(
  p_svix_id text, p_resend_id text, p_type text, p_payload jsonb, p_recipient text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_domain text;
begin
  -- Idempotency: a redelivered webhook (same svix message id) is a no-op.
  insert into public.email_events (svix_id, resend_id, type, payload)
  values (p_svix_id, p_resend_id, p_type, p_payload)
  on conflict (svix_id) do nothing;
  if not found then return; end if;

  if p_resend_id is null then return; end if;

  v_domain := public._email_from_domain(p_payload->'data'->>'from');

  -- Stub row for mail we didn't pre-log (GoTrue auth mail, or another product
  -- sharing this Resend account, or an event that beat the choke-point insert).
  insert into public.email_sends (resend_id, template, category, recipient_email, status, sending_domain)
  values (p_resend_id, 'unknown', 'external', coalesce(nullif(p_recipient,''),'unknown'), 'sent', v_domain)
  on conflict (resend_id) do nothing;

  update public.email_sends s set
    sending_domain = coalesce(s.sending_domain, v_domain),
    last_event    = p_type,
    delivered_at  = case when p_type='email.delivered'  then coalesce(s.delivered_at, now()) else s.delivered_at end,
    opened_at     = case when p_type='email.opened'     then coalesce(s.opened_at, now())    else s.opened_at end,
    open_count    = s.open_count  + (case when p_type='email.opened'  then 1 else 0 end),
    clicked_at    = case when p_type='email.clicked'    then coalesce(s.clicked_at, now())   else s.clicked_at end,
    click_count   = s.click_count + (case when p_type='email.clicked' then 1 else 0 end),
    bounced_at    = case when p_type='email.bounced'    then now() else s.bounced_at end,
    bounce_type   = case when p_type='email.bounced'    then nullif(p_payload->'data'->>'bounce_type','') else s.bounce_type end,
    complained_at = case when p_type='email.complained' then now() else s.complained_at end
  where s.resend_id = p_resend_id;
end $$;
revoke all on function public.ingest_email_event(text,text,text,jsonb,text) from public;
grant execute on function public.ingest_email_event(text,text,text,jsonb,text) to service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Backfill from the stored event payloads (earliest event per email wins —
--    the from-header is identical across an email's events anyway).
-- ───────────────────────────────────────────────────────────────────────────
with d as (
  select distinct on (resend_id)
         resend_id, public._email_from_domain(payload->'data'->>'from') as domain
  from public.email_events
  where resend_id is not null
  order by resend_id, received_at
)
update public.email_sends s
   set sending_domain = d.domain
  from d
 where d.resend_id = s.resend_id
   and d.domain is not null
   and s.sending_domain is distinct from d.domain;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Admin reads default to our own mail. p_include_foreign restores the old
--    blended view for anyone who wants to audit the raw stream.
-- ───────────────────────────────────────────────────────────────────────────
drop function if exists public.admin_email_stats(int, boolean);
create or replace function public.admin_email_stats(
  p_days int default 7, p_exclude_internal boolean default true,
  p_include_foreign boolean default false)
returns table(
  category text, template text,
  sent bigint, delivered bigint, opened bigint, clicked bigint,
  bounced bigint, complained bigint, failed bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  return query
  select s.category, s.template,
         count(*)                                              as sent,
         count(*) filter (where s.delivered_at  is not null)   as delivered,
         count(*) filter (where s.opened_at     is not null)   as opened,
         count(*) filter (where s.clicked_at    is not null)   as clicked,
         count(*) filter (where s.bounced_at    is not null)   as bounced,
         count(*) filter (where s.complained_at is not null)   as complained,
         count(*) filter (where s.status = 'failed')           as failed
  from public.email_sends s
  where s.sent_at >= now() - make_interval(days => p_days)
    and (p_include_foreign or public._email_domain_is_ours(s.sending_domain))
    and (not p_exclude_internal
         or s.user_id is null
         or s.user_id not in (select iu.user_id from public._internal_user_ids() iu))
  group by s.category, s.template
  order by sent desc;
end $$;
revoke all on function public.admin_email_stats(int, boolean, boolean) from public;
grant execute on function public.admin_email_stats(int, boolean, boolean) to authenticated;

drop function if exists public.admin_recent_emails(int, int, text, text, text);
create or replace function public.admin_recent_emails(
  p_days int default 7, p_limit int default 200,
  p_template text default null, p_status text default null, p_query text default null,
  p_include_foreign boolean default false)
returns table(
  id bigint, resend_id text, template text, category text, recipient_email text,
  user_id uuid, status text, sent_at timestamptz,
  delivered_at timestamptz, opened_at timestamptz, clicked_at timestamptz,
  bounced_at timestamptz, complained_at timestamptz,
  bounce_type text, open_count int, click_count int, sending_domain text, derived_status text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  return query
  select s.id, s.resend_id, s.template, s.category, s.recipient_email,
         s.user_id, s.status, s.sent_at,
         s.delivered_at, s.opened_at, s.clicked_at, s.bounced_at, s.complained_at,
         s.bounce_type, s.open_count, s.click_count, s.sending_domain,
         (case
            when s.complained_at is not null then 'spam'
            when s.bounced_at    is not null then 'bounced'
            when s.status = 'failed'         then 'failed'
            when s.clicked_at    is not null then 'clicked'
            when s.opened_at     is not null then 'opened'
            when s.delivered_at  is not null then 'delivered'
            else 'sent'
          end) as derived_status
  from public.email_sends s
  where s.sent_at >= now() - make_interval(days => p_days)
    and (p_include_foreign or public._email_domain_is_ours(s.sending_domain))
    and (p_template is null or s.template = p_template)
    and (p_query    is null or s.recipient_email ilike '%' || p_query || '%')
    and (p_status   is null or p_status = (case
            when s.complained_at is not null then 'spam'
            when s.bounced_at    is not null then 'bounced'
            when s.status = 'failed'         then 'failed'
            when s.clicked_at    is not null then 'clicked'
            when s.opened_at     is not null then 'opened'
            when s.delivered_at  is not null then 'delivered'
            else 'sent'
          end))
  order by s.sent_at desc
  limit greatest(1, least(p_limit, 1000));
end $$;
revoke all on function public.admin_recent_emails(int, int, text, text, text, boolean) from public;
grant execute on function public.admin_recent_emails(int, int, text, text, text, boolean) to authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 5. Response by send hour. Sends are scheduled at each user's modal activity
--    hour (lifecycle_refresh_send_hours, 0174), which spreads them across all
--    24 UTC hours; observed open rates swing widely between hours but per-hour
--    n is currently 11-40 sends, too thin to act on. This surfaces the series
--    so the question can be settled once volume accumulates, and also reports
--    landed = the first-party lc= arrivals, which is the only click signal not
--    laundered through Resend's tracking proxy.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.admin_email_hour_stats(p_days int default 60)
returns table(utc_hour int, sends bigint, delivered bigint, opened bigint,
              clicked bigint, landed bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  return query
  select extract(hour from l.sent_at)::int as utc_hour,
         count(*)                                            as sends,
         count(*) filter (where es.delivered_at is not null) as delivered,
         count(*) filter (where es.opened_at    is not null) as opened,
         count(*) filter (where es.clicked_at   is not null) as clicked,
         count(*) filter (where exists (
           select 1 from public.analytics_events a
           where a.user_id = l.user_id
             and a.event = 'lifecycle_land'
             and a.occurred_at >  l.sent_at
             and a.occurred_at <= l.sent_at + interval '7 days'))  as landed
  from public.lifecycle_email_log l
  left join public.email_sends es on es.resend_id = l.resend_id
  where l.status = 'sent'
    and l.sent_at >= now() - make_interval(days => p_days)
  group by 1
  order by 1;
end $$;
revoke all on function public.admin_email_hour_stats(int) from public;
grant execute on function public.admin_email_hour_stats(int) to authenticated;
