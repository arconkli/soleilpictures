-- 0416 — An invitation pays in storage too, and the inviter is paid when the
-- friend gets started, not three days later.
--
-- Owner decisions, 2026-10-17:
--   • Inviting someone new to Clusters earns storage as well as cards: half a
--     GiB each. The person who joins gets theirs when they join; the person who
--     invited them gets theirs when their reward pays. Those are the two
--     moments the bonus cards already land (0163, 0371, 0377).
--   • The inviter's reward no longer waits for the friend's account to age.
--     It pays once the friend has placed a first card and opened the app. The
--     rest of 0377's brakes stay: neither account banned, and at most
--     c_per_30_days rewards in any 30 days, oldest first. A dormant signup
--     still earns nothing.
--
-- WHERE THE STORAGE LIVES. profiles.bonus_storage_bytes, written only by the
-- trigger on referrals below. The referral row is the one record of who
-- invited whom and whether the reward paid, so the storage follows the row
-- rather than each place that writes one (the signup trigger, claim_collab_link,
-- _pay_referral_rewards). 0415 keeps extra storage OFF profiles because a
-- block must die with the plan that pays for it; this bonus is the opposite —
-- it belongs to the person, like bonus cards, and stacks on whatever drive
-- they have, a per-account figure included.
--
-- Binary units, as everywhere else: 536870912 bytes is labelled "0.5GB"
-- (inviteReward.js INVITE_BONUS_STORAGE_LABEL; gen-docs checks it against the
-- helper below).

begin;

set local lock_timeout = '5s';

-- ── 1. The column ───────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists bonus_storage_bytes bigint not null default 0
    check (bonus_storage_bytes >= 0);

-- profiles' client INSERT/UPDATE grants are per column (avatar_url, color,
-- display_name, notification_prefs), so a new column is not client-writable.
-- Said here anyway, and proved at the end.
revoke insert (bonus_storage_bytes), update (bonus_storage_bytes) on public.profiles from anon, authenticated;

-- ── 2. The amount ───────────────────────────────────────────────────────────
-- One SQL source for it: the trigger, the payout event and the backfill read
-- this, and gen-docs states it on the referrals page.
create or replace function public._referral_bonus_storage_bytes()
 returns bigint
 language sql
 immutable
 set search_path to 'public'
as $function$
  select 536870912::bigint;
$function$;
revoke execute on function public._referral_bonus_storage_bytes() from public, anon, authenticated;

-- ── 3. Storage rides on the referral row ────────────────────────────────────
-- AFTER INSERT: a row is inserted exactly when the friend's +25 cards are
-- granted (both writers do `on conflict (referee_id) do nothing` and grant only
-- when a row went in; a skipped conflict fires no AFTER trigger).
-- AFTER UPDATE: reward_granted_at goes from null to a time exactly when
-- _pay_referral_rewards credits the inviter's cards, in the same transaction.
-- No exception handler here: the storage and the cards land together or not at
-- all. Every caller already guards its own referral block.
create or replace function public._tg_referral_bonus_storage()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' then
    update public.profiles
       set bonus_storage_bytes = bonus_storage_bytes + public._referral_bonus_storage_bytes()
     where user_id = new.referee_id;
  elsif old.reward_granted_at is null and new.reward_granted_at is not null then
    update public.profiles
       set bonus_storage_bytes = bonus_storage_bytes + public._referral_bonus_storage_bytes()
     where user_id = new.referrer_id;
  end if;
  return null;
end;
$function$;
revoke execute on function public._tg_referral_bonus_storage() from public, anon, authenticated;

create or replace trigger referrals_bonus_storage_on_insert
  after insert on public.referrals
  for each row execute function public._tg_referral_bonus_storage();

create or replace trigger referrals_bonus_storage_on_reward
  after update of reward_granted_at on public.referrals
  for each row
  when (old.reward_granted_at is null and new.reward_granted_at is not null)
  execute function public._tg_referral_bonus_storage();

-- ── 4. Whose drive is how big ───────────────────────────────────────────────
-- What everyone involved has today, before the bonus, so the proofs can show
-- the only change is the bonus itself.
create temp table _q0416 on commit drop as
  select p.user_id, public._storage_quota_bytes(p.user_id) as q
    from public.profiles p
   where p.user_id in (select r.referee_id from public.referrals r
                       union
                       select r.referrer_id from public.referrals r);

-- The 0415 body, unchanged, plus the invitation bonus OUTSIDE the coalesce: it
-- stacks on a per-account figure as well as on any plan's drive.
create or replace function public._storage_quota_bytes(p_owner uuid)
 returns bigint
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  -- An explicit per-account figure wins. Otherwise a paid or admin owner gets
  -- the drive Creator sells (storage_quota_bytes) — the trial drive while the
  -- subscription is still trialing (0413) — plus any extra storage that is
  -- still paid for (0415), and a free owner gets storage_quota_free_bytes
  -- (0387, owner decision 2026-10-06). On top of whichever it is, the storage
  -- earned by invitations (0416), which belongs to the person, not the plan.
  select coalesce(
    (select p.storage_quota_bytes from public.profiles p where p.user_id = p_owner),
    case when coalesce((select p.tier from public.profiles p where p.user_id = p_owner), 'demo') in ('paid', 'admin')
         then case when exists (select 1 from public.subscriptions s
                                 where s.user_id = p_owner and s.status = 'trialing')
                   then public._storage_quota_trial_bytes()
                   else public._storage_quota_bytes()
              end
              + public._storage_addon_blocks(p_owner)::bigint * public._storage_addon_block_bytes()
         else public._storage_quota_free_bytes()
    end
  ) + coalesce((select p.bonus_storage_bytes from public.profiles p where p.user_id = p_owner), 0);
$function$;
revoke execute on function public._storage_quota_bytes(uuid) from public, anon, authenticated;

-- ── 5. The inviter is paid when the friend gets started ─────────────────────
-- 0377's payer without the account-age wait. Everything else is as it was:
-- the friend has opened the app (a user_presence row), neither account is
-- banned, and one person collects at most c_per_30_days rewards in any 30
-- days, oldest first, under a per-referrer lock. Called on activation
-- (grant_referral_reward) and hourly (cron 'referral-rewards'), which still
-- pays what the 30-day limit or a missing presence row held back.
create or replace function public._pay_referral_rewards(p_referee uuid default null)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'auth'
as $function$
declare
  c_per_30_days  constant integer := 4;
  c_reward_cards constant integer := 25;
  r   record;
  v_n integer := 0;
begin
  for r in
    select rf.id, rf.referrer_id, rf.referee_id
      from public.referrals rf
     where rf.status = 'activated'
       and rf.reward_granted_at is null
       and (p_referee is null or rf.referee_id = p_referee)
       and exists (select 1 from public.user_presence pr where pr.user_id = rf.referee_id)
       and not public._user_banned(rf.referee_id)
       and not public._user_banned(rf.referrer_id)
     order by rf.activated_at, rf.id
     for update of rf skip locked
  loop
    -- One referrer at a time, so two payouts can't both read "3 this month".
    perform pg_advisory_xact_lock(hashtext('referral_rewards:' || r.referrer_id::text));
    if (select count(*) from public.referrals x
         where x.referrer_id = r.referrer_id
           and x.reward_granted_at > now() - interval '30 days') >= c_per_30_days then
      continue;
    end if;
    -- Stamping the payout also credits its storage half
    -- (referrals_bonus_storage_on_reward, 0416).
    update public.referrals set reward_granted_at = now() where id = r.id;
    update public.profiles
       set bonus_card_credits = coalesce(bonus_card_credits, 0) + c_reward_cards
     where user_id = r.referrer_id;
    insert into public.analytics_events (user_id, event, props)
    values (r.referrer_id, 'referral_reward_granted',
            jsonb_build_object('referee', r.referee_id, 'amount', c_reward_cards,
                               'storage_bytes', public._referral_bonus_storage_bytes()));
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$function$;
revoke execute on function public._pay_referral_rewards(uuid) from public, anon, authenticated;

-- ── 6. Everyone already rewarded ────────────────────────────────────────────
-- Absolute, so running it again changes nothing: one bonus for having joined
-- through an invitation, plus one for every reward already paid to you.
update public.profiles p
   set bonus_storage_bytes = public._referral_bonus_storage_bytes() * (
         (select count(*) from public.referrals r where r.referee_id = p.user_id)
       + (select count(*) from public.referrals r
           where r.referrer_id = p.user_id and r.reward_granted_at is not null))
 where exists (select 1 from public.referrals r
                where r.referee_id = p.user_id
                   or (r.referrer_id = p.user_id and r.reward_granted_at is not null));

-- Activated friends that were only waiting for their account to age are due now.
select public._pay_referral_rewards();

-- ── 7. Proofs ───────────────────────────────────────────────────────────────
do $$
declare
  v_sig  text;
  v_role text;
  v_priv text;
  v_bad  integer;
  v_src  text;
begin
  if public._referral_bonus_storage_bytes() <> 536870912 then
    raise exception '0416: the invitation bonus is not half a GiB';
  end if;

  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_priv in array array['INSERT', 'UPDATE'] loop
      if has_column_privilege(v_role, 'public.profiles', 'bonus_storage_bytes', v_priv) then
        raise exception '0416: % can % profiles.bonus_storage_bytes', v_role, v_priv;
      end if;
    end loop;
  end loop;

  foreach v_sig in array array[
    'public._referral_bonus_storage_bytes()',
    'public._tg_referral_bonus_storage()',
    'public._storage_quota_bytes(uuid)',
    'public._pay_referral_rewards(uuid)',
    'public.grant_referral_reward(uuid)'
  ] loop
    if has_function_privilege('anon', v_sig, 'execute')
       or has_function_privilege('authenticated', v_sig, 'execute') then
      raise exception '0416: % is callable by a client', v_sig;
    end if;
  end loop;

  foreach v_sig in array array[
    'public.my_storage_usage()',
    'public.authorize_upload(uuid, bigint)',
    'public.authorize_image_upload(uuid, bigint)',
    'public.get_my_referral_stats()'
  ] loop
    if not has_function_privilege('authenticated', v_sig, 'execute') then
      raise exception '0416: % lost its grant', v_sig;
    end if;
  end loop;

  if (select count(*) from pg_trigger
       where tgrelid = 'public.referrals'::regclass
         and tgname in ('referrals_bonus_storage_on_insert', 'referrals_bonus_storage_on_reward')
         and not tgisinternal) <> 2 then
    raise exception '0416: the referral storage triggers are missing';
  end if;

  select prosrc into v_src from pg_proc
   where oid = 'public._pay_referral_rewards(uuid)'::regprocedure;
  if position('make_interval' in v_src) > 0 or position('auth.users' in v_src) > 0 then
    raise exception '0416: the payout still waits for the account to age';
  end if;

  -- The backfill and the payout above agree with the rule, for everyone.
  select count(*) into v_bad
    from public.profiles p
   where p.bonus_storage_bytes <> public._referral_bonus_storage_bytes() * (
           (select count(*) from public.referrals r where r.referee_id = p.user_id)
         + (select count(*) from public.referrals r
             where r.referrer_id = p.user_id and r.reward_granted_at is not null));
  if v_bad > 0 then
    raise exception '0416: % profiles hold the wrong invitation storage', v_bad;
  end if;

  -- The only change to anyone's drive is their invitation storage.
  select count(*) into v_bad
    from _q0416 s
    join public.profiles p on p.user_id = s.user_id
   where public._storage_quota_bytes(s.user_id) <> s.q + p.bonus_storage_bytes;
  if v_bad > 0 then
    raise exception '0416: % drives changed by more than their invitation storage', v_bad;
  end if;
end $$;

commit;
