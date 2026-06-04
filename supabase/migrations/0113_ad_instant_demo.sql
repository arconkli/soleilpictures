-- 0113_ad_instant_demo.sql
--
-- Ad-click → instant demo (campaign-gated).
--
-- Paid-ad traffic is detected by the `fbclid` query param Facebook auto-appends
-- to every ad click (persisted client-side as the Meta `_fbc` value
-- 'fb.1.<ms>.<fbclid>', carried into signup metadata as `ad_fbc`). When the
-- global `ad_instant_demo` flag is ON, such signups skip the waitlist and land
-- on tier='demo' immediately, with a one-time `ad_offer_pending` flag that routes
-- them to a price-first offer screen. Organic/direct traffic is untouched.
--
-- Why this is safe: `demo` is the exact tier the waitlist auto-accept cron grants
-- everyone anyway after a few days — this just fast-tracks it. We still gate on a
-- format check, a 7-day freshness window, and the global flag (also the kill
-- switch). `raw_user_meta_data` is client-settable, so this is a soft signal by
-- design; the worst case of a forged fbclid is skipping a few days' wait for a
-- free tier.

begin;

-- ── 1. Global config: campaign gate / kill switch (OFF by default) ──────────
create table if not exists public.app_config (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_config enable row level security;
drop policy if exists app_config_admin_all on public.app_config;
create policy app_config_admin_all on public.app_config
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

insert into public.app_config (key, value)
  values ('ad_instant_demo', '{"enabled": false}'::jsonb)
  on conflict (key) do nothing;

-- ── 2. Ad-signup cohort (measurement + room for a future daily cap) ─────────
create table if not exists public.ad_signups (
  user_id    uuid primary key references auth.users on delete cascade,
  fbc        text,
  created_at timestamptz not null default now()
);

alter table public.ad_signups enable row level security;
drop policy if exists ad_signups_admin_read on public.ad_signups;
create policy ad_signups_admin_read on public.ad_signups
  for select to authenticated using (public.is_admin());

-- ── 3. Extend the signup trigger with the fbclid → demo branch ──────────────
-- Body below is the LIVE definition (paid_grants → paid, claimed pending_invites
-- → demo) reproduced verbatim, plus the new fbclid block before `return new`.
create or replace function public.ensure_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_email         text;
  v_grant         public.paid_grants%rowtype;
  v_claimed_count int;
  v_fbc           text;
  v_fbc_ms        bigint;
  v_ad_enabled    boolean;
begin
  insert into public.profiles (user_id, tier)
  values (new.id, 'waitlist')
  on conflict (user_id) do nothing;

  v_email := lower(trim(coalesce(new.email, '')));

  if v_email <> '' then
    select * into v_grant
      from public.paid_grants
     where email = v_email
     limit 1;

    if found then
      update public.paid_grants set user_id = new.id where email = v_email;
      if v_grant.revoked_at is null
         and (v_grant.expires_at is null or v_grant.expires_at > now()) then
        update public.profiles
           set tier = 'paid'
         where user_id = new.id and tier <> 'admin';
      end if;
    end if;

    perform public._claim_pending_invites_for_user(new.id, v_email);

    select count(*) into v_claimed_count
      from public.pending_invites
     where claimed_by = new.id;
    if v_claimed_count > 0 then
      update public.profiles
         set tier = 'demo'
       where user_id = new.id and tier = 'waitlist';
    end if;
  end if;

  -- Fast-track FB/IG ad-click traffic to instant demo, only while the campaign
  -- flag is ON. ad_fbc carries the persisted _fbc ('fb.1.<ms>.<fbclid>').
  v_fbc := coalesce(new.raw_user_meta_data->>'ad_fbc', '');
  if v_fbc ~ '^fb\.\d+\.\d+\.' then
    select coalesce(
             (select (value->>'enabled')::boolean
                from public.app_config where key = 'ad_instant_demo'),
             false)
      into v_ad_enabled;
    begin
      v_fbc_ms := split_part(v_fbc, '.', 3)::bigint;
    exception when others then
      v_fbc_ms := 0;
    end;
    -- 7-day freshness: ignore stale click ids lingering in localStorage.
    if v_ad_enabled
       and v_fbc_ms > (extract(epoch from now()) * 1000 - 7 * 86400000) then
      update public.profiles
         set tier = 'demo',
             settings = jsonb_set(coalesce(settings, '{}'::jsonb),
                                  '{ad_offer_pending}', 'true'::jsonb)
       where user_id = new.id and tier = 'waitlist';
      insert into public.ad_signups (user_id, fbc)
        values (new.id, v_fbc)
        on conflict (user_id) do nothing;
    end if;
  end if;

  return new;
end;
$function$;

-- ── 4. Surface the offer flag to the client (drop+recreate to add a column) ──
drop function if exists public.get_my_tier();
create function public.get_my_tier()
returns table(
  tier                 text,
  demo_card_count      integer,
  subscription_status  text,
  current_period_end   timestamptz,
  cancel_at_period_end boolean,
  grant_active         boolean,
  grant_expires_at     timestamptz,
  banned               boolean,
  ad_offer_pending     boolean
)
language sql stable security definer set search_path to 'public' as $function$
  select
    coalesce(p.tier, 'demo')::text,
    coalesce(p.demo_card_count, 0)::integer,
    s.status::text,
    s.current_period_end,
    coalesce(s.cancel_at_period_end, false),
    (gr.hit is not null)                                      as grant_active,
    gr.gexp                                                   as grant_expires_at,
    (p.banned_at is not null)                                 as banned,
    coalesce((p.settings->>'ad_offer_pending')::boolean, false) as ad_offer_pending
  from auth.users u
  left join public.profiles p      on p.user_id = u.id
  left join public.subscriptions s on s.user_id = u.id
  left join lateral (
    select 1 as hit, g.expires_at as gexp
    from public.paid_grants g
    where g.user_id = u.id
      and g.revoked_at is null
      and (g.expires_at is null or g.expires_at > now())
    order by (g.expires_at is null) desc, g.expires_at desc
    limit 1
  ) gr on true
  where u.id = auth.uid()
  limit 1;
$function$;
grant execute on function public.get_my_tier() to authenticated;

-- ── 5. Clear the offer flag when the user chooses "continue into workspace" ──
create or replace function public.dismiss_ad_offer()
returns void
language sql security definer set search_path to 'public' as $function$
  update public.profiles
     set settings = jsonb_set(coalesce(settings, '{}'::jsonb),
                              '{ad_offer_pending}', 'false'::jsonb)
   where user_id = auth.uid();
$function$;
grant execute on function public.dismiss_ad_offer() to authenticated;

-- ── 6. Admin toggle for the campaign gate (flip per campaign, no deploy) ─────
create or replace function public.admin_set_ad_instant_demo(p_enabled boolean)
returns boolean
language plpgsql security definer set search_path to 'public' as $function$
begin
  perform public._require_admin();
  insert into public.app_config (key, value, updated_at)
    values ('ad_instant_demo', jsonb_build_object('enabled', coalesce(p_enabled, false)), now())
  on conflict (key) do update
    set value = jsonb_build_object('enabled', coalesce(p_enabled, false)),
        updated_at = now();
  return coalesce(p_enabled, false);
end;
$function$;
grant execute on function public.admin_set_ad_instant_demo(boolean) to authenticated;

commit;
