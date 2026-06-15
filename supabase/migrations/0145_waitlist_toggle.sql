-- 0145_waitlist_toggle.sql
--
-- Make the waitlist a re-enableable master switch, and turn it OFF.
--
-- Until now every new signup defaulted to tier='waitlist' (gated out of the app
-- behind /welcome → /waitlist/status) unless they were an admin-comped paid
-- grant, a claimed invite, or fresh FB/IG ad-click traffic. We add an
-- `app_config.waitlist_enabled` master flag (mirroring `ad_instant_demo`):
--
--   waitlist_enabled = false (DEFAULT, set here)
--     → new signups land on tier='demo' immediately AND get the one-time
--       `ad_offer_pending` flag, so EVERYONE sees the price-first AdWelcome
--       Creator offer once, then steps straight into the app — exactly the
--       experience ad traffic already gets.
--   waitlist_enabled = true
--     → new signups default to tier='waitlist' again and hit the existing gate;
--       the accept-cron, edge functions, and admin queue are all still wired.
--
-- Re-enabling is a single flag flip (admin toggle or admin_set_waitlist_enabled).
-- Nothing is torn down: the column default, pg_cron job, edge functions, the
-- 'waitlist' tier value, and the welcome/waitlist screens are intentionally kept.

begin;

-- ── 1. Master flag: waitlist gate (OFF by default) ──────────────────────────
-- app_config + its RLS already exist (created in 0113_ad_instant_demo.sql).
insert into public.app_config (key, value)
  values ('waitlist_enabled', '{"enabled": false}'::jsonb)
  on conflict (key) do nothing;

-- ── 2. Signup trigger: flag-driven default tier + upsell-everyone-when-off ───
-- Body below is the LIVE definition reproduced verbatim, plus three changes:
--   (a) read the waitlist_enabled flag,
--   (b) default tier = waitlist when ON, demo when OFF,
--   (c) when OFF, set ad_offer_pending for every new demo user (so all signups
--       see the AdWelcome offer). paid_grant users are 'paid', so excluded.
-- The paid_grants / invite / fbclid branches are unchanged: when the waitlist
-- is OFF the row is already 'demo' so their `where tier='waitlist'` bumps no-op
-- (the ad_signups cohort insert still runs); when ON they behave as before.
create or replace function public.ensure_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_email             text;
  v_grant             public.paid_grants%rowtype;
  v_claimed_count     int;
  v_fbc               text;
  v_fbc_ms            bigint;
  v_ad_enabled        boolean;
  v_waitlist_enabled  boolean;
begin
  select coalesce(
           (select (value->>'enabled')::boolean
              from public.app_config where key = 'waitlist_enabled'),
           false)
    into v_waitlist_enabled;

  insert into public.profiles (user_id, tier)
  values (new.id, case when v_waitlist_enabled then 'waitlist' else 'demo' end)
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

  -- Waitlist OFF → upsell everyone: any new demo user (not paid/admin) gets the
  -- one-time price-first offer (AdWelcome) before entering the app.
  if not v_waitlist_enabled then
    update public.profiles
       set settings = jsonb_set(coalesce(settings, '{}'::jsonb),
                                '{ad_offer_pending}', 'true'::jsonb)
     where user_id = new.id and tier = 'demo';
  end if;

  return new;
end;
$function$;

-- ── 3. Admin toggle for the waitlist gate (flip without a deploy) ────────────
create or replace function public.admin_set_waitlist_enabled(p_enabled boolean)
returns boolean
language plpgsql security definer set search_path to 'public' as $function$
begin
  perform public._require_admin();
  insert into public.app_config (key, value, updated_at)
    values ('waitlist_enabled', jsonb_build_object('enabled', coalesce(p_enabled, false)), now())
  on conflict (key) do update
    set value = jsonb_build_object('enabled', coalesce(p_enabled, false)),
        updated_at = now();
  return coalesce(p_enabled, false);
end;
$function$;
grant execute on function public.admin_set_waitlist_enabled(boolean) to authenticated;

-- ── 4. Let existing waitlisters in, with the same one-time offer ─────────────
-- (Includes anyone previously held/rejected — intended now that the gate is off.)
update public.profiles
   set tier = 'demo',
       settings = jsonb_set(coalesce(settings, '{}'::jsonb),
                            '{ad_offer_pending}', 'true'::jsonb)
 where tier = 'waitlist';

-- ── 5. Close out pending queue rows so the admin queue / stats read honestly ─
-- (Entries are kept for history; the accept-cron now has nothing to process.)
update public.waitlist_entries
   set status = 'accepted',
       accepted_at = coalesce(accepted_at, now())
 where status = 'pending';

commit;
