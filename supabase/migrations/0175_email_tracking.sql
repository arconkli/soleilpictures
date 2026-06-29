-- 0175_email_tracking.sql — universal outbound-email observability.
--
-- Until now only the 3 lifecycle nudges were logged (lifecycle_email_log). Every
-- transactional email (waitlist, workspace invites, board shares, pending
-- invites, @mentions, comment replies) was fire-and-forget, and nothing anywhere
-- recorded whether mail actually landed. This adds:
--   • email_sends   — one denormalized row per outbound email (written at the one
--                     choke point, supabase/functions/send-transactional-email).
--   • email_events  — append-only raw Resend webhook log (audit + svix dedup),
--                     mirroring the stripe_webhook_events pattern.
--   • ingest_email_event() — the webhook write path: idempotent (svix_id),
--                     creates a stub send-row for mail we didn't pre-log, and
--                     folds delivered/opened/clicked/bounced/complained into the
--                     send row.
--   • a BEFORE INSERT trigger that resolves user_id from the recipient address,
--     so the edge fn only needs to know the email.
--   • admin_email_stats() + admin_recent_emails() — admin-gated read RPCs that
--     power the new /admin Emails tab.
--
-- lifecycle_email_log stays as-is (it serves caps + the copy bandit); lifecycle
-- sends are intentionally double-bookkept here for unified observability.
--
-- Applied to prod via MCP apply_migration; this file mirrors it for the repo record.

-- ── a. email_sends ───────────────────────────────────────────────────────────
create table if not exists public.email_sends (
  id              bigint generated always as identity primary key,
  resend_id       text unique,                 -- Resend message id; webhook join key
  template        text not null,
  category        text not null,               -- 'transactional' | 'lifecycle' | 'waitlist' | 'external'
  recipient_email text not null,
  user_id         uuid references auth.users on delete set null,  -- resolved by trigger (see d)
  status          text not null default 'sent' check (status in ('sent','failed')),
  -- delivery lifecycle (updated by the webhook):
  delivered_at    timestamptz,
  opened_at       timestamptz,                 -- first open
  clicked_at      timestamptz,                 -- first click
  bounced_at      timestamptz,
  bounce_type     text,
  complained_at   timestamptz,
  last_event      text,                        -- most recent Resend event type
  open_count      int  not null default 0,
  click_count     int  not null default 0,
  error           text,                        -- our-side send error (Resend 4xx/5xx body)
  sent_at         timestamptz not null default now()
);
create index if not exists email_sends_sent_at_idx  on public.email_sends (sent_at desc);
create index if not exists email_sends_template_idx on public.email_sends (template, sent_at desc);
create index if not exists email_sends_user_idx     on public.email_sends (user_id, sent_at desc);

alter table public.email_sends enable row level security;
revoke all on table public.email_sends from anon, authenticated;
grant select on table public.email_sends to authenticated;           -- gated by policy below
grant select, insert, update on table public.email_sends to service_role;
drop policy if exists email_sends_admin_read on public.email_sends;
create policy email_sends_admin_read on public.email_sends
  for select to authenticated using (public.is_admin());

-- ── b. email_events (raw webhook audit + idempotency) ────────────────────────
create table if not exists public.email_events (
  id          bigint generated always as identity primary key,
  svix_id     text unique,         -- dedup: a redelivered webhook is a no-op
  resend_id   text,
  type        text not null,       -- email.delivered, email.opened, email.clicked, ...
  payload     jsonb not null,
  received_at timestamptz not null default now()
);
create index if not exists email_events_resend_idx on public.email_events (resend_id);

alter table public.email_events enable row level security;
revoke all on table public.email_events from anon, authenticated;
grant select on table public.email_events to authenticated;          -- admin policy
grant select, insert on table public.email_events to service_role;
drop policy if exists email_events_admin_read on public.email_events;
create policy email_events_admin_read on public.email_events
  for select to authenticated using (public.is_admin());

-- ── c. ingest_email_event — webhook write path (service-role only) ───────────
create or replace function public.ingest_email_event(
  p_svix_id text, p_resend_id text, p_type text, p_payload jsonb, p_recipient text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- Idempotency: a redelivered webhook (same svix message id) is a no-op.
  insert into public.email_events (svix_id, resend_id, type, payload)
  values (p_svix_id, p_resend_id, p_type, p_payload)
  on conflict (svix_id) do nothing;
  if not found then return; end if;

  if p_resend_id is null then return; end if;

  -- Stub row for mail we didn't pre-log (e.g. GoTrue auth mail in the same
  -- Resend account, or an event that beat the choke-point insert).
  insert into public.email_sends (resend_id, template, category, recipient_email, status)
  values (p_resend_id, 'unknown', 'external', coalesce(nullif(p_recipient,''),'unknown'), 'sent')
  on conflict (resend_id) do nothing;

  update public.email_sends s set
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

-- ── d. resolve user_id from recipient_email on insert ────────────────────────
create or replace function public._tg_email_sends_resolve_user() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is null and new.recipient_email is not null then
    new.user_id := (select id from auth.users where lower(email) = lower(new.recipient_email) limit 1);
  end if;
  return new;
end $$;
drop trigger if exists email_sends_resolve_user on public.email_sends;
create trigger email_sends_resolve_user before insert on public.email_sends
  for each row execute function public._tg_email_sends_resolve_user();

-- ── e. admin read RPCs ───────────────────────────────────────────────────────
-- Per (category, template) counts over the window. Rates are derived client-side.
create or replace function public.admin_email_stats(
  p_days int default 7, p_exclude_internal boolean default true)
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
    and (not p_exclude_internal
         or s.user_id is null
         or s.user_id not in (select iu.user_id from public._internal_user_ids() iu))
  group by s.category, s.template
  order by sent desc;
end $$;
revoke all on function public.admin_email_stats(int, boolean) from public;
grant execute on function public.admin_email_stats(int, boolean) to authenticated;

-- Newest-first individual sends, filterable by template / derived status and
-- searchable by recipient. p_status matches the same furthest-progress labels
-- the UI shows: spam | bounced | failed | clicked | opened | delivered | sent.
create or replace function public.admin_recent_emails(
  p_days int default 7, p_limit int default 200,
  p_template text default null, p_status text default null, p_query text default null)
returns table(
  id bigint, resend_id text, template text, category text, recipient_email text,
  user_id uuid, status text, sent_at timestamptz,
  delivered_at timestamptz, opened_at timestamptz, clicked_at timestamptz,
  bounced_at timestamptz, complained_at timestamptz,
  bounce_type text, open_count int, click_count int, derived_status text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  return query
  select s.id, s.resend_id, s.template, s.category, s.recipient_email,
         s.user_id, s.status, s.sent_at,
         s.delivered_at, s.opened_at, s.clicked_at, s.bounced_at, s.complained_at,
         s.bounce_type, s.open_count, s.click_count,
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
revoke all on function public.admin_recent_emails(int, int, text, text, text) from public;
grant execute on function public.admin_recent_emails(int, int, text, text, text) to authenticated;
