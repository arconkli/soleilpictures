-- 0087_claim_pending_invites_on_signup.sql — backstop hook into the
-- auth.users INSERT trigger so a fresh signup automatically inherits
-- any pending_invites that match the new account's email, even if the
-- invitee never clicked the magic-link.
--
-- This is a strict superset of the prior versions of
-- ensure_profile_for_new_user defined in 0065 and 0085:
--   • 0065: insert profile row with tier='demo'
--   • 0085: link any matching paid_grants row and bump tier='paid'
--   • 0087: also claim any matching pending_invites (THIS migration)
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
  values (new.id, 'demo')
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

    -- (new in 0087) claim any unclaimed invites for this email.
    -- Helper swallows per-row errors so a single bad invite can't fail
    -- account creation.
    perform public._claim_pending_invites_for_user(new.id, v_email);
  end if;

  return new;
end;
$$;
