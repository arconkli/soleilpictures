-- 0889 — an invited account's first_source says so.
--
-- 0888 taught derive_acquisition_channel to file an account under 'invite'
-- when first_source.invited is true and nothing more specific is known. This
-- sets that marker. The browser cannot: the invitation link's token is not
-- read into first_source, and the app's entry bundle has no room to add it.
-- The server already knows, though: every path that lets an invited person in
-- (a cluster invitation, a workspace invitation or its link, a team
-- invitation, the sign-up trigger's own claim, joining through a share link)
-- records a referrals row with source 'collab' for them. Someone who joined
-- through a share link normally carries its token and still reads as
-- 'share_link'; one whose first_source lost the token now reads as 'invite'
-- instead of 'direct'. The marker is kept from that row, in two places, because the
-- row and the first_source stamp arrive in either order:
--
--   referrals_marks_invited        after a 'collab' referral is recorded, adds
--                                  invited:true to that account's first_source
--                                  when it already has one.
--   profiles_keeps_invited         before first_source is written (the client
--                                  stamp through set_first_source, or the
--                                  sign-up backstop), adds invited:true when a
--                                  'collab' referral already exists.
--
-- Neither ever fills an empty first_source: set_first_source only stamps a
-- null or '{}' value, so a marker written first would shut the real stamp
-- out. Neither removes or changes any other key. Both swallow their own
-- errors: a failure here must never stop an invitation being accepted or an
-- account being created; the cost of one is an account read as 'direct'.
--
-- The one-time update at the end marks the accounts that already have a
-- 'collab' referral and a first_source. It touches first_source only; the
-- table's updated_at trigger moves updated_at on those rows.
--
-- A referral of source 'link' (a personal referral code) is not an invitation
-- and is not marked; those accounts already read as 'referral'.

begin;

set local lock_timeout = '3s';

-- ── 1. A recorded invitation marks the account ───────────────────────────────
create or replace function public._tg_referral_marks_invited()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  begin
    update public.profiles p
       set first_source = p.first_source || '{"invited": true}'::jsonb
     where p.user_id = new.referee_id
       and p.first_source is not null
       and p.first_source <> '{}'::jsonb
       and not (p.first_source ? 'invited');
  exception when others then
    null;  -- never stop the invitation being accepted
  end;
  return new;
end;
$fn$;

revoke execute on function public._tg_referral_marks_invited() from public, anon, authenticated;

drop trigger if exists referrals_marks_invited on public.referrals;
create trigger referrals_marks_invited
  after insert on public.referrals
  for each row
  when (new.source = 'collab')
  execute function public._tg_referral_marks_invited();

-- ── 2. A first_source written after the invitation keeps the mark ────────────
create or replace function public._tg_profile_keeps_invited()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  begin
    if new.first_source is not null
       and new.first_source <> '{}'::jsonb
       and not (new.first_source ? 'invited')
       and exists (select 1 from public.referrals r
                    where r.referee_id = new.user_id and r.source = 'collab') then
      new.first_source := new.first_source || '{"invited": true}'::jsonb;
    end if;
  exception when others then
    null;  -- never stop the profile write
  end;
  return new;
end;
$fn$;

revoke execute on function public._tg_profile_keeps_invited() from public, anon, authenticated;

drop trigger if exists profiles_keeps_invited on public.profiles;
create trigger profiles_keeps_invited
  before insert or update of first_source on public.profiles
  for each row
  execute function public._tg_profile_keeps_invited();

-- ── 3. The accounts already invited ──────────────────────────────────────────
update public.profiles p
   set first_source = p.first_source || '{"invited": true}'::jsonb
 where p.first_source is not null
   and p.first_source <> '{}'::jsonb
   and not (p.first_source ? 'invited')
   and exists (select 1 from public.referrals r
                where r.referee_id = p.user_id and r.source = 'collab');

-- ── 4. Proof ─────────────────────────────────────────────────────────────────
do $proof$
declare
  f text;
  r text;
begin
  -- 0311 habit: internal trigger helpers, closed to every client role.
  foreach f in array array['public._tg_referral_marks_invited()',
                           'public._tg_profile_keeps_invited()'] loop
    foreach r in array array['anon', 'authenticated'] loop
      if has_function_privilege(r, f, 'execute') then
        raise exception '0889: % is executable by %', f, r;
      end if;
    end loop;
    if not has_function_privilege('service_role', f, 'execute') then
      raise exception '0889: % lost EXECUTE for service_role', f;
    end if;
  end loop;
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'public.referrals'::regclass
                    and t.tgname = 'referrals_marks_invited' and not t.tgisinternal) then
    raise exception '0889: referrals_marks_invited is missing';
  end if;
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'public.profiles'::regclass
                    and t.tgname = 'profiles_keeps_invited' and not t.tgisinternal) then
    raise exception '0889: profiles_keeps_invited is missing';
  end if;
  -- The backfill left nobody behind, and the channel reads the mark.
  if exists (select 1 from public.profiles p
              where p.first_source is not null and p.first_source <> '{}'::jsonb
                and not (p.first_source ? 'invited')
                and exists (select 1 from public.referrals x
                             where x.referee_id = p.user_id and x.source = 'collab')) then
    raise exception '0889: an invited account is unmarked';
  end if;
  assert public.derive_acquisition_channel('{"landing_path":"/","invited":true}'::jsonb) = 'invite',
    '0888 must be applied first';
end $proof$;

commit;
