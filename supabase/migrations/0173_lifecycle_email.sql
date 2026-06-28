-- 0173_lifecycle_email.sql — behavioral lifecycle email program.
--
-- Three "simple note" emails, all sent by a daily pg_cron scan (absence-of-
-- action can't be event-triggered), with hard caps enforced in the schema:
--   • activate_nudge_1  — demo signup, not activated, quiet (24h–120h after access)
--   • activate_nudge_2  — final activation nudge        (120h–336h after access)
--   • reengage_1        — activated then went quiet >21d (incl. paid; 45d cooldown)
--
-- Consent: one umbrella notification_prefs key 'email_lifecycle' (default-on via
-- the existing _email_pref_enabled). One-click unsubscribe works logged-out via a
-- token in a service-role-only table + the public /api/unsubscribe worker route.

-- ───────────────────────────────────────────────────────────────────────────
-- a. Access-grant stamp — activation windows anchor on when a user actually got
--    app access, NOT auth.users.created_at. Waitlisted users OTP-confirm at
--    signup but only get access when waitlist-accept-cron flips them to 'demo'.
-- ───────────────────────────────────────────────────────────────────────────
alter table public.profiles add column if not exists activated_access_at timestamptz;

update public.profiles p
   set activated_access_at = coalesce(
         (select w.accepted_at from public.waitlist_entries w where w.email = u.email),
         u.created_at)
  from auth.users u
 where u.id = p.user_id
   and p.tier in ('demo','paid','admin')
   and p.activated_access_at is null;

-- ───────────────────────────────────────────────────────────────────────────
-- b. Unsubscribe token — SEPARATE service-role-only table. Must NOT live on
--    profiles: the "ws-mate read profile" SELECT policy (0030) + table grant
--    (0091) would expose the token to any workspace co-member, who could then
--    opt the victim out.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.email_unsub_tokens (
  user_id uuid primary key references auth.users on delete cascade,
  token   text not null unique default encode(extensions.gen_random_bytes(32),'hex')  -- 256-bit
);
alter table public.email_unsub_tokens enable row level security;
revoke all on public.email_unsub_tokens from anon, authenticated;  -- no policy => service_role only

-- backfill one distinct token per existing user (volatile default fires per row)
insert into public.email_unsub_tokens (user_id)
  select id from auth.users
  on conflict do nothing;

-- new users get a token the moment their profile is created (same txn)
create or replace function public._tg_create_unsub_token() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into public.email_unsub_tokens (user_id) values (new.user_id) on conflict do nothing;
  return new;
end $$;
drop trigger if exists profiles_unsub_token_trigger on public.profiles;
create trigger profiles_unsub_token_trigger
  after insert on public.profiles
  for each row execute function public._tg_create_unsub_token();

-- ───────────────────────────────────────────────────────────────────────────
-- c. Send log + caps. The unique indexes ARE the idempotency guarantee.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.lifecycle_email_log (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  email_type      text not null
                  check (email_type in ('activate_nudge_1','activate_nudge_2','reengage_1')),
  recipient_email text not null,
  status          text not null default 'claimed' check (status in ('claimed','sent','failed')),
  resend_id       text,
  sent_at         timestamptz not null default now(),
  sent_on         date not null default (now() at time zone 'utc')::date
);

-- CAP A: each activation type at most once => max 2 activation nudges ever.
create unique index if not exists lifecycle_email_log_activation_once_idx
  on public.lifecycle_email_log (user_id, email_type)
  where email_type in ('activate_nudge_1','activate_nudge_2');

-- CAP B (global backstop): one lifecycle email per user per UTC day. Defeats
-- same-day double-sends/retries for ALL types, including the re-fireable reengage.
create unique index if not exists lifecycle_email_log_user_day_idx
  on public.lifecycle_email_log (user_id, sent_on);

-- cooldown / already-sent lookups
create index if not exists lifecycle_email_log_user_type_sent_idx
  on public.lifecycle_email_log (user_id, email_type, sent_at desc);

alter table public.lifecycle_email_log enable row level security;
revoke all on table public.lifecycle_email_log from anon, authenticated;
grant select on table public.lifecycle_email_log to authenticated;  -- rows admin-gated by policy
grant select, insert, update on table public.lifecycle_email_log to service_role;
drop policy if exists lifecycle_email_log_admin_read on public.lifecycle_email_log;
create policy lifecycle_email_log_admin_read on public.lifecycle_email_log
  for select to authenticated using (public.is_admin());

-- index for the reengage "most recent populated board" lateral
create index if not exists boards_created_by_updated_idx
  on public.boards (created_by, updated_at desc);

-- ───────────────────────────────────────────────────────────────────────────
-- d. Claim RPC — the single write path. Atomically locks the send (unique index)
--    AND re-checks consent at write time (closes the unsubscribe TOCTOU between
--    the eligibility scan and the actual send).
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.lifecycle_claim_send(
  p_user_id uuid, p_email_type text, p_recipient_email text
) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  insert into public.lifecycle_email_log (user_id, email_type, recipient_email, status)
  select p_user_id, p_email_type, p_recipient_email, 'claimed'
  where public._email_pref_enabled(p_user_id, 'email_lifecycle')
  on conflict do nothing
  returning id into v_id;
  return v_id;   -- null => cap hit OR consent withdrawn since the scan
end $$;
revoke all on function public.lifecycle_claim_send(uuid, text, text) from public;
grant execute on function public.lifecycle_claim_send(uuid, text, text) to service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- e. Eligibility RPCs (service-role only). Shared exclusions: confirmed email,
--    not banned, consent on, not internal/test, not already sent.
-- ───────────────────────────────────────────────────────────────────────────

-- (A) activate_nudge_1 — workspace deep-link only (no populated board yet)
create or replace function public.lifecycle_due_activate_nudge_1(
  p_min_hours int default 24, p_max_hours int default 120,
  p_quiet_hours int default 24, p_exclude_internal boolean default true)
returns table(user_id uuid, email text, display_name text, workspace_id uuid, unsub_token text)
language sql stable security definer set search_path = public as $$
  select u.id, u.email::text,
         coalesce(nullif(p.display_name,''), initcap(split_part(u.email,'@',1))),
         ws.workspace_id, t.token
  from auth.users u
  join public.profiles p on p.user_id = u.id
  join public.email_unsub_tokens t on t.user_id = u.id
  left join public.user_presence pr on pr.user_id = u.id
  left join lateral (
    select w.id as workspace_id from public.workspaces w
    where w.created_by = u.id order by w.created_at limit 1
  ) ws on true
  where u.email_confirmed_at is not null and u.email is not null
    and p.tier = 'demo'
    and coalesce(p.activated_access_at, u.created_at) <= now() - make_interval(hours => p_min_hours)
    and coalesce(p.activated_access_at, u.created_at) >  now() - make_interval(hours => p_max_hours)
    and p.first_populated_board_at is null
    and (pr.last_seen_at is null or pr.last_seen_at < now() - make_interval(hours => p_quiet_hours))
    and p.banned_at is null
    and (not p_exclude_internal or u.id not in (select iu.user_id from public._internal_user_ids() iu))
    and public._email_pref_enabled(u.id, 'email_lifecycle')
    and not exists (select 1 from public.lifecycle_email_log l
                    where l.user_id = u.id and l.email_type = 'activate_nudge_1');
$$;
revoke all on function public.lifecycle_due_activate_nudge_1(int,int,int,boolean) from public;
grant execute on function public.lifecycle_due_activate_nudge_1(int,int,int,boolean) to service_role;

-- (B) activate_nudge_2 — identical, later window, final nudge
create or replace function public.lifecycle_due_activate_nudge_2(
  p_min_hours int default 120, p_max_hours int default 336,
  p_quiet_hours int default 24, p_exclude_internal boolean default true)
returns table(user_id uuid, email text, display_name text, workspace_id uuid, unsub_token text)
language sql stable security definer set search_path = public as $$
  select u.id, u.email::text,
         coalesce(nullif(p.display_name,''), initcap(split_part(u.email,'@',1))),
         ws.workspace_id, t.token
  from auth.users u
  join public.profiles p on p.user_id = u.id
  join public.email_unsub_tokens t on t.user_id = u.id
  left join public.user_presence pr on pr.user_id = u.id
  left join lateral (
    select w.id as workspace_id from public.workspaces w
    where w.created_by = u.id order by w.created_at limit 1
  ) ws on true
  where u.email_confirmed_at is not null and u.email is not null
    and p.tier = 'demo'
    and coalesce(p.activated_access_at, u.created_at) <= now() - make_interval(hours => p_min_hours)
    and coalesce(p.activated_access_at, u.created_at) >  now() - make_interval(hours => p_max_hours)
    and p.first_populated_board_at is null
    and (pr.last_seen_at is null or pr.last_seen_at < now() - make_interval(hours => p_quiet_hours))
    and p.banned_at is null
    and (not p_exclude_internal or u.id not in (select iu.user_id from public._internal_user_ids() iu))
    and public._email_pref_enabled(u.id, 'email_lifecycle')
    and not exists (select 1 from public.lifecycle_email_log l
                    where l.user_id = u.id and l.email_type = 'activate_nudge_2');
$$;
revoke all on function public.lifecycle_due_activate_nudge_2(int,int,int,boolean) from public;
grant execute on function public.lifecycle_due_activate_nudge_2(int,int,int,boolean) to service_role;

-- (C) reengage_1 — activated then dormant >21d; deep-link to their populated
--     board + its name; 45d cooldown is the repeat-send dedup (re-fireable).
create or replace function public.lifecycle_due_reengage_1(
  p_dormant_days int default 21, p_cooldown_days int default 45,
  p_exclude_internal boolean default true)
returns table(user_id uuid, email text, display_name text,
              workspace_id uuid, board_id uuid, board_name text, unsub_token text)
language sql stable security definer set search_path = public as $$
  select u.id, u.email::text,
         coalesce(nullif(p.display_name,''), initcap(split_part(u.email,'@',1))),
         bd.workspace_id, bd.board_id, bd.board_name, t.token
  from auth.users u
  join public.profiles p on p.user_id = u.id
  join public.email_unsub_tokens t on t.user_id = u.id
  left join public.user_presence pr on pr.user_id = u.id
  left join lateral (
    select b.id as board_id, b.workspace_id, b.name as board_name
    from public.boards b
    where b.created_by = u.id
      and (select count(*) from public.card_index ci
           where ci.board_id = b.id and ci.card_id not like 'onb-%') >= 3
    order by b.updated_at desc limit 1
  ) bd on true
  where u.email_confirmed_at is not null and u.email is not null
    and p.tier in ('demo','paid')
    and p.first_populated_board_at is not null
    and (pr.last_seen_at is null or pr.last_seen_at < now() - make_interval(days => p_dormant_days))
    and p.banned_at is null
    and (not p_exclude_internal or u.id not in (select iu.user_id from public._internal_user_ids() iu))
    and public._email_pref_enabled(u.id, 'email_lifecycle')
    and not exists (select 1 from public.lifecycle_email_log l
                    where l.user_id = u.id and l.email_type = 'reengage_1'
                      and l.sent_at > now() - make_interval(days => p_cooldown_days));
$$;
revoke all on function public.lifecycle_due_reengage_1(int,int,boolean) from public;
grant execute on function public.lifecycle_due_reengage_1(int,int,boolean) to service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- f. Public unsubscribe RPC. Called by the worker with the service-role key.
--    No-enumeration: returns token validity, never email existence.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.email_unsubscribe(p_token text, p_key text default 'email_lifecycle')
returns boolean language plpgsql security definer set search_path = public as $$
declare v_uid uuid;
begin
  if p_key not in ('email_lifecycle') then return false; end if;     -- key allowlist
  update public.profiles
     set notification_prefs = jsonb_set(coalesce(notification_prefs,'{}'::jsonb),
                                        array[p_key], 'false'::jsonb, true)
   where user_id = (select user_id from public.email_unsub_tokens where token = p_token)
   returning user_id into v_uid;
  return v_uid is not null;
end $$;
revoke all on function public.email_unsubscribe(text, text) from public, anon, authenticated;
grant execute on function public.email_unsubscribe(text, text) to service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- g. Admin stats — directional send + outcome counts (admin-gated).
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.admin_lifecycle_email_stats(p_window_days int default 14)
returns table(email_type text, sent bigint, activated_or_returned bigint)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform public._require_admin();
  return query
  select l.email_type,
         count(*) filter (where l.status='sent'),
         count(*) filter (where l.status='sent' and (
           (l.email_type like 'activate%' and p.first_populated_board_at > l.sent_at
              and p.first_populated_board_at <= l.sent_at + make_interval(days => p_window_days))
           or
           (l.email_type = 'reengage_1' and pr.last_seen_at > l.sent_at
              and pr.last_seen_at <= l.sent_at + make_interval(days => p_window_days))))
  from public.lifecycle_email_log l
  join public.profiles p on p.user_id = l.user_id
  left join public.user_presence pr on pr.user_id = l.user_id
  group by l.email_type;
end $$;
revoke all on function public.admin_lifecycle_email_stats(int) from public;
grant execute on function public.admin_lifecycle_email_stats(int) to authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- h. Daily scan. Mirrors the 0069 waitlist-accept-cron scheduling pattern.
--    24h spacing => ticks can never stack.
-- ───────────────────────────────────────────────────────────────────────────
create extension if not exists pg_cron;

do $$ declare v_jobid bigint; begin
  for v_jobid in select jobid from cron.job where jobname = 'lifecycle-email-daily' loop
    perform cron.unschedule(v_jobid);
  end loop;
end$$;

select cron.schedule(
  'lifecycle-email-daily',
  '0 15 * * *',
  $cron$
    select net.http_post(
      url     := 'https://ehlhlmbpwwalmeisvmdp.supabase.co/functions/v1/lifecycle-email-cron',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1
        )
      ),
      body    := jsonb_build_object()
    );
  $cron$
);

-- ── Cron auth bootstrap (this project) ──────────────────────────────────────
-- The Vault 'service_role_key' secret is NOT set on this project, so the Bearer
-- form above will 401 (same situation as the waitlist cron). The deployed job is
-- re-scheduled out-of-band to send the shared CRON_SECRET via x-cron-secret,
-- which the edge function also accepts:
--
--   select cron.unschedule(jobid) from cron.job where jobname='lifecycle-email-daily';
--   select cron.schedule('lifecycle-email-daily','0 15 * * *', $cron$
--     select net.http_post(
--       url     := 'https://ehlhlmbpwwalmeisvmdp.supabase.co/functions/v1/lifecycle-email-cron',
--       headers := jsonb_build_object('Content-Type','application/json',
--                  'x-cron-secret','<CRON_SECRET>'),
--       body    := jsonb_build_object());
--   $cron$);
--
-- Alternatively, set Vault 'service_role_key' once and the committed form works:
--   insert into vault.secrets (name, secret) values ('service_role_key','<KEY>')
--     on conflict (name) do update set secret = excluded.secret;
