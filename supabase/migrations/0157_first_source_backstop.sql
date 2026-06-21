-- 0157_first_source_backstop.sql
--
-- Server-side backstop for acquisition attribution.
--
-- Until now profiles.first_source was written ONLY by the client set_first_source
-- RPC, fired once on the first SIGNED_IN. If that RPC never landed — a network
-- blip at sign-in, or (the bigger hole) a magic link opened on a DIFFERENT device
-- than where the click happened, where sessionStorage can't follow — the user was
-- stamped empty and showed as 'direct'/'organic' forever.
--
-- AuthGate now threads the captured first-touch bag into signup metadata
-- (raw_user_meta_data.first_source, JSON string), mirroring the existing ad_fbc
-- mechanism. This edits ensure_profile_for_new_user() to stamp it server-side at
-- signup. First-touch-wins (only writes when first_source is still empty), so it
-- never fights the client RPC — whichever lands first wins, the other no-ops.
--
-- The metadata is client-supplied and untrusted: the ::jsonb cast is wrapped in
-- an exception guard so malformed input can never abort the signup, and it is
-- used ONLY for the attribution column (never for authz/tier).
--
-- Applied to prod via MCP apply_migration; this file mirrors it for the repo
-- record (live body dumped from prod before editing — see 0145 for the prior).

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
  v_first_source      jsonb;
begin
  select coalesce(
           (select (value->>'enabled')::boolean
              from public.app_config where key = 'waitlist_enabled'),
           false)
    into v_waitlist_enabled;

  insert into public.profiles (user_id, tier)
  values (new.id, case when v_waitlist_enabled then 'waitlist' else 'demo' end)
  on conflict (user_id) do nothing;

  -- Acquisition backstop: stamp first_source from signup metadata if the client
  -- bag rode along. First-touch-wins; guarded cast so bad metadata can't abort.
  begin
    v_first_source := nullif(new.raw_user_meta_data->>'first_source', '')::jsonb;
    if v_first_source is not null and v_first_source <> '{}'::jsonb then
      update public.profiles
         set first_source = v_first_source
       where user_id = new.id
         and (first_source is null or first_source = '{}'::jsonb);
    end if;
  exception when others then
    null;  -- ignore malformed / non-jsonb client metadata
  end;

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

  -- Waitlist OFF -> upsell everyone: any new demo user gets the one-time offer.
  if not v_waitlist_enabled then
    update public.profiles
       set settings = jsonb_set(coalesce(settings, '{}'::jsonb),
                                '{ad_offer_pending}', 'true'::jsonb)
     where user_id = new.id and tier = 'demo';
  end if;

  return new;
end;
$function$;
