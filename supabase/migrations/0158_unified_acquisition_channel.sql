-- 0158_unified_acquisition_channel.sql
--
-- ONE source-of-truth channel normalizer.
--
-- Until now four+ different inline CASE expressions derived a user's acquisition
-- "source" from profiles.first_source (admin_list_users, admin_user_count,
-- admin_user_detail, admin_acquisition_breakdown, admin_retention_by_source) —
-- and they disagreed, so the same user could show as 'facebook' on one screen,
-- 'facebook/instagram (fbclid)' on another, and 'ad' on a third.
--
-- public.derive_acquisition_channel(first_source jsonb) is now the single function
-- every consumer routes through, so a user's channel is identical everywhere. It
-- recognizes all the channels the client now captures (0157 + analytics.js WS1):
-- paid click-ids (gclid/wbraid/gbraid, msclkid, ttclid, twclid, rdt_cid,
-- li_fat_id, epik, sccid, fbclid), paid utm tagging, organic social + search by
-- utm/referrer, share links, public boards, unknown-but-tagged utm (verbatim),
-- unknown external referrer (domain word), and direct.
--
-- Applied to prod via MCP apply_migration; this file mirrors it for the repo
-- record. Live bodies for the five RPCs were dumped from prod before editing
-- (they had drifted from the on-disk 0149); only the source-deriving expression
-- changed in each.

-- ── The normalizer ───────────────────────────────────────────────────────────
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

  -- 1) Paid click-ids win, network-specific (one id per ad network).
  if nullif(fs->>'gclid','') is not null or nullif(fs->>'wbraid','') is not null or nullif(fs->>'gbraid','') is not null then return 'google_ads'; end if;
  if nullif(fs->>'msclkid','')   is not null then return 'bing_ads';      end if;
  if nullif(fs->>'ttclid','')    is not null then return 'tiktok_ads';    end if;
  if nullif(fs->>'twclid','')    is not null then return 'x_ads';         end if;
  if nullif(fs->>'rdt_cid','')   is not null or nullif(fs->>'rdt_uuid','') is not null then return 'reddit_ads'; end if;
  if nullif(fs->>'li_fat_id','') is not null then return 'linkedin_ads';  end if;
  if nullif(fs->>'epik','')      is not null then return 'pinterest_ads'; end if;
  if nullif(fs->>'sccid','')     is not null then return 'snapchat_ads';  end if;
  -- fbclid rides BOTH paid + organic FB/IG (a known limitation) but the app has
  -- always treated it as the ad cohort, so keep it = meta_paid for consistency.
  if nullif(fs->>'fbclid','')    is not null then return 'meta_paid';     end if;

  -- 2) Paid via explicit utm tagging on a known network (no click-id present).
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

  -- 3) Internal channels (shared board links / curated public boards).
  if nullif(fs->>'share_token','') is not null or utm_s = 'share_link'   then return 'share_link';   end if;
  if nullif(fs->>'public_slug','') is not null or utm_s = 'public_board' then return 'public_board'; end if;

  -- 4) Organic / referral by explicit utm_source tag.
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
    return utm_s;  -- unknown but explicitly tagged: keep verbatim (granular)
  end if;

  -- 5) Organic / referral by external referrer host (no utm tags).
  if ref <> '' then
    if ref ~ '(facebook|instagram|fb[.]com|fb[.]me|l[.]facebook|lm[.]facebook)' then return 'meta_organic'; end if;
    if ref ~ 'tiktok'                                                then return 'tiktok';     end if;
    if ref ~ 'reddit'                                                then return 'reddit';     end if;
    if ref ~ '(twitter|(^|[.])t[.]co($|[:/])|(^|[.])x[.]com($|[:/]))' then return 'x';         end if;
    if ref ~ 'linkedin'                                             then return 'linkedin';   end if;
    if ref ~ 'pinterest'                                            then return 'pinterest';  end if;
    if ref ~ 'snapchat'                                             then return 'snapchat';   end if;
    if ref ~ 'youtube'                                              then return 'youtube';    end if;
    if ref ~ 'google[.]'                                            then return 'google';     end if;  -- organic search
    if ref ~ '(bing[.]|microsoft)'                                  then return 'bing';       end if;
    if ref ~ 'duckduckgo'                                           then return 'duckduckgo'; end if;
    if ref ~ 'yahoo'                                                then return 'yahoo';      end if;
    if ref ~ '(ecosia|baidu|yandex|brave|qwant|startpage)'          then return 'search';     end if;
    -- Unknown external referrer: keep the registrable-ish domain word
    -- (producthunt.com -> producthunt, news.ycombinator.com -> ycombinator).
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

grant execute on function public.derive_acquisition_channel(jsonb) to authenticated;

-- ── admin_list_users: acquisition_source now from the normalizer ──────────────
create or replace function public.admin_list_users(p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_query text DEFAULT NULL::text, p_tier text DEFAULT NULL::text, p_sort text DEFAULT 'recent'::text, p_status text DEFAULT NULL::text, p_source text DEFAULT NULL::text, p_contacted text DEFAULT NULL::text, p_verification text DEFAULT 'verified'::text)
 returns TABLE(user_id uuid, email text, tier text, card_count integer, seconds_in_app bigint, created_at timestamp with time zone, last_sign_in_at timestamp with time zone, subscription_plan text, subscription_status text, current_period_end timestamp with time zone, subscription_amount_cents integer, subscription_discounted boolean, banned boolean, joined_waitlist boolean, display_name text, avatar_url text, color text, last_seen_at timestamp with time zone, board_count integer, acquisition_source text, last_reached_out_at timestamp with time zone, outreach_count integer, email_confirmed boolean)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_q text := nullif(trim(coalesce(p_query,     '')), '');
  v_t text := nullif(trim(coalesce(p_tier,      '')), '');
  v_s text := nullif(trim(coalesce(p_status,    '')), '');
  v_o text := nullif(trim(coalesce(p_source,    '')), '');
  v_c text := nullif(trim(coalesce(p_contacted, '')), '');
  v_k text := lower(coalesce(nullif(trim(p_sort), ''), 'recent'));
  v_v text := lower(coalesce(nullif(trim(p_verification), ''), 'verified'));
begin
  perform public._require_admin();
  p_limit  := greatest(1, least(p_limit, 200));
  p_offset := greatest(0, p_offset);

  return query
  with owner_cards as (
    select b.created_by as uid, count(*)::int as card_count
    from public.card_index ci
    join public.boards b on b.id = ci.board_id
    group by b.created_by
  ),
  owner_boards as (
    select b.created_by as uid, count(*)::int as board_count
    from public.boards b
    where b.created_by is not null and b.deleted_at is null
    group by b.created_by
  ),
  base as (
    select
      u.id                                       as user_id,
      u.email::text                              as email,
      coalesce(p.tier, 'demo')::text             as tier,
      coalesce(oc.card_count, 0)::int            as card_count,
      coalesce(p.seconds_in_app, 0)::bigint      as seconds_in_app,
      u.created_at                               as created_at,
      u.last_sign_in_at                          as last_sign_in_at,
      s.plan::text                               as subscription_plan,
      s.status::text                             as subscription_status,
      s.current_period_end                       as current_period_end,
      s.monthly_amount_cents                     as subscription_amount_cents,
      (s.discount is not null)                   as subscription_discounted,
      (p.banned_at is not null)                  as banned,
      exists (select 1 from public.waitlist_entries we
              where lower(we.email) = lower(u.email)) as joined_waitlist,
      nullif(p.display_name, '')                 as display_name,
      nullif(p.avatar_url, '')                   as avatar_url,
      nullif(p.color, '')                        as color,
      pr.last_seen_at                            as last_seen_at,
      coalesce(ob.board_count, 0)::int           as board_count,
      public.derive_acquisition_channel(p.first_source) as acquisition_source,
      ox.last_reached_out_at                      as last_reached_out_at,
      coalesce(ox.outreach_count, 0)::int         as outreach_count,
      (u.email_confirmed_at is not null)          as email_confirmed
    from auth.users u
    left join public.profiles      p  on p.user_id  = u.id
    left join public.subscriptions s  on s.user_id  = u.id
    left join public.user_presence pr on pr.user_id = u.id
    left join owner_cards          oc on oc.uid     = u.id
    left join owner_boards         ob on ob.uid     = u.id
    left join lateral (
      select max(o.reached_at) as last_reached_out_at, count(*)::int as outreach_count
      from public.user_outreach o where o.user_id = u.id or lower(o.email) = lower(u.email)
    ) ox on true
    where (case v_v
             when 'verified'   then (u.email_confirmed_at is not null and u.last_sign_in_at is not null)
             when 'unverified' then (u.email_confirmed_at is null     or  u.last_sign_in_at is null)
             else true
           end)
      and (v_q is null or u.email ilike '%' || v_q || '%')
      and (v_t is null or coalesce(p.tier, 'demo') = v_t)
      and (v_s is null or s.status = v_s)
  )
  select * from base
  where (v_o is null or base.acquisition_source = v_o)
    and (v_c is null
         or (v_c = 'yes' and base.last_reached_out_at is not null)
         or (v_c = 'no'  and base.last_reached_out_at is null))
  order by
    case when v_k = 'recent' then base.created_at end desc nulls last,
    case when v_k = 'active' then base.last_seen_at end desc nulls last,
    case when v_k = 'cards'  then base.card_count end desc nulls last,
    case when v_k = 'spend'  then base.subscription_amount_cents end desc nulls last,
    case when v_k = 'name'   then lower(coalesce(base.display_name, base.email)) end asc nulls last,
    base.created_at desc nulls last
  limit p_limit
  offset p_offset;
end $function$;

-- ── admin_user_count: same normalizer so the p_source filter matches the list ─
create or replace function public.admin_user_count(p_query text DEFAULT NULL::text, p_tier text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_source text DEFAULT NULL::text, p_contacted text DEFAULT NULL::text, p_verification text DEFAULT 'verified'::text)
 returns bigint
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_q text := nullif(trim(coalesce(p_query,     '')), '');
  v_t text := nullif(trim(coalesce(p_tier,      '')), '');
  v_s text := nullif(trim(coalesce(p_status,    '')), '');
  v_o text := nullif(trim(coalesce(p_source,    '')), '');
  v_c text := nullif(trim(coalesce(p_contacted, '')), '');
  v_v text := lower(coalesce(nullif(trim(p_verification), ''), 'verified'));
  v_n bigint;
begin
  perform public._require_admin();

  with base as (
    select
      public.derive_acquisition_channel(p.first_source) as acquisition_source
    from auth.users u
    left join public.profiles      p on p.user_id = u.id
    left join public.subscriptions s on s.user_id = u.id
    where (case v_v
             when 'verified'   then (u.email_confirmed_at is not null and u.last_sign_in_at is not null)
             when 'unverified' then (u.email_confirmed_at is null     or  u.last_sign_in_at is null)
             else true
           end)
      and (v_q is null or u.email ilike '%' || v_q || '%')
      and (v_t is null or coalesce(p.tier, 'demo') = v_t)
      and (v_s is null or s.status = v_s)
      and (v_c is null
           or (v_c = 'yes' and     exists (select 1 from public.user_outreach o where o.user_id = u.id or lower(o.email) = lower(u.email)))
           or (v_c = 'no'  and not exists (select 1 from public.user_outreach o where o.user_id = u.id or lower(o.email) = lower(u.email))))
  )
  select count(*) into v_n from base
  where (v_o is null or base.acquisition_source = v_o);

  return v_n;
end $function$;

-- ── admin_acquisition_breakdown: bucket by the unified channel ────────────────
create or replace function public.admin_acquisition_breakdown(p_days integer, p_exclude_internal boolean DEFAULT true, p_verified_only boolean DEFAULT true)
 returns TABLE(source text, signups integer, converted integer, conversion numeric)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
#variable_conflict use_column
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 36500));
  return query
  with src as (
    select public.derive_acquisition_channel(p.first_source) as source,
           p.first_paid_at is not null as paid
      from public.profiles p
      join auth.users u on u.id = p.user_id
     where (not p_verified_only or (u.email_confirmed_at is not null and u.last_sign_in_at is not null))
       and u.created_at >= now() - (p_days || ' days')::interval
       and (not p_exclude_internal or u.id not in (select iu.user_id from public._internal_user_ids() iu))
  )
  select source,
         count(*)::int as signups,
         sum(case when paid then 1 else 0 end)::int as converted,
         round(sum(case when paid then 1 else 0 end)::numeric / nullif(count(*), 0), 4) as conversion
    from src group by source order by signups desc;
end;
$function$;

-- ── admin_retention_by_source: derive ad/referral/organic FROM the channel ────
create or replace function public.admin_retention_by_source(p_window_days integer DEFAULT 30, p_exclude_internal boolean DEFAULT true, p_verified_only boolean DEFAULT true)
 returns TABLE(source text, day_offset integer, eligible integer, active integer, active_pct numeric)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_track_start date;
begin
  perform public._require_admin();
  p_window_days := greatest(1, least(p_window_days, 365));
  select min(day) into v_track_start from public.user_active_day;
  v_track_start := coalesce(v_track_start, current_date);
  return query
  with u as (
    select usr.id as user_id, usr.created_at::date as signup_day,
           case
             when public.derive_acquisition_channel(p.first_source) ~ '(_ads$|^meta_paid$)' then 'ad'
             when public.derive_acquisition_channel(p.first_source) = 'direct'               then 'organic'
             else 'referral'
           end as source
      from auth.users usr
      left join public.profiles p on p.user_id = usr.id
     where (not p_verified_only or (usr.email_confirmed_at is not null and usr.last_sign_in_at is not null))
       and (not p_exclude_internal or usr.id not in (select iu.user_id from public._internal_user_ids() iu))
  ),
  grid as (
    select u.source, u.user_id, d.day_offset, (u.signup_day + d.day_offset) as cal_day
      from u cross join generate_series(0, p_window_days) as d(day_offset)
     where u.signup_day + d.day_offset <= current_date
       and u.signup_day + d.day_offset >= v_track_start
  ),
  marked as (
    select g.source, g.day_offset,
           exists(select 1 from public.user_active_day a
                   where a.user_id = g.user_id and a.day = g.cal_day) as is_active
      from grid g
  )
  select m.source, m.day_offset,
         count(*)::int,
         sum(case when m.is_active then 1 else 0 end)::int,
         round(sum(case when m.is_active then 1 else 0 end)::numeric / nullif(count(*), 0), 4)
    from marked m
   group by m.source, m.day_offset
   order by m.source, m.day_offset;
end $function$;

-- ── admin_user_detail: unified label + all captured fields + last-touch ───────
create or replace function public.admin_user_detail(p_user_id uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_out jsonb;
begin
  perform public._require_admin();

  if p_user_id is null then
    raise exception 'user id required' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'user_id', u.id,
    'email',   u.email::text,
    'flags', jsonb_build_object(
      'banned',          (p.banned_at is not null),
      'is_internal',     exists (select 1 from public._internal_user_ids() iu(id) where iu.id = u.id),
      'email_confirmed', (u.email_confirmed_at is not null),
      'last_sign_in_at', u.last_sign_in_at,
      'verified',        (u.email_confirmed_at is not null and u.last_sign_in_at is not null)
    ),
    'identity', jsonb_build_object(
      'display_name', nullif(p.display_name, ''),
      'avatar_url',   nullif(p.avatar_url, ''),
      'color',        nullif(p.color, ''),
      'tier',         coalesce(p.tier, 'demo'),
      'banned',       (p.banned_at is not null),
      'banned_at',    p.banned_at,
      'banned_by',    p.banned_by,
      'banned_by_email', (select bu.email::text from auth.users bu where bu.id = p.banned_by),
      'banned_reason',   p.banned_reason
    ),
    'acquisition', jsonb_build_object(
      'label',         public.derive_acquisition_channel(p.first_source),
      'utm_source',    nullif(p.first_source->>'utm_source', ''),
      'utm_medium',    nullif(p.first_source->>'utm_medium', ''),
      'utm_campaign',  nullif(p.first_source->>'utm_campaign', ''),
      'utm_content',   nullif(p.first_source->>'utm_content', ''),
      'utm_term',      nullif(p.first_source->>'utm_term', ''),
      'referrer',      nullif(p.first_source->>'referrer', ''),
      'referrer_host', nullif(p.first_source->>'referrer_host', ''),
      'landing_path',  nullif(p.first_source->>'landing_path', ''),
      'fbclid',        nullif(p.first_source->>'fbclid', ''),
      'gclid',         nullif(p.first_source->>'gclid', ''),
      'wbraid',        nullif(p.first_source->>'wbraid', ''),
      'gbraid',        nullif(p.first_source->>'gbraid', ''),
      'msclkid',       nullif(p.first_source->>'msclkid', ''),
      'ttclid',        nullif(p.first_source->>'ttclid', ''),
      'twclid',        nullif(p.first_source->>'twclid', ''),
      'rdt_cid',       nullif(p.first_source->>'rdt_cid', ''),
      'li_fat_id',     nullif(p.first_source->>'li_fat_id', ''),
      'epik',          nullif(p.first_source->>'epik', ''),
      'sccid',         nullif(p.first_source->>'sccid', ''),
      'share_token',   nullif(p.first_source->>'share_token', ''),
      'public_slug',   nullif(p.first_source->>'public_slug', ''),
      'last_touch', case when lt.bag is null then null
        else (lt.bag
              || jsonb_build_object('channel', public.derive_acquisition_channel(lt.bag))
              || (case when lt.touched_at is not null then jsonb_build_object('at', lt.touched_at) else '{}'::jsonb end))
        end,
      'raw',           coalesce(p.first_source, '{}'::jsonb)
    ),
    'activation', jsonb_build_object(
      'created_at',        u.created_at,
      'first_board_at',    p.first_board_at,
      'first_card_at',     p.first_card_at,
      'first_share_at',    p.first_share_at,
      'first_backlink_at', p.first_backlink_at,
      'first_paid_at',     p.first_paid_at,
      'milestones', coalesce((
        select jsonb_agg(jsonb_build_object('key', m.key, 'at', m.at) order by m.at asc)
        from (
          values
            ('signed_up',     u.created_at),
            ('first_board',   p.first_board_at),
            ('first_card',    p.first_card_at),
            ('first_share',   p.first_share_at),
            ('first_backlink',p.first_backlink_at),
            ('first_paid',    p.first_paid_at)
        ) as m(key, at)
        where m.at is not null
      ), '[]'::jsonb)
    ),
    'engagement', jsonb_build_object(
      'seconds_in_app',  coalesce(p.seconds_in_app, 0),
      'last_seen_at',    pr.last_seen_at,
      'online',          (pr.last_seen_at is not null and pr.last_seen_at > now() - interval '5 minutes'),
      'card_count',      coalesce(oc.card_count, 0),
      'board_count',     coalesce(ob.board_count, 0),
      'demo_card_count', coalesce(p.demo_card_count, 0),
      'demo_card_cap',   100
    ),
    'device', jsonb_build_object(
      'last', (
        select jsonb_build_object(
          'device_type', e.props->>'device_type',
          'os',          e.props->>'os',
          'browser',     e.props->>'browser',
          'at',          e.occurred_at
        )
        from public.analytics_events e
        where e.user_id = u.id and nullif(e.props->>'device_type', '') is not null
        order by e.occurred_at desc
        limit 1
      ),
      'breakdown', coalesce((
        select jsonb_agg(jsonb_build_object('device_type', d.dt, 'events', d.n) order by d.n desc)
        from (
          select coalesce(nullif(e.props->>'device_type', ''), 'unknown') as dt, count(*)::int as n
          from public.analytics_events e
          where e.user_id = u.id and nullif(e.props->>'device_type', '') is not null
          group by 1
        ) d
      ), '[]'::jsonb)
    ),
    'billing', case when s.user_id is null then null else jsonb_build_object(
      'plan',                  s.plan,
      'status',                s.status,
      'trialing',              (s.status = 'trialing'),
      'monthly_amount_cents',  s.monthly_amount_cents,
      'discount',              s.discount,
      'discounted',            (s.discount is not null),
      'cancel_at_period_end',  coalesce(s.cancel_at_period_end, false),
      'current_period_end',    s.current_period_end,
      'stripe_customer_id',    s.stripe_customer_id,
      'stripe_subscription_id',s.stripe_subscription_id,
      'updated_at',            s.updated_at
    ) end,
    'grants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'email',            g.email,
        'status',           public._grant_status(g.revoked_at, g.expires_at),
        'expires_at',       g.expires_at,
        'granted_at',       g.granted_at,
        'granted_by_email', g.granted_by_email,
        'revoked_at',       g.revoked_at,
        'note',             g.note
      ) order by
        case when g.revoked_at is null then 0 else 1 end asc,
        g.granted_at desc)
      from public.paid_grants g
      where g.user_id = u.id or lower(g.email) = lower(u.email)
    ), '[]'::jsonb),
    'outreach', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',               o.id,
        'email',            o.email,
        'reached_at',       o.reached_at,
        'reached_by_email', o.reached_by_email,
        'note',             o.note
      ) order by o.reached_at desc)
      from public.user_outreach o
      where o.user_id = u.id or lower(o.email) = lower(u.email)
    ), '[]'::jsonb)
  )
  into v_out
  from auth.users u
  left join public.profiles      p  on p.user_id  = u.id
  left join public.subscriptions s  on s.user_id  = u.id
  left join public.user_presence pr on pr.user_id = u.id
  left join lateral (
    select count(*)::int as card_count
    from public.card_index ci
    join public.boards b on b.id = ci.board_id
    where b.created_by = u.id
  ) oc on true
  left join lateral (
    select count(*)::int as board_count
    from public.boards b
    where b.created_by = u.id and b.deleted_at is null
  ) ob on true
  left join lateral (
    -- Most recent event that carried a last-touch signal: rebuild the lt_* props
    -- back into a first_source-shaped bag so the same normalizer brands it.
    select (select jsonb_object_agg(substr(k, 4), val)
              from jsonb_each_text(e.props) kv(k, val)
             where starts_with(k, 'lt_') and k <> 'lt_last_touch_at') as bag,
           e.props->>'lt_last_touch_at' as touched_at
    from public.analytics_events e
    where e.user_id = u.id and e.props ? 'lt_last_touch_at'
    order by e.occurred_at desc
    limit 1
  ) lt on true
  where u.id = p_user_id;

  if v_out is null then
    raise exception 'user not found: %', p_user_id using errcode = 'P0002';
  end if;

  return v_out;
end $function$;
