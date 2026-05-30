-- 0089_invitee_skip_waitlist.sql — let invited users skip the waitlist
-- gate at signup.
--
-- 0088 correctly defaults new accounts to tier='waitlist' so cold-walk-in
-- signups land on /welcome (request demo access via socials, or pay for
-- instant access). But somebody who was explicitly invited to a board or
-- workspace shouldn't hit that gate — the inviter already trusts them.
-- Today they sign up, the trigger writes their board_shares /
-- workspace_members grant via _claim_pending_invites_for_user(), then
-- TierRouter bounces them to /welcome anyway because they're still on
-- tier='waitlist'. Their grant lives in the DB but is unreachable.
--
-- This migration is a strict superset of 0088's trigger: after the
-- pending-invite claim runs, we count rows in pending_invites where
-- claimed_by = new.id. If at least one invite was claimed for this user,
-- we bump tier 'waitlist' -> 'demo'. The 'waitlist' guard ensures we
-- never clobber 'paid' (set earlier in the same trigger by the
-- paid_grants block) or 'admin'.
--
-- The demo tier is intentionally chosen: it grants TierRouter pass-through
-- to App.jsx, while 0083_demo_strict_writes still constrains broad write
-- access. The invitee's role on the specific board/workspace
-- (board_shares.role / workspace_members.role) is what determines what
-- they can do on the surface they were invited to.
--
-- Same rule applies to both board invites and workspace-level invites:
-- the count includes any pending_invites row claimed by this user
-- regardless of board_id being null.
--
-- Trigger attachment unchanged since 0065 — replacing the function is
-- enough.

create or replace function public.ensure_profile_for_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_email text;
  v_grant public.paid_grants%rowtype;
  v_claimed_count int;
begin
  insert into public.profiles (user_id, tier)
  values (new.id, 'waitlist')
  on conflict (user_id) do nothing;

  v_email := lower(trim(coalesce(new.email, '')));

  if v_email <> '' then
    -- (from 0085) link any pre-existing paid_grants row and bump tier.
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
    perform public._claim_pending_invites_for_user(new.id, v_email);

    -- (new in 0089) if at least one invite was claimed for this user,
    -- bump them out of the waitlist gate so they land directly on the
    -- shared board / workspace. Guarded on tier='waitlist' so this
    -- never overrides the 'paid' bump above or the 'admin' tier.
    select count(*) into v_claimed_count
      from public.pending_invites
     where claimed_by = new.id;
    if v_claimed_count > 0 then
      update public.profiles
         set tier = 'demo'
       where user_id = new.id and tier = 'waitlist';
    end if;
  end if;

  return new;
end;
$$;
