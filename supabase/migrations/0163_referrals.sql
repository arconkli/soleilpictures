-- 0163_referrals.sql — "Invite friends, earn free cards" referral growth loop.
--
-- Two-sided, activation-gated, uncapped. The invited friend (referee) gets a
-- +25-card head-start at signup; the referrer earns +25 once that friend
-- creates their first GENUINE card. Reward currency = bonus_card_credits, which
-- raises the demo cap: effective_cap = 100 + bonus_card_credits.
--
-- Two earn paths, one ledger:
--   (a) personal link  ?ref=<code>  (referral_code rides signup metadata)
--   (b) collaboration   the new user claimed a pending email invite (invited_by)
--
-- Anti-abuse: self-referral blocked (CHECK + guard); one reward per referee
-- (UNIQUE(referee_id)); the referrer reward only fires on genuine activation
-- (onb-% cards excluded by _stamp_first_card), granted exactly once.
--
-- All credit writes happen in SECURITY DEFINER functions/triggers; clients have
-- no UPDATE grant on bonus_card_credits and no write grant on referrals, so the
-- ledger can't be self-granted.

-- ---------------------------------------------------------------------------
-- 1. Schema: privileged credit + per-user code on profiles, + referrals ledger
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists bonus_card_credits integer not null default 0;
alter table public.profiles
  add column if not exists referral_code text;
create unique index if not exists profiles_referral_code_key
  on public.profiles (referral_code) where referral_code is not null;

create table if not exists public.referrals (
  id                uuid primary key default gen_random_uuid(),
  referrer_id       uuid not null references auth.users(id) on delete cascade,
  referee_id        uuid not null references auth.users(id) on delete cascade,
  code              text,
  source            text not null check (source in ('link','collab')),
  status            text not null default 'pending' check (status in ('pending','activated')),
  created_at        timestamptz not null default now(),
  activated_at      timestamptz,
  reward_granted_at timestamptz,
  signup_ip         inet,
  meta              jsonb not null default '{}'::jsonb,
  constraint referrals_no_self check (referrer_id <> referee_id),
  constraint referrals_one_per_referee unique (referee_id)
);
create index if not exists referrals_referrer_idx on public.referrals (referrer_id, status);

alter table public.referrals enable row level security;
drop policy if exists "referrals self read" on public.referrals;
create policy "referrals self read" on public.referrals
  for select using (referrer_id = auth.uid() or referee_id = auth.uid());
drop policy if exists "referrals admin read" on public.referrals;
create policy "referrals admin read" on public.referrals
  for select using (public.is_admin());
revoke insert, update, delete on public.referrals from authenticated, anon;
grant select on public.referrals to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Referral-code generator: 7-char Crockford base32, no look-alikes (~22B).
--    Collision handling lives in the minting RPC (§8).
-- ---------------------------------------------------------------------------
create or replace function public._gen_referral_code()
returns text
language plpgsql
set search_path to 'public'
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  v text := '';
  i int;
begin
  for i in 1..7 loop
    v := v || substr(alphabet, 1 + (get_byte(gen_random_bytes(1), 0) % length(alphabet)), 1);
  end loop;
  return v;
end $$;
revoke execute on function public._gen_referral_code() from public, authenticated, anon;

-- ---------------------------------------------------------------------------
-- 3. Cap trigger (authoritative): effective_cap = 100 + bonus_card_credits.
--    Live body reproduced; only the cap fetch + compare + message change.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_demo_card_cap_trg()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_owner uuid;
  v_tier  text;
  v_count integer;
  v_cap   integer;
begin
  -- Existing card being re-synced -> not a new card, never blocked.
  if exists (
    select 1 from public.card_index
     where board_id = new.board_id and card_id = new.card_id
  ) then
    return new;
  end if;

  v_owner := public.board_owner(new.board_id);
  if v_owner is null then
    return new;
  end if;

  select tier, 100 + coalesce(bonus_card_credits, 0)
    into v_tier, v_cap
    from public.profiles where user_id = v_owner;
  if v_tier is distinct from 'demo' then
    return new;
  end if;

  select count(*) into v_count
    from public.card_index ci
    join public.boards b on b.id = ci.board_id
   where b.created_by = v_owner;

  if v_count >= coalesce(v_cap, 100) then
    raise exception
      'Demo accounts are limited to % cards. Invite friends or upgrade to add more.', coalesce(v_cap, 100)
      using errcode = '42501';
  end if;

  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 4. get_my_tier(): add bonus_card_credits + effective_card_limit columns.
--    RETURNS TABLE shape changes -> must drop & recreate (then re-grant).
-- ---------------------------------------------------------------------------
drop function if exists public.get_my_tier();
create function public.get_my_tier()
returns table(
  tier text, demo_card_count integer, subscription_status text,
  current_period_end timestamptz, cancel_at_period_end boolean,
  grant_active boolean, grant_expires_at timestamptz, banned boolean,
  ad_offer_pending boolean, onboarding jsonb,
  bonus_card_credits integer, effective_card_limit integer)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    coalesce(p.tier, 'demo')::text,
    coalesce(p.demo_card_count, 0)::integer,
    s.status::text,
    s.current_period_end,
    coalesce(s.cancel_at_period_end, false),
    (gr.hit is not null)                                       as grant_active,
    gr.gexp                                                    as grant_expires_at,
    (p.banned_at is not null)                                  as banned,
    coalesce((p.settings->>'ad_offer_pending')::boolean, false) as ad_offer_pending,
    coalesce(p.settings->'onboarding', '{}'::jsonb)             as onboarding,
    coalesce(p.bonus_card_credits, 0)::integer                 as bonus_card_credits,
    (100 + coalesce(p.bonus_card_credits, 0))::integer         as effective_card_limit
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
$$;
grant execute on function public.get_my_tier() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Signup trigger: resolve referral (link or collab), record it, grant the
--    referee the +25 head-start. Live body reproduced with the referral block
--    spliced in after pending-invite claiming; fully guarded so it can never
--    abort signup.
-- ---------------------------------------------------------------------------
create or replace function public.ensure_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email             text;
  v_grant             public.paid_grants%rowtype;
  v_claimed_count     int;
  v_fbc               text;
  v_fbc_ms            bigint;
  v_ad_enabled        boolean;
  v_waitlist_enabled  boolean;
  v_first_source      jsonb;
  v_ref_code          text;
  v_referrer          uuid;
  v_ref_ins           int := 0;
  v_ref_source        text;
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

  -- Referral linkage + referee head-start. Path (a) explicit ?ref=<code>;
  -- path (b) collab fallback: this new user claimed a pending email invite.
  -- One ledger row per referee (UNIQUE(referee_id)); fully guarded.
  begin
    v_ref_code := upper(nullif(trim(coalesce(
      new.raw_user_meta_data->>'referral_code',
      v_first_source->>'ref')), ''));

    if v_ref_code is not null then
      select user_id into v_referrer
        from public.profiles where referral_code = v_ref_code limit 1;
      if v_referrer is not null and v_referrer <> new.id then
        insert into public.referrals (referrer_id, referee_id, code, source, status, meta)
        values (v_referrer, new.id, v_ref_code, 'link', 'pending',
                jsonb_build_object('signup_email', v_email))
        on conflict (referee_id) do nothing;
        get diagnostics v_ref_ins = row_count;
        if v_ref_ins > 0 then v_ref_source := 'link'; end if;
      end if;
    end if;

    if v_ref_ins = 0 then
      select pi.invited_by into v_referrer
        from public.pending_invites pi
       where pi.claimed_by = new.id
         and pi.invited_by is not null
         and pi.invited_by <> new.id
       order by pi.claimed_at asc nulls last
       limit 1;
      if v_referrer is not null then
        insert into public.referrals (referrer_id, referee_id, source, status, meta)
        values (v_referrer, new.id, 'collab', 'pending',
                jsonb_build_object('signup_email', v_email))
        on conflict (referee_id) do nothing;
        get diagnostics v_ref_ins = row_count;
        if v_ref_ins > 0 then v_ref_source := 'collab'; end if;
      end if;
    end if;

    if v_ref_ins > 0 then
      update public.profiles
         set bonus_card_credits = coalesce(bonus_card_credits, 0) + 25
       where user_id = new.id;
      insert into public.analytics_events (user_id, event, props)
      values (new.id, 'referral_signup',
              jsonb_build_object('source', v_ref_source, 'code', v_ref_code));
    end if;
  exception when others then
    null;  -- referral resolution must never break signup
  end;

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
end $$;

-- ---------------------------------------------------------------------------
-- 6. Reward-on-activation (server-authoritative, exactly-once).
-- ---------------------------------------------------------------------------
create or replace function public.grant_referral_reward(p_referee uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_referrer uuid;
begin
  update public.referrals
     set status = 'activated', activated_at = now(), reward_granted_at = now()
   where referee_id = p_referee and reward_granted_at is null
  returning referrer_id into v_referrer;

  if v_referrer is not null then
    update public.profiles
       set bonus_card_credits = coalesce(bonus_card_credits, 0) + 25
     where user_id = v_referrer;
    insert into public.analytics_events (user_id, event, props) values
      (p_referee,  'referral_activated',      '{}'::jsonb),
      (v_referrer, 'referral_reward_granted', jsonb_build_object('referee', p_referee, 'amount', 25));
  end if;
end $$;
-- Lock down hard: the PUBLIC default-grant would otherwise let any authenticated
-- user call this directly and bypass the activation gate to mint themselves
-- rewards. Only definer callers (_stamp_first_card) run it, as the function owner.
revoke execute on function public.grant_referral_reward(uuid) from public, authenticated, anon;

-- Hook the reward into the existing first-genuine-card stamp. The null->now()
-- flip is the exact activation instant; onb-% (seeded) cards are already skipped.
create or replace function public._stamp_first_card()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_owner uuid; v_flipped boolean := false;
begin
  if new.card_id like 'onb-%' then return new; end if;
  v_owner := coalesce(auth.uid(),
    (select w.created_by from public.workspaces w where w.id = new.workspace_id));
  if v_owner is not null then
    update public.profiles set first_card_at = coalesce(first_card_at, now())
     where user_id = v_owner and first_card_at is null
    returning true into v_flipped;
    if coalesce(v_flipped, false) then
      begin
        perform public.grant_referral_reward(v_owner);
      exception when others then null;  -- reward must never break card creation
      end;
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Client RPCs: mint/fetch my code; my referral stats for the Account tab.
-- ---------------------------------------------------------------------------
create or replace function public.get_or_create_my_referral_code()
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_uid uuid := auth.uid(); v_code text; v_try text; i int;
begin
  if v_uid is null then return null; end if;
  select referral_code into v_code from public.profiles where user_id = v_uid;
  if v_code is not null then return v_code; end if;
  for i in 1..12 loop
    v_try := public._gen_referral_code();
    begin
      update public.profiles set referral_code = v_try
       where user_id = v_uid and referral_code is null;
      if found then return v_try; end if;
      -- A concurrent call already minted one: return it.
      select referral_code into v_code from public.profiles where user_id = v_uid;
      if v_code is not null then return v_code; end if;
    exception when unique_violation then
      -- code collided with another user; retry with a fresh one
    end;
  end loop;
  return null;
end $$;
grant execute on function public.get_or_create_my_referral_code() to authenticated;

create or replace function public.get_my_referral_stats()
returns table(code text, friends_joined integer, friends_activated integer,
              pending integer, cards_earned integer)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    (select referral_code from public.profiles where user_id = auth.uid()),
    count(*)::integer,
    count(*) filter (where status = 'activated')::integer,
    count(*) filter (where status = 'pending')::integer,
    (count(*) filter (where status = 'activated') * 25)::integer
  from public.referrals where referrer_id = auth.uid();
$$;
grant execute on function public.get_my_referral_stats() to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Admin observability: surface the referral funnel in the curated event
--    breakdown (server-fired referral_signup/activated/reward_granted have a
--    null session_id, which the internal-session filter already lets through).
-- ---------------------------------------------------------------------------
create or replace function public.admin_event_breakdown(p_days integer default 30, p_exclude_internal boolean default true)
returns table(event text, sessions bigint, users bigint, total bigint, ord integer)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 365));
  return query
  with ev as (
    select * from public.analytics_events
    where occurred_at >= now() - (p_days || ' days')::interval
      and (not p_exclude_internal or session_id is null or session_id not in (select isess.session_id from public._internal_session_ids() isess))
  ),
  curated(event, ord) as (
    values ('email_submit_error',1),('otp_verify_error',2),('landing_callback_error',3),('landing_edit_email',4),
           ('landing_explore_click',5),('welcome_cta',6),('waitlist_abandon',7),('waitlist_plan_toggle',8),
           ('waitlist_subscribe_cta',9),('pricing_plan_toggle',10),('pricing_demo_cta',11),('pricing_creator_intent',12),
           ('pricing_abandon',13),('checkout_error',14),('billing_portal_error',15),('checkout_stalled',16),
           ('checkout_verify_retry',17),('checkout_missing_session',18),('checkout_support_click',19),
           ('referral_open',20),('referral_tab_view',21),('referral_link_copied',22),('referral_link_shared',23),
           ('referral_nudge_view',24),('referral_nudge_cta',25),('referral_nudge_dismiss',26),
           ('referral_signup',27),('referral_activated',28),('referral_reward_granted',29)
  )
  select c.event, count(distinct ev.session_id) as sessions, count(distinct ev.user_id) as users, count(ev.*) as total, c.ord
  from curated c left join ev on ev.event = c.event group by c.event, c.ord order by c.ord;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 9. Acquisition: a ?ref=<code> signup is a member referral — its own channel,
--    ranked below paid (so a paid click is never misattributed) but above the
--    generic utm/referrer fallbacks. Full body reproduced from live with one
--    added branch in section 3 (verified: paid still wins, all other channels
--    preserved). Feeds the existing admin acquisition dashboard + the 5 RPCs
--    that route through this normalizer.
-- ---------------------------------------------------------------------------
create or replace function public.derive_acquisition_channel(fs jsonb)
 returns text
 language plpgsql
 immutable
 set search_path to 'public'
as $function$
declare
  utm_s text := lower(coalesce(nullif(fs->>'utm_source',''), ''));
  ref   text := lower(coalesce(nullif(fs->>'referrer_host',''), nullif(fs->>'referrer',''), ''));
  paid  boolean := lower(coalesce(fs->>'utm_medium','')) ~ '(cpc|ppc|paid|paidsocial|paid_social|paid-social|^ad$|^ads$|display|sem)';
  hw    text;
begin
  if fs is null or fs = '{}'::jsonb then return 'direct'; end if;

  -- 1) Paid click-ids win, network-specific.
  if nullif(fs->>'gclid','') is not null or nullif(fs->>'wbraid','') is not null or nullif(fs->>'gbraid','') is not null then return 'google_ads'; end if;
  if nullif(fs->>'msclkid','')   is not null then return 'bing_ads';      end if;
  if nullif(fs->>'ttclid','')    is not null then return 'tiktok_ads';    end if;
  if nullif(fs->>'twclid','')    is not null then return 'x_ads';         end if;
  if nullif(fs->>'rdt_cid','')   is not null or nullif(fs->>'rdt_uuid','') is not null then return 'reddit_ads'; end if;
  if nullif(fs->>'li_fat_id','') is not null then return 'linkedin_ads';  end if;
  if nullif(fs->>'epik','')      is not null then return 'pinterest_ads'; end if;
  if nullif(fs->>'sccid','')     is not null then return 'snapchat_ads';  end if;
  if nullif(fs->>'fbclid','')    is not null then return 'meta_paid';     end if;

  -- 2) Paid via explicit utm tagging on a known network (no click-id).
  if paid then
    if utm_s ~ '(google|adwords)'                            then return 'google_ads';    end if;
    if utm_s ~ '(bing|microsoft|msn)'                        then return 'bing_ads';      end if;
    if utm_s ~ '(facebook|instagram|meta|^fb$|^ig$|fb_|ig_)' then return 'meta_paid';     end if;
    if utm_s ~ 'tiktok'                                      then return 'tiktok_ads';    end if;
    if utm_s ~ '(twitter|^x$)'                               then return 'x_ads';         end if;
    if utm_s ~ 'reddit'                                      then return 'reddit_ads';    end if;
    if utm_s ~ 'linkedin'                                    then return 'linkedin_ads';  end if;
    if utm_s ~ 'pinterest'                                   then return 'pinterest_ads'; end if;
    if utm_s ~ 'snap'                                        then return 'snapchat_ads';  end if;
  end if;

  -- 3) Internal channels.
  if nullif(fs->>'ref','')         is not null                           then return 'referral';     end if;
  if nullif(fs->>'share_token','') is not null or utm_s = 'share_link'   then return 'share_link';   end if;
  if nullif(fs->>'public_slug','') is not null or utm_s = 'public_board' then return 'public_board'; end if;

  -- 4) Organic / referral by explicit utm_source.
  if utm_s <> '' then
    if utm_s ~ '(facebook|instagram|meta|^fb$|^ig$)' then return 'meta_organic'; end if;
    if utm_s ~ 'tiktok'        then return 'tiktok';    end if;
    if utm_s ~ 'reddit'        then return 'reddit';    end if;
    if utm_s ~ '(twitter|^x$)' then return 'x';         end if;
    if utm_s ~ 'linkedin'      then return 'linkedin';  end if;
    if utm_s ~ 'pinterest'     then return 'pinterest'; end if;
    if utm_s ~ 'snap'          then return 'snapchat';  end if;
    if utm_s ~ 'youtube'       then return 'youtube';   end if;
    if utm_s ~ '(google|adwords)'     then return 'google'; end if;
    if utm_s ~ '(bing|microsoft|msn)' then return 'bing';   end if;
    return utm_s;
  end if;

  -- 5) Organic / referral by external referrer host.
  if ref <> '' then
    if ref ~ '(facebook|instagram|fb[.]com|fb[.]me|l[.]facebook|lm[.]facebook)' then return 'meta_organic'; end if;
    if ref ~ 'tiktok'                                                then return 'tiktok';     end if;
    if ref ~ 'reddit'                                                then return 'reddit';     end if;
    if ref ~ '(twitter|(^|[.])t[.]co($|[:/])|(^|[.])x[.]com($|[:/]))' then return 'x';         end if;
    if ref ~ 'linkedin'                                             then return 'linkedin';   end if;
    if ref ~ 'pinterest'                                            then return 'pinterest';  end if;
    if ref ~ 'snapchat'                                             then return 'snapchat';   end if;
    if ref ~ 'youtube'                                              then return 'youtube';    end if;
    if ref ~ 'google[.]'                                            then return 'google';     end if;
    if ref ~ '(bing[.]|microsoft)'                                  then return 'bing';       end if;
    if ref ~ 'duckduckgo'                                           then return 'duckduckgo'; end if;
    if ref ~ 'yahoo'                                                then return 'yahoo';      end if;
    if ref ~ '(ecosia|baidu|yandex|brave|qwant|startpage)'          then return 'search';     end if;
    hw := split_part(regexp_replace(regexp_replace(ref, '^https?://', '', 'i'), '^www[.]', '', 'i'), '/', 1);
    hw := split_part(hw, ':', 1);
    if position('.' in hw) > 0 then
      hw := split_part(hw, '.', greatest(1, array_length(string_to_array(hw, '.'), 1) - 1));
    end if;
    return coalesce(nullif(hw, ''), 'referral');
  end if;

  return 'direct';
end;
$function$;
