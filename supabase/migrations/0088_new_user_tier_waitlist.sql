-- 0088_new_user_tier_waitlist.sql — fix the new-user tier default that
-- regressed in 0085.
--
-- 0067 set the column default to 'waitlist' and made the trigger insert
-- 'waitlist' so brand-new accounts land in the /welcome onboarding flow
-- where they choose between requesting demo access (joining the waitlist)
-- or paying for instant access. 0085 refactored the trigger to layer
-- paid_grants promotion on top, and in doing so reverted the INSERT
-- literal from 'waitlist' back to 'demo'. 0087 inherited that literal
-- while adding pending_invites claiming. Net effect: every signup since
-- 0085 deployed has been created on the demo tier and TierRouter has
-- routed them straight into the app, skipping waitlist/pricing.
--
-- This migration is a strict superset of 0087's body with the single
-- literal change 'demo' → 'waitlist' on the INSERT. The paid_grants
-- promotion still runs after that initial insert (the 'tier <> admin'
-- guard still allows 'waitlist' to be bumped to 'paid'), so anyone with
-- an active comped grant continues to get instant access on signup. The
-- pending_invites claim call is unchanged.
--
-- Backfill is intentionally NOT performed — fix forward only. Anyone
-- accidentally created as 'demo' between 0085 and 0088 keeps their
-- accidental access. New signups land where they should.
--
-- The trigger attachment itself was set up in 0065 and is unchanged —
-- replacing the function is enough.

create or replace function public.ensure_profile_for_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_email text;
  v_grant public.paid_grants%rowtype;
begin
  insert into public.profiles (user_id, tier)
  values (new.id, 'waitlist')
  on conflict (user_id) do nothing;

  v_email := lower(trim(coalesce(new.email, '')));

  -- (from 0085) link any pre-existing paid_grants row and bump tier.
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

    -- (from 0087) claim any unclaimed invites for this email.
    -- Helper swallows per-row errors so a single bad invite can't fail
    -- account creation.
    perform public._claim_pending_invites_for_user(new.id, v_email);
  end if;

  return new;
end;
$$;
