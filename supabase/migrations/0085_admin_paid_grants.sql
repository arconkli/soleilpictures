-- 0085_admin_paid_grants.sql — admin-issued time-bound paid access grants.
--
-- Lets an admin grant paid-tier access to any email, for N days or
-- forever, even before the user has signed up. On first sign-in the
-- existing ensure_profile_for_new_user trigger picks up the grant
-- and flips tier=paid. A small hourly sweep downgrades expired
-- grants back to demo (unless they also have an active Stripe sub).
--
-- The grant lives independently of Stripe: either source can keep a
-- user paid, and one ending does not affect the other.

------------------------------------------------------------------
-- 1. TABLE
------------------------------------------------------------------
create table if not exists public.paid_grants (
  email             text primary key,                              -- lower(trim(...))
  user_id           uuid references auth.users on delete cascade,  -- null until first sign-in
  expires_at        timestamptz,                                   -- null = forever
  granted_at        timestamptz not null default now(),
  granted_by        uuid references auth.users on delete set null,
  granted_by_email  text,                                          -- snapshot, survives admin deletion
  revoked_at        timestamptz,
  revoked_by        uuid references auth.users on delete set null,
  note              text
);
create index if not exists paid_grants_user_id_active_idx
  on public.paid_grants (user_id) where revoked_at is null;
create index if not exists paid_grants_expires_active_idx
  on public.paid_grants (expires_at) where revoked_at is null;

alter table public.paid_grants enable row level security;

drop policy if exists "grants read admin" on public.paid_grants;
create policy "grants read admin" on public.paid_grants for select using (
  exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.tier = 'admin')
);
-- No INSERT/UPDATE/DELETE policies — all writes via SECURITY DEFINER RPCs below.

------------------------------------------------------------------
-- 2. STATUS HELPER (used by list RPC + count RPC)
------------------------------------------------------------------
create or replace function public._grant_status(p_revoked timestamptz, p_expires timestamptz)
returns text language sql immutable as $$
  select case
    when p_revoked is not null then 'revoked'
    when p_expires is null     then 'forever'
    when p_expires <= now()    then 'expired'
    else 'active'
  end;
$$;

------------------------------------------------------------------
-- 3. EXTEND ensure_profile_for_new_user (originally 0065)
--
-- After creating the profile, link any pre-existing grant matching
-- the new user's email and bump tier=paid if the grant is active.
------------------------------------------------------------------
create or replace function public.ensure_profile_for_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_email text;
  v_grant public.paid_grants%rowtype;
begin
  insert into public.profiles (user_id, tier)
  values (new.id, 'demo')
  on conflict (user_id) do nothing;

  v_email := lower(trim(coalesce(new.email, '')));
  if v_email = '' then
    return new;
  end if;

  select * into v_grant
    from public.paid_grants
   where email = v_email
   limit 1;
  if not found then
    return new;
  end if;

  update public.paid_grants set user_id = new.id where email = v_email;

  if v_grant.revoked_at is null
     and (v_grant.expires_at is null or v_grant.expires_at > now()) then
    update public.profiles
       set tier = 'paid'
     where user_id = new.id and tier <> 'admin';
  end if;

  return new;
end;
$$;
-- Trigger is already attached from 0065 — replacing the function is enough.

------------------------------------------------------------------
-- 4. RPC: admin_grant_paid_access(emails[], duration_days, note)
--
-- duration_days = null  → forever (expires_at = null)
-- duration_days > 0     → expires_at = now() + N days
-- Re-grant on an existing email replaces the prior expiry and
-- clears any revoked_at (so revoke + regrant = active again).
------------------------------------------------------------------
create or replace function public.admin_grant_paid_access(
  p_emails text[],
  p_duration_days int default null,
  p_note text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_admin_uid    uuid := auth.uid();
  v_admin_email  text;
  v_expires_at   timestamptz;
  v_email_in     text;
  v_email        text;
  v_user_id      uuid;
  v_note         text := nullif(trim(coalesce(p_note, '')), '');
  v_invalid      int := 0;
  v_granted      int := 0;
  v_linked       int := 0;
  v_pending      int := 0;
begin
  perform public._require_admin();

  if p_duration_days is not null then
    if p_duration_days <= 0 then
      raise exception 'duration_days must be positive or null (for forever)'
        using errcode = '22023';
    end if;
    v_expires_at := now() + (p_duration_days || ' days')::interval;
  end if;

  select email::text into v_admin_email from auth.users where id = v_admin_uid;

  if p_emails is null or array_length(p_emails, 1) is null then
    return jsonb_build_object(
      'total', 0, 'granted', 0, 'linked_existing_user', 0,
      'pending_signup', 0, 'invalid', 0
    );
  end if;

  foreach v_email_in in array p_emails loop
    v_email := lower(trim(coalesce(v_email_in, '')));
    if v_email = '' or position('@' in v_email) = 0 then
      v_invalid := v_invalid + 1;
      continue;
    end if;

    select id into v_user_id from auth.users where email = v_email;

    insert into public.paid_grants (
      email, user_id, expires_at, granted_at,
      granted_by, granted_by_email, revoked_at, revoked_by, note
    ) values (
      v_email, v_user_id, v_expires_at, now(),
      v_admin_uid, v_admin_email, null, null, v_note
    )
    on conflict (email) do update set
      user_id          = coalesce(excluded.user_id, public.paid_grants.user_id),
      expires_at       = excluded.expires_at,
      granted_at       = excluded.granted_at,
      granted_by       = excluded.granted_by,
      granted_by_email = excluded.granted_by_email,
      revoked_at       = null,
      revoked_by       = null,
      note             = excluded.note;

    v_granted := v_granted + 1;
    if v_user_id is null then
      v_pending := v_pending + 1;
    else
      v_linked := v_linked + 1;
      update public.profiles set tier = 'paid'
       where user_id = v_user_id and tier <> 'admin';
    end if;
  end loop;

  return jsonb_build_object(
    'total',                array_length(p_emails, 1),
    'granted',              v_granted,
    'linked_existing_user', v_linked,
    'pending_signup',       v_pending,
    'invalid',              v_invalid
  );
end;
$$;
revoke all on function public.admin_grant_paid_access(text[], int, text) from public;
grant execute on function public.admin_grant_paid_access(text[], int, text) to authenticated;

------------------------------------------------------------------
-- 5. RPC: admin_revoke_paid_access(email)
--
-- Marks the grant revoked. If the user has no active Stripe sub,
-- drops their tier to demo immediately.
------------------------------------------------------------------
create or replace function public.admin_revoke_paid_access(p_email text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_email     text := lower(trim(coalesce(p_email, '')));
  v_admin_uid uuid := auth.uid();
  v_user_id   uuid;
  v_has_sub   boolean;
begin
  perform public._require_admin();

  if v_email = '' then
    raise exception 'email required' using errcode = '22023';
  end if;

  update public.paid_grants
     set revoked_at = now(), revoked_by = v_admin_uid
   where email = v_email
     and revoked_at is null
  returning user_id into v_user_id;

  if not found then
    raise exception 'no active grant for %', p_email using errcode = 'P0002';
  end if;

  if v_user_id is null then
    return;  -- pre-signup grant; nothing to downgrade
  end if;

  select exists (
    select 1 from public.subscriptions
     where user_id = v_user_id and status in ('active', 'trialing')
  ) into v_has_sub;

  if not v_has_sub then
    update public.profiles set tier = 'demo'
     where user_id = v_user_id and tier = 'paid';
  end if;
end;
$$;
revoke all on function public.admin_revoke_paid_access(text) from public;
grant execute on function public.admin_revoke_paid_access(text) to authenticated;

------------------------------------------------------------------
-- 6. RPC: admin_list_paid_grants (paginated, filterable)
------------------------------------------------------------------
create or replace function public.admin_list_paid_grants(
  p_limit  int default 50,
  p_offset int default 0,
  p_query  text default null,
  p_status text default null
)
returns table(
  email             text,
  user_id           uuid,
  signed_up         boolean,
  current_tier      text,
  expires_at        timestamptz,
  status            text,
  granted_at        timestamptz,
  granted_by_email  text,
  revoked_at        timestamptz,
  note              text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_q text := nullif(trim(coalesce(p_query, '')), '');
  v_s text := nullif(trim(coalesce(p_status, '')), '');
begin
  perform public._require_admin();
  p_limit  := greatest(1, least(p_limit, 200));
  p_offset := greatest(0, p_offset);

  return query
  select
    g.email,
    g.user_id,
    (g.user_id is not null)                              as signed_up,
    p.tier                                               as current_tier,
    g.expires_at,
    public._grant_status(g.revoked_at, g.expires_at)     as status,
    g.granted_at,
    g.granted_by_email,
    g.revoked_at,
    g.note
  from public.paid_grants g
  left join public.profiles p on p.user_id = g.user_id
  where (v_q is null or g.email ilike '%' || v_q || '%')
    and (v_s is null or public._grant_status(g.revoked_at, g.expires_at) = v_s)
  order by
    case when g.revoked_at is not null then 1 else 0 end asc,           -- active first
    case when g.expires_at is null then 0 else 1 end asc,               -- forever before timed
    g.expires_at asc nulls last,                                        -- soonest expiring first
    g.granted_at desc                                                   -- newest as tiebreaker
  limit p_limit offset p_offset;
end;
$$;
revoke all on function public.admin_list_paid_grants(int, int, text, text) from public;
grant execute on function public.admin_list_paid_grants(int, int, text, text) to authenticated;

create or replace function public.admin_paid_grants_count(
  p_query  text default null,
  p_status text default null
)
returns bigint language plpgsql stable security definer set search_path = public as $$
declare
  v_q text := nullif(trim(coalesce(p_query, '')), '');
  v_s text := nullif(trim(coalesce(p_status, '')), '');
  v_n bigint;
begin
  perform public._require_admin();
  select count(*) into v_n
    from public.paid_grants g
   where (v_q is null or g.email ilike '%' || v_q || '%')
     and (v_s is null or public._grant_status(g.revoked_at, g.expires_at) = v_s);
  return v_n;
end;
$$;
revoke all on function public.admin_paid_grants_count(text, text) from public;
grant execute on function public.admin_paid_grants_count(text, text) to authenticated;

------------------------------------------------------------------
-- 7. Active-grant lookup (used by the stripe-webhook to skip the
-- demo-downgrade when a user still has an admin grant). Not granted
-- to `authenticated` so we don't leak per-user grant existence;
-- service_role bypasses GRANTs and calls it from the webhook.
------------------------------------------------------------------
create or replace function public.user_has_active_paid_grant(p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.paid_grants g
     where g.user_id = p_user_id
       and g.revoked_at is null
       and (g.expires_at is null or g.expires_at > now())
  );
$$;
revoke all on function public.user_has_active_paid_grant(uuid) from public;

------------------------------------------------------------------
-- 8. SWEEP — downgrade users whose grant has expired and who have
-- no active Stripe subscription. Idempotent.
--
-- Callable by:
--   • pg_cron (auth.uid() is null → no admin check)
--   • admins from the Grants tab (opportunistic refresh)
------------------------------------------------------------------
create or replace function public.sweep_expired_paid_grants()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  if auth.uid() is not null then
    perform public._require_admin();
  end if;

  with downgrades as (
    update public.profiles p
       set tier = 'demo'
     where p.tier = 'paid'
       and exists (
         select 1 from public.paid_grants g
          where g.user_id = p.user_id
            and g.revoked_at is null
            and g.expires_at is not null
            and g.expires_at <= now()
       )
       and not exists (
         select 1 from public.subscriptions s
          where s.user_id = p.user_id
            and s.status in ('active', 'trialing')
       )
    returning p.user_id
  )
  select count(*)::int into v_n from downgrades;
  return v_n;
end;
$$;
revoke all on function public.sweep_expired_paid_grants() from public;
grant execute on function public.sweep_expired_paid_grants() to authenticated;

------------------------------------------------------------------
-- 9. CRON — hourly sweep via pg_cron.
-- 17 min past the hour, just to avoid the top-of-hour rush.
-- Idempotent: removes any pre-existing same-named job first.
------------------------------------------------------------------
create extension if not exists pg_cron;

do $$
declare j record;
begin
  for j in select jobid from cron.job where jobname = 'sweep_expired_paid_grants' loop
    perform cron.unschedule(j.jobid);
  end loop;
end $$;

select cron.schedule(
  'sweep_expired_paid_grants',
  '17 * * * *',
  $$ select public.sweep_expired_paid_grants(); $$
);
