-- 0149_verified_logged_in_users.sql
--
-- Tighten the definition of a "user" everywhere in the admin dashboard and add
-- controls to still see everyone.
--
-- 0102 made a user "real" once their email was confirmed
-- (auth.users.email_confirmed_at is not null). This goes one step further: a
-- user now counts only once they have ALSO logged in at least once
-- (auth.users.last_sign_in_at is not null). The canonical predicate is:
--
--     (u.email_confirmed_at is not null and u.last_sign_in_at is not null)
--
-- This is the DEFAULT everywhere. Two escape hatches let admins still see the
-- whole population:
--
--   * Analytics: every user-count RPC gains a trailing
--     `p_verified_only boolean DEFAULT true`. When false the verified predicate
--     is dropped, mirroring the existing p_exclude_internal idiom:
--         (not p_verified_only or (<verified expr>))
--     A new dashboard-wide "Verified only" toggle drives it.
--
--   * Users tab: admin_list_users / admin_user_count gain
--     `p_verification text DEFAULT 'verified'` ('verified' | 'unverified' | 'all')
--     so the list can show verified, only-unverified, or everyone. admin_list_users
--     also returns email_confirmed so the UI can badge unverified rows.
--     admin_user_detail no longer hides unverified users (admins can open anyone).
--
-- NOTE on magic-link auth: verifyOtp sets email_confirmed_at and last_sign_in_at
-- in the SAME write, so adding the last_sign_in_at half rarely moves the
-- analytics numbers — it mainly excludes confirmed-but-never-signed-in accounts
-- (near-empty for an OTP flow). The big visible gap (provisional, never-confirmed
-- OTP rows) is what the Users-tab 'unverified'/'all' options reveal.
--
-- Functions whose ARG LIST or RETURNS columns change are DROP-then-CREATE (a
-- defaulted trailing param otherwise leaves an ambiguous overload, 42725). No-arg
-- delegators are dropped first, then recreated after their parameterized version.
-- GRANTs do not survive a DROP, so every recreated function re-issues
-- revoke/grant with its NEW argument-type list.

------------------------------------------------------------------
-- A1. Headline stats
------------------------------------------------------------------

-- admin_stats — gains p_verified_only so the Analytics shell can flip the
-- headline user counts. The 3 no-arg callers keep working on the default.
drop function if exists public.admin_stats();
create or replace function public.admin_stats(p_verified_only boolean default true)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_out jsonb;
begin
  perform public._require_admin();

  select jsonb_build_object(
    'total_users',     (select count(*) from auth.users u
                          where (not p_verified_only
                                 or (u.email_confirmed_at is not null and u.last_sign_in_at is not null))),
    'new_users_7d',    (select count(*) from auth.users u
                          where (not p_verified_only
                                 or (u.email_confirmed_at is not null and u.last_sign_in_at is not null))
                            and u.created_at >= now() - interval '7 days'),
    'tier_counts',     coalesce((select jsonb_object_agg(tier, n) from (
                          select p.tier, count(*) as n
                          from public.profiles p
                          join auth.users u on u.id = p.user_id
                          where (not p_verified_only
                                 or (u.email_confirmed_at is not null and u.last_sign_in_at is not null))
                          group by p.tier
                        ) t), '{}'::jsonb),
    'sub_counts',      coalesce((select jsonb_object_agg(status, n) from (
                          select status, count(*) as n
                          from public.subscriptions
                          where status is not null
                          group by status
                        ) s), '{}'::jsonb),
    'mrr_cents',       coalesce((
                          select sum(coalesce(
                            monthly_amount_cents,
                            case when plan = 'monthly' then 2500
                                 when plan = 'annual'  then 2000
                                 else 0 end
                          ))::int
                          from public.subscriptions
                          where status in ('active', 'trialing')
                        ), 0),
    'comped_paid',     (select count(*) from public.profiles p
                          where p.tier = 'paid'
                            and not exists (
                              select 1 from public.subscriptions s
                              where s.user_id = p.user_id and s.status in ('active', 'trialing')
                            )),
    'discounted_subs', (select count(*) from public.subscriptions
                          where status in ('active', 'trialing') and discount is not null),
    'waitlist_pending',(select count(*) from public.waitlist_entries where status = 'pending'),
    'waitlist_total',  (select count(*) from public.waitlist_entries)
  ) into v_out;
  return v_out;
end $$;
revoke all on function public.admin_stats(boolean) from public;
grant execute on function public.admin_stats(boolean) to authenticated;

-- admin_signups_by_day — verified + logged-in signups, toggleable.
drop function if exists public.admin_signups_by_day(integer);
create or replace function public.admin_signups_by_day(
  p_days integer default 30,
  p_verified_only boolean default true)
returns table(day date, signups integer)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 365));
  return query
  select d::date as day, coalesce(c.n, 0)::int as signups
  from generate_series(
    current_date - (p_days - 1),
    current_date,
    '1 day'::interval
  ) d
  left join (
    select date_trunc('day', u.created_at)::date as day, count(*)::int as n
    from auth.users u
    where (not p_verified_only
           or (u.email_confirmed_at is not null and u.last_sign_in_at is not null))
      and u.created_at >= (current_date - (p_days - 1))::timestamptz
    group by 1
  ) c on c.day = d::date
  order by day asc;
end $$;
revoke all on function public.admin_signups_by_day(integer, boolean) from public;
grant execute on function public.admin_signups_by_day(integer, boolean) to authenticated;

-- admin_universe_stats — live ticker "+N users today" (not toggleable; just
-- tighten the definition to verified + logged-in).
create or replace function public.admin_universe_stats()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_counters jsonb;
  v_today    jsonb;
  v_midnight timestamptz := date_trunc('day', now());
begin
  perform public._require_admin();
  select jsonb_object_agg(key, value) into v_counters from public.platform_counters;
  v_today := jsonb_build_object(
    'users',      (select count(*) from auth.users
                     where email_confirmed_at is not null
                       and last_sign_in_at is not null
                       and created_at >= v_midnight),
    'workspaces', (select count(*) from public.workspaces where created_at >= v_midnight),
    'boards',     (select count(*) from public.boards  where created_at >= v_midnight and deleted_at is null),
    'cards',      (select count(*) from public.card_index where updated_at >= v_midnight),
    'links',      (
      (select count(*) from public.entity_links where created_at >= v_midnight)
    + (select count(*) from public.doc_backlinks where updated_at >= v_midnight)
    )
  );
  return coalesce(v_counters, '{}'::jsonb) || jsonb_build_object('today', v_today);
end $$;

------------------------------------------------------------------
-- A2. Users tab — verified/unverified/all dropdown
------------------------------------------------------------------

-- admin_list_users — adds p_verification + an email_confirmed badge column.
drop function if exists public.admin_list_users(int, int, text, text, text, text, text, text);
create or replace function public.admin_list_users(
  p_limit     integer default 50,
  p_offset    integer default 0,
  p_query     text    default null,
  p_tier      text    default null,
  p_sort      text    default 'recent',
  p_status    text    default null,
  p_source    text    default null,
  p_contacted text    default null,
  p_verification text default 'verified'
)
returns table(
  user_id                   uuid,
  email                     text,
  tier                      text,
  card_count                integer,
  seconds_in_app            bigint,
  created_at                timestamptz,
  last_sign_in_at           timestamptz,
  subscription_plan         text,
  subscription_status       text,
  current_period_end        timestamptz,
  subscription_amount_cents integer,
  subscription_discounted   boolean,
  banned                    boolean,
  joined_waitlist           boolean,
  display_name              text,
  avatar_url                text,
  color                     text,
  last_seen_at              timestamptz,
  board_count               integer,
  acquisition_source        text,
  last_reached_out_at       timestamptz,
  outreach_count            integer,
  email_confirmed           boolean
)
language plpgsql stable security definer set search_path to 'public' as $$
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
      case
        when nullif(p.first_source->>'fbclid', '') is not null then 'facebook'
        when nullif(lower(p.first_source->>'utm_source'), '') is not null
          then lower(p.first_source->>'utm_source')
        when nullif(p.first_source->>'referrer', '') is not null then
          split_part(
            regexp_replace(
              regexp_replace(p.first_source->>'referrer', '^https?://', '', 'i'),
              '^www\.', '', 'i'),
            '/', 1)
        else 'direct'
      end                                        as acquisition_source,
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
end $$;
revoke all on function public.admin_list_users(int, int, text, text, text, text, text, text, text) from public;
grant execute on function public.admin_list_users(int, int, text, text, text, text, text, text, text) to authenticated;

-- admin_user_count — same verification filter as the list.
drop function if exists public.admin_user_count(text, text, text, text, text);
create or replace function public.admin_user_count(
  p_query     text default null,
  p_tier      text default null,
  p_status    text default null,
  p_source    text default null,
  p_contacted text default null,
  p_verification text default 'verified'
)
returns bigint language plpgsql stable security definer set search_path to 'public' as $$
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
      case
        when nullif(p.first_source->>'fbclid', '') is not null then 'facebook'
        when nullif(lower(p.first_source->>'utm_source'), '') is not null
          then lower(p.first_source->>'utm_source')
        when nullif(p.first_source->>'referrer', '') is not null then
          split_part(
            regexp_replace(
              regexp_replace(p.first_source->>'referrer', '^https?://', '', 'i'),
              '^www\.', '', 'i'),
            '/', 1)
        else 'direct'
      end as acquisition_source
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
end $$;
revoke all on function public.admin_user_count(text, text, text, text, text, text) from public;
grant execute on function public.admin_user_count(text, text, text, text, text, text) to authenticated;

-- admin_user_detail — admins can open ANY user (verified gate removed); expose
-- verification status in flags.
create or replace function public.admin_user_detail(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
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
      'label', case
        when nullif(p.first_source->>'fbclid', '') is not null then 'facebook'
        when nullif(lower(p.first_source->>'utm_source'), '') is not null
          then lower(p.first_source->>'utm_source')
        when nullif(p.first_source->>'referrer', '') is not null then
          split_part(
            regexp_replace(
              regexp_replace(p.first_source->>'referrer', '^https?://', '', 'i'),
              '^www\.', '', 'i'),
            '/', 1)
        else 'direct'
      end,
      'utm_source',   nullif(p.first_source->>'utm_source', ''),
      'utm_medium',   nullif(p.first_source->>'utm_medium', ''),
      'utm_campaign', nullif(p.first_source->>'utm_campaign', ''),
      'utm_content',  nullif(p.first_source->>'utm_content', ''),
      'utm_term',     nullif(p.first_source->>'utm_term', ''),
      'referrer',     nullif(p.first_source->>'referrer', ''),
      'fbclid',       nullif(p.first_source->>'fbclid', ''),
      'fbc',          nullif(p.first_source->>'fbc', ''),
      'raw',          coalesce(p.first_source, '{}'::jsonb)
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
  where u.id = p_user_id;

  if v_out is null then
    raise exception 'user not found: %', p_user_id using errcode = 'P0002';
  end if;

  return v_out;
end $function$;
revoke all on function public.admin_user_detail(uuid) from public;
grant execute on function public.admin_user_detail(uuid) to authenticated;

------------------------------------------------------------------
-- A3. Analytics RPCs — gain p_verified_only boolean DEFAULT true.
--     Predicate: (not p_verified_only or (<alias>.email_confirmed_at is not null
--                                         and <alias>.last_sign_in_at is not null))
--     alongside the existing (not p_exclude_internal or ...).
------------------------------------------------------------------

-- admin_kpi_summary — verified predicate in the signers CTE.
drop function if exists public.admin_kpi_summary(integer, boolean);
create or replace function public.admin_kpi_summary(
  p_days integer DEFAULT 30,
  p_exclude_internal boolean DEFAULT true,
  p_verified_only boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_out     jsonb;
  v_now     timestamptz := now();
  v_cur_lo  timestamptz;
  v_prev_lo timestamptz;
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 365));
  v_cur_lo  := v_now - (p_days || ' days')::interval;
  v_prev_lo := v_now - ((2 * p_days) || ' days')::interval;

  with
  signers as (
    select u.id, u.created_at, p.tier, p.first_card_at, p.first_paid_at
      from auth.users u
      join public.profiles p on p.user_id = u.id
     where (not p_verified_only or (u.email_confirmed_at is not null and u.last_sign_in_at is not null))
       and u.created_at >= v_prev_lo
       and (not p_exclude_internal or u.id not in (select iu.user_id from public._internal_user_ids() iu))
  ),
  ev as (
    select session_id, event, occurred_at
      from public.analytics_events
     where occurred_at >= v_prev_lo
       and event in ('checkout_open', 'checkout_success')
       and (not p_exclude_internal
            or session_id is null
            or session_id not in (select isess.session_id from public._internal_session_ids() isess))
  ),
  cards as (
    select ci.updated_at
      from public.card_index ci
      left join public.boards b on b.id = ci.board_id
     where ci.updated_at >= v_prev_lo
       and (not p_exclude_internal
            or b.created_by is null
            or b.created_by not in (select iu.user_id from public._internal_user_ids() iu))
  ),
  wau as (
    select day, user_id
      from public.user_active_day
     where (not p_exclude_internal or user_id not in (select iu.user_id from public._internal_user_ids() iu))
  )
  select jsonb_build_object(
    'current', jsonb_build_object(
      'signups',          (select count(*) from signers where created_at >= v_cur_lo),
      'activated',        (select count(*) from signers where created_at >= v_cur_lo and first_card_at is not null),
      'activation_rate',  (select round(count(*) filter (where first_card_at is not null)::numeric
                                        / nullif(count(*), 0), 4)
                             from signers where created_at >= v_cur_lo),
      'demo_base',        (select count(*) from signers where created_at >= v_cur_lo and tier in ('demo','paid')),
      'converted',        (select count(*) from signers where created_at >= v_cur_lo and first_paid_at is not null),
      'demo_to_paid_rate',(select round(count(*) filter (where first_paid_at is not null)::numeric
                                        / nullif(count(*) filter (where tier in ('demo','paid')), 0), 4)
                             from signers where created_at >= v_cur_lo),
      'checkout_open',    (select count(distinct session_id) from ev where event='checkout_open'    and occurred_at >= v_cur_lo),
      'checkout_success', (select count(distinct session_id) from ev where event='checkout_success' and occurred_at >= v_cur_lo),
      'checkout_success_rate', (
        select round(
          (select count(distinct session_id) from ev where event='checkout_success' and occurred_at >= v_cur_lo)::numeric
          / nullif((select count(distinct session_id) from ev where event='checkout_open' and occurred_at >= v_cur_lo), 0), 4)),
      'wau',              (select count(distinct user_id) from wau
                             where day >= (v_now - interval '7 days')::date and day <= v_now::date),
      'cards_created',    (select count(*) from cards where updated_at >= v_cur_lo)
    ),
    'previous', jsonb_build_object(
      'signups',          (select count(*) from signers where created_at >= v_prev_lo and created_at < v_cur_lo),
      'activated',        (select count(*) from signers where created_at >= v_prev_lo and created_at < v_cur_lo and first_card_at is not null),
      'activation_rate',  (select round(count(*) filter (where first_card_at is not null)::numeric
                                        / nullif(count(*), 0), 4)
                             from signers where created_at >= v_prev_lo and created_at < v_cur_lo),
      'demo_base',        (select count(*) from signers where created_at >= v_prev_lo and created_at < v_cur_lo and tier in ('demo','paid')),
      'converted',        (select count(*) from signers where created_at >= v_prev_lo and created_at < v_cur_lo and first_paid_at is not null),
      'demo_to_paid_rate',(select round(count(*) filter (where first_paid_at is not null)::numeric
                                        / nullif(count(*) filter (where tier in ('demo','paid')), 0), 4)
                             from signers where created_at >= v_prev_lo and created_at < v_cur_lo),
      'checkout_open',    (select count(distinct session_id) from ev where event='checkout_open'    and occurred_at >= v_prev_lo and occurred_at < v_cur_lo),
      'checkout_success', (select count(distinct session_id) from ev where event='checkout_success' and occurred_at >= v_prev_lo and occurred_at < v_cur_lo),
      'checkout_success_rate', (
        select round(
          (select count(distinct session_id) from ev where event='checkout_success' and occurred_at >= v_prev_lo and occurred_at < v_cur_lo)::numeric
          / nullif((select count(distinct session_id) from ev where event='checkout_open' and occurred_at >= v_prev_lo and occurred_at < v_cur_lo), 0), 4)),
      'wau',              (select count(distinct user_id) from wau
                             where day >= (v_cur_lo - interval '7 days')::date and day < v_cur_lo::date),
      'cards_created',    (select count(*) from cards where updated_at >= v_prev_lo and updated_at < v_cur_lo)
    )
  ) into v_out;

  return v_out;
end;
$function$;
revoke all on function public.admin_kpi_summary(integer, boolean, boolean) from public;
grant execute on function public.admin_kpi_summary(integer, boolean, boolean) to authenticated;

-- admin_activation_funnel — verified predicate in the p CTE; recreate the no-arg
-- delegator so its 1-arg call resolves to the new (integer, boolean, boolean).
drop function if exists public.admin_activation_funnel();
drop function if exists public.admin_activation_funnel(integer, boolean);
create or replace function public.admin_activation_funnel(
  p_days integer,
  p_exclude_internal boolean default true,
  p_verified_only boolean default true
)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
#variable_conflict use_column
declare v_out jsonb;
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 36500));
  with p as (
    select pr.* from public.profiles pr join auth.users u on u.id = pr.user_id
     where (not p_verified_only or (u.email_confirmed_at is not null and u.last_sign_in_at is not null))
       and u.created_at >= now() - (p_days || ' days')::interval
       and (not p_exclude_internal or u.id not in (select iu.user_id from public._internal_user_ids() iu))
  )
  select jsonb_build_object(
    'signed_up',       (select count(*) from p),
    'first_board',     (select count(*) from p where first_board_at           is not null),
    'first_card',      (select count(*) from p where first_card_at            is not null),
    'populated_board', (select count(*) from p where first_populated_board_at is not null),
    'first_share',     (select count(*) from p where first_share_at           is not null),
    'first_backlink',  (select count(*) from p where first_backlink_at        is not null),
    'first_paid',      (select count(*) from p where first_paid_at            is not null)
  ) into v_out;
  return v_out;
end;
$function$;
revoke all on function public.admin_activation_funnel(integer, boolean, boolean) from public;
grant execute on function public.admin_activation_funnel(integer, boolean, boolean) to authenticated;

create or replace function public.admin_activation_funnel()
 RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select public.admin_activation_funnel(36500);
$function$;

-- admin_acquisition_breakdown — verified predicate in the src CTE; recreate the
-- no-arg delegator. (Live body is 0115's, with the fbclid bucket.)
drop function if exists public.admin_acquisition_breakdown();
drop function if exists public.admin_acquisition_breakdown(integer, boolean);
create or replace function public.admin_acquisition_breakdown(
  p_days integer,
  p_exclude_internal boolean default true,
  p_verified_only boolean default true)
returns table(source text, signups integer, converted integer, conversion numeric)
language plpgsql stable security definer set search_path to 'public'
as $function$
#variable_conflict use_column
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 36500));
  return query
  with src as (
    select coalesce(nullif(p.first_source->>'utm_source', ''),
                    case when nullif(p.first_source->>'fbclid', '') is not null
                         then 'facebook/instagram (fbclid)' end,
                    nullif(p.first_source->>'referrer', ''),
                    'direct') as source,
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
revoke all on function public.admin_acquisition_breakdown(integer, boolean, boolean) from public;
grant execute on function public.admin_acquisition_breakdown(integer, boolean, boolean) to authenticated;

create or replace function public.admin_acquisition_breakdown()
 RETURNS TABLE(source text, signups integer, converted integer, conversion numeric)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ select * from public.admin_acquisition_breakdown(36500); $function$;

-- admin_tier_usage_compare — verified predicate in user_stats; recreate delegator.
drop function if exists public.admin_tier_usage_compare();
drop function if exists public.admin_tier_usage_compare(integer, boolean);
create or replace function public.admin_tier_usage_compare(
  p_days integer,
  p_exclude_internal boolean default true,
  p_verified_only boolean default true)
 RETURNS TABLE(tier text, users bigint, avg_cards numeric, avg_boards numeric, total_cards bigint, total_boards bigint)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
#variable_conflict use_column
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 36500));
  return query
  with user_stats as (
    select
      coalesce(p.tier, 'demo')::text as t_tier,
      u.id as user_id,
      coalesce((select count(*) from public.boards b where b.created_by = u.id), 0)::bigint as board_count,
      coalesce((select count(*) from public.card_index ci
                join public.boards b on b.id = ci.board_id
                where b.created_by = u.id), 0)::bigint as card_count
    from auth.users u
    left join public.profiles p on p.user_id = u.id
    where (not p_verified_only or (u.email_confirmed_at is not null and u.last_sign_in_at is not null))
      and u.created_at >= now() - (p_days || ' days')::interval
      and (not p_exclude_internal or u.id not in (select iu.user_id from public._internal_user_ids() iu))
  )
  select
    t_tier                              as tier,
    count(*)::bigint                    as users,
    round(avg(card_count)::numeric, 1)  as avg_cards,
    round(avg(board_count)::numeric, 1) as avg_boards,
    sum(card_count)::bigint             as total_cards,
    sum(board_count)::bigint            as total_boards
  from user_stats
  group by t_tier
  order by case t_tier
    when 'admin'    then 1
    when 'paid'     then 2
    when 'demo'     then 3
    when 'waitlist' then 4
    else 5
  end;
end;
$function$;
revoke all on function public.admin_tier_usage_compare(integer, boolean, boolean) from public;
grant execute on function public.admin_tier_usage_compare(integer, boolean, boolean) to authenticated;

create or replace function public.admin_tier_usage_compare()
 RETURNS TABLE(tier text, users bigint, avg_cards numeric, avg_boards numeric, total_cards bigint, total_boards bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select * from public.admin_tier_usage_compare(36500);
$function$;

-- admin_retention_curve — verified predicate in the u CTE (alias usr).
drop function if exists public.admin_retention_curve(integer, boolean);
create or replace function public.admin_retention_curve(
  p_window_days integer default 30,
  p_exclude_internal boolean default true,
  p_verified_only boolean default true
)
returns table(segment text, day_offset integer, eligible integer, active integer, active_pct numeric)
language plpgsql stable security definer set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  v_track_start date;
begin
  perform public._require_admin();
  p_window_days := greatest(1, least(p_window_days, 365));
  select min(day) into v_track_start from public.user_active_day;
  v_track_start := coalesce(v_track_start, current_date);
  return query
  with u as (
    select usr.id as user_id, usr.created_at::date as signup_day,
           coalesce(p.tier, 'demo') as tier
      from auth.users usr
      left join public.profiles p on p.user_id = usr.id
     where (not p_verified_only or (usr.email_confirmed_at is not null and usr.last_sign_in_at is not null))
       and (not p_exclude_internal or usr.id not in (select iu.user_id from public._internal_user_ids() iu))
  ),
  grid as (
    select u.user_id, u.tier, d.day_offset, (u.signup_day + d.day_offset) as cal_day
      from u
      cross join generate_series(0, p_window_days) as d(day_offset)
     where u.signup_day + d.day_offset <= current_date
       and u.signup_day + d.day_offset >= v_track_start
  ),
  marked as (
    select g.day_offset, g.tier,
           exists (select 1 from public.user_active_day a
                    where a.user_id = g.user_id and a.day = g.cal_day) as is_active
      from grid g
  ),
  seg as (
    select 'all'::text as segment, m.day_offset, m.is_active from marked m
    union all
    select m.tier, m.day_offset, m.is_active from marked m where m.tier in ('demo', 'paid')
  )
  select s.segment, s.day_offset,
         count(*)::int as eligible,
         sum(case when s.is_active then 1 else 0 end)::int as active,
         round(sum(case when s.is_active then 1 else 0 end)::numeric / nullif(count(*), 0), 4) as active_pct
    from seg s
   group by s.segment, s.day_offset
   order by s.segment, s.day_offset;
end $function$;
revoke all on function public.admin_retention_curve(integer, boolean, boolean) from public;
grant execute on function public.admin_retention_curve(integer, boolean, boolean) to authenticated;

-- admin_user_lifespan — verified predicate in per_user (alias u).
drop function if exists public.admin_user_lifespan(boolean);
create or replace function public.admin_user_lifespan(
  p_exclude_internal boolean default true,
  p_verified_only boolean default true
)
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  v jsonb;
begin
  perform public._require_admin();
  with per_user as (
    select u.id as user_id, count(distinct a.day) as active_days
      from auth.users u
      left join public.user_active_day a on a.user_id = u.id
     where (not p_verified_only or (u.email_confirmed_at is not null and u.last_sign_in_at is not null))
       and (not p_exclude_internal or u.id not in (select iu.user_id from public._internal_user_ids() iu))
     group by u.id
  ),
  bucketed as (
    select case
             when active_days <= 1  then '0–1'
             when active_days <= 2  then '2'
             when active_days <= 4  then '3–4'
             when active_days <= 7  then '5–7'
             when active_days <= 14 then '8–14'
             else '15+'
           end as label,
           case
             when active_days <= 1  then 1
             when active_days <= 2  then 2
             when active_days <= 4  then 3
             when active_days <= 7  then 4
             when active_days <= 14 then 5
             else 6
           end as ord
      from per_user
  )
  select jsonb_build_object(
    'total_users',        (select count(*) from per_user),
    'median_active_days', (select round(percentile_cont(0.5) within group (order by active_days)::numeric, 1) from per_user),
    'p90_active_days',    (select round(percentile_cont(0.9) within group (order by active_days)::numeric, 1) from per_user),
    'mean_active_days',   (select round(avg(active_days)::numeric, 1) from per_user),
    'buckets',            (select coalesce(jsonb_agg(jsonb_build_object('label', label, 'ord', ord, 'users', n) order by ord), '[]'::jsonb)
                             from (select label, ord, count(*)::int as n from bucketed group by label, ord) b)
  ) into v;
  return v;
end $function$;
revoke all on function public.admin_user_lifespan(boolean, boolean) from public;
grant execute on function public.admin_user_lifespan(boolean, boolean) to authenticated;

-- admin_return_rate — verified predicate in the u CTE (alias usr).
drop function if exists public.admin_return_rate(boolean);
create or replace function public.admin_return_rate(
  p_exclude_internal boolean default true,
  p_verified_only boolean default true)
returns table(day_offset integer, eligible integer, returned_on integer, on_pct numeric,
              returned_within integer, within_pct numeric)
language plpgsql stable security definer set search_path to 'public' as $function$
declare v_track_start date;
begin
  perform public._require_admin();
  select min(day) into v_track_start from public.user_active_day;
  v_track_start := coalesce(v_track_start, current_date);
  return query
  with u as (
    select usr.id as user_id, usr.created_at::date as signup_day
      from auth.users usr
     where (not p_verified_only or (usr.email_confirmed_at is not null and usr.last_sign_in_at is not null))
       and (not p_exclude_internal or usr.id not in (select iu.user_id from public._internal_user_ids() iu))
  ),
  offs(day_offset) as (values (1),(7),(30)),
  grid as (
    select u.user_id, o.day_offset, (u.signup_day + o.day_offset) as cal_day
      from u cross join offs o
     where (u.signup_day + o.day_offset) <= current_date
       and (u.signup_day + o.day_offset) >= v_track_start
  ),
  marked as (
    select g.day_offset,
           exists(select 1 from public.user_active_day a
                   where a.user_id = g.user_id and a.day = g.cal_day) as on_day,
           exists(select 1 from public.user_active_day a
                   where a.user_id = g.user_id
                     and a.day >  (g.cal_day - g.day_offset)
                     and a.day <= g.cal_day) as within_w
      from grid g
  )
  select m.day_offset,
         count(*)::int,
         sum(case when m.on_day then 1 else 0 end)::int,
         round(sum(case when m.on_day then 1 else 0 end)::numeric / nullif(count(*), 0), 4),
         sum(case when m.within_w then 1 else 0 end)::int,
         round(sum(case when m.within_w then 1 else 0 end)::numeric / nullif(count(*), 0), 4)
    from marked m
   group by m.day_offset
   order by m.day_offset;
end $function$;
revoke all on function public.admin_return_rate(boolean, boolean) from public;
grant execute on function public.admin_return_rate(boolean, boolean) to authenticated;

-- admin_user_dormancy — verified predicate in base (alias u).
drop function if exists public.admin_user_dormancy(boolean);
create or replace function public.admin_user_dormancy(
  p_exclude_internal boolean default true,
  p_verified_only boolean default true)
returns table(user_id uuid, email text, tier text, signup date, last_active_day date,
              days_dormant integer, active_day_count integer, did_card boolean,
              did_populated_board boolean, resurrected boolean)
language plpgsql stable security definer set search_path to 'public' as $function$
begin
  perform public._require_admin();
  return query
  with base as (
    select u.id as uid, u.email::text as email, coalesce(p.tier, 'demo') as tier,
           u.created_at::date as signup,
           p.first_card_at is not null as did_card,
           p.first_populated_board_at is not null as did_pop
      from auth.users u
      left join public.profiles p on p.user_id = u.id
     where (not p_verified_only or (u.email_confirmed_at is not null and u.last_sign_in_at is not null))
       and (not p_exclude_internal or u.id not in (select iu.user_id from public._internal_user_ids() iu))
  ),
  agg as (
    select a.user_id as uid, max(a.day) as last_day, count(distinct a.day)::int as ndays
      from public.user_active_day a group by a.user_id
  ),
  gaps as (
    select uid, bool_or(gap >= 7) as resurrected from (
      select a.user_id as uid,
             (a.day - lag(a.day) over (partition by a.user_id order by a.day)) as gap
        from public.user_active_day a
    ) s group by uid
  )
  select b.uid, b.email, b.tier, b.signup,
         ag.last_day,
         case when ag.last_day is not null then (current_date - ag.last_day) end,
         coalesce(ag.ndays, 0),
         b.did_card, b.did_pop,
         coalesce(g.resurrected, false)
    from base b
    left join agg ag on ag.uid = b.uid
    left join gaps g on g.uid = b.uid
   order by (case when ag.last_day is not null then (current_date - ag.last_day) end) desc nulls last, b.signup;
end $function$;
revoke all on function public.admin_user_dormancy(boolean, boolean) from public;
grant execute on function public.admin_user_dormancy(boolean, boolean) to authenticated;

-- admin_retention_by_source — verified predicate in the u CTE (alias usr).
drop function if exists public.admin_retention_by_source(integer, boolean);
create or replace function public.admin_retention_by_source(
  p_window_days integer default 30,
  p_exclude_internal boolean default true,
  p_verified_only boolean default true
)
returns table(source text, day_offset integer, eligible integer, active integer, active_pct numeric)
language plpgsql stable security definer set search_path to 'public' as $function$
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
             when (p.first_source->>'fbclid') is not null
                  or lower(coalesce(p.first_source->>'utm_source','')) ~ '(facebook|instagram|meta|fb|ig)'
                  or lower(coalesce(p.first_source->>'utm_medium','')) ~ '(cpc|paid|ad|social)'
               then 'ad'
             when coalesce(nullif(p.first_source->>'utm_source',''), nullif(p.first_source->>'referrer','')) is not null
               then 'referral'
             else 'organic'
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
revoke all on function public.admin_retention_by_source(integer, boolean, boolean) from public;
grant execute on function public.admin_retention_by_source(integer, boolean, boolean) to authenticated;

-- admin_event_coverage — verified predicate in the eligible CTE (alias u).
drop function if exists public.admin_event_coverage(integer, boolean);
create or replace function public.admin_event_coverage(
  p_days integer default 90,
  p_exclude_internal boolean default true,
  p_verified_only boolean default true
)
returns table(milestone text, server_truth integer, client_event integer, coverage_pct numeric)
language plpgsql stable security definer set search_path to 'public' as $function$
declare v_since timestamptz;
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 36500));
  v_since := now() - (p_days || ' days')::interval;
  return query
  with eligible as (
    select u.id as uid from auth.users u
     where (not p_verified_only or (u.email_confirmed_at is not null and u.last_sign_in_at is not null))
       and u.created_at >= v_since
       and (not p_exclude_internal or u.id not in (select iu.user_id from public._internal_user_ids() iu))
  ),
  prof as (select p.* from public.profiles p where p.user_id in (select uid from eligible)),
  ev as (
    select event, count(distinct user_id) as users
      from public.analytics_events
     where user_id in (select uid from eligible) and occurred_at >= v_since
     group by event
  ),
  m as (
    select 'first_card'::text as milestone,
           (select count(*) from prof where first_card_at is not null)::int as server_truth,
           'onboarding_first_card'::text as ev_name
    union all
    select 'populated_board',
           (select count(*) from prof where first_populated_board_at is not null)::int, 'activated'
    union all
    select 'first_share',
           (select count(*) from prof where first_share_at is not null)::int, 'share_open'
    union all
    select 'first_paid',
           (select count(*) from prof where first_paid_at is not null)::int, 'checkout_success'
  )
  select m.milestone, m.server_truth,
         coalesce((select e.users from ev e where e.event = m.ev_name), 0)::int as client_event,
         round(coalesce((select e.users from ev e where e.event = m.ev_name), 0)::numeric
               / nullif(m.server_truth, 0), 4) as coverage_pct
    from m
   order by m.milestone;
end $function$;
revoke all on function public.admin_event_coverage(integer, boolean, boolean) from public;
grant execute on function public.admin_event_coverage(integer, boolean, boolean) to authenticated;

-- admin_retention_cohorts — GAP: previously had NO confirm filter. Add verified
-- predicate to the cohorts CTE (alias u). This slightly lowers counts vs. before.
drop function if exists public.admin_retention_cohorts(integer, boolean);
create or replace function public.admin_retention_cohorts(
  p_window_days integer DEFAULT 60,
  p_exclude_internal boolean DEFAULT true,
  p_verified_only boolean DEFAULT true)
 RETURNS TABLE(cohort_week date, day_offset integer, cohort_size integer, active_n integer, active_pct numeric)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
#variable_conflict use_column
begin
  perform public._require_admin();
  p_window_days := greatest(1, least(p_window_days, 365));
  return query
  with cohorts as (
    select date_trunc('week', u.created_at)::date as cohort_week, u.id as user_id
      from auth.users u
     where (not p_verified_only or (u.email_confirmed_at is not null and u.last_sign_in_at is not null))
       and u.created_at >= now() - (p_window_days || ' days')::interval
       and (not p_exclude_internal or u.id not in (select iu.user_id from public._internal_user_ids() iu))
  ),
  sizes as (
    select cohort_week, count(*)::int as cohort_size from cohorts group by cohort_week
  ),
  matrix as (
    select c.cohort_week, (a.day - c.cohort_week)::int as day_offset, count(distinct c.user_id)::int as active_n
      from cohorts c
      join public.user_active_day a on a.user_id = c.user_id
     where a.day >= c.cohort_week and a.day < c.cohort_week + p_window_days
     group by c.cohort_week, (a.day - c.cohort_week)
  )
  select m.cohort_week, m.day_offset, s.cohort_size, m.active_n,
         round(m.active_n::numeric / nullif(s.cohort_size, 0), 4) as active_pct
    from matrix m join sizes s using (cohort_week)
   order by m.cohort_week desc, m.day_offset asc;
end $function$;
revoke all on function public.admin_retention_cohorts(integer, boolean, boolean) from public;
grant execute on function public.admin_retention_cohorts(integer, boolean, boolean) to authenticated;

-- admin_top_users — GAP: previously had NO confirm filter. Add verified predicate.
drop function if exists public.admin_top_users(text, integer, boolean);
create or replace function public.admin_top_users(
  p_tier text DEFAULT NULL::text,
  p_limit integer DEFAULT 20,
  p_exclude_internal boolean DEFAULT true,
  p_verified_only boolean DEFAULT true)
 RETURNS TABLE(user_id uuid, email text, tier text, card_count bigint, board_count bigint, created_at timestamp with time zone, last_sign_in_at timestamp with time zone)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare v_t text := nullif(trim(coalesce(p_tier, '')), '');
begin
  perform public._require_admin();
  p_limit := greatest(1, least(p_limit, 100));
  return query
  select
    u.id                                    as user_id,
    u.email::text                           as email,
    coalesce(p.tier, 'demo')::text          as tier,
    coalesce(stats.card_count, 0)::bigint   as card_count,
    coalesce(stats.board_count, 0)::bigint  as board_count,
    u.created_at                            as created_at,
    u.last_sign_in_at                       as last_sign_in_at
  from auth.users u
  left join public.profiles p on p.user_id = u.id
  left join lateral (
    select
      (select count(*) from public.boards b where b.created_by = u.id) as board_count,
      (select count(*) from public.card_index ci
         join public.boards b on b.id = ci.board_id
         where b.created_by = u.id) as card_count
  ) stats on true
  where (v_t is null or coalesce(p.tier, 'demo') = v_t)
    and (not p_exclude_internal or u.id not in (select iu.user_id from public._internal_user_ids() iu))
    and (not p_verified_only or (u.email_confirmed_at is not null and u.last_sign_in_at is not null))
  order by stats.card_count desc nulls last
  limit p_limit;
end;
$function$;
revoke all on function public.admin_top_users(text, integer, boolean, boolean) from public;
grant execute on function public.admin_top_users(text, integer, boolean, boolean) to authenticated;

-- admin_avg_time_to_paid — GAP: add verified predicate (no-op in practice, paid
-- users are always verified, but keeps the definition consistent). Toggleable.
drop function if exists public.admin_avg_time_to_paid();
create or replace function public.admin_avg_time_to_paid(p_verified_only boolean default true)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_out jsonb;
begin
  perform public._require_admin();
  with conv as (
    select u.id as user_id, u.created_at as signed_up_at,
           min(ev.occurred_at) as first_paid_at
      from auth.users u
      join public.analytics_events ev
        on ev.user_id = u.id
       and (
         ev.event = 'inferred_first_paid'
      or (ev.event = 'tier_changed' and ev.props->>'to' = 'paid')
       )
     where (not p_verified_only or (u.email_confirmed_at is not null and u.last_sign_in_at is not null))
     group by u.id, u.created_at
  ),
  spans as (
    select extract(epoch from (first_paid_at - signed_up_at))::bigint as secs
      from conv
     where first_paid_at >= signed_up_at
  )
  select jsonb_build_object(
    'paid_users',     (select count(*) from spans),
    'avg_seconds',    (select coalesce(avg(secs), 0)::bigint from spans),
    'median_seconds', (select coalesce(
                              percentile_cont(0.5) within group (order by secs),
                              0)::bigint from spans)
  ) into v_out;
  return v_out;
end $$;
revoke all on function public.admin_avg_time_to_paid(boolean) from public;
grant execute on function public.admin_avg_time_to_paid(boolean) to authenticated;

------------------------------------------------------------------
-- A4. Daily metrics snapshot — tighten verified columns to verified + logged-in.
--     (No parallel *_all columns: trend history stays verified-only; no charted
--     history series is a user count, and metrics_daily is never backfilled.)
------------------------------------------------------------------
create or replace function public.capture_metrics_daily()
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  insert into public.metrics_daily (
    day, mrr_cents, total_users, paid_users, demo_users, waitlist_users,
    admin_users, signups, active_users, captured_at
  )
  select
    current_date,
    coalesce((
      select sum(coalesce(monthly_amount_cents,
               case when plan = 'monthly' then 2500
                    when plan = 'annual'  then 2000
                    else 0 end))::int
      from public.subscriptions where status in ('active', 'trialing')
    ), 0),
    (select count(*) from auth.users
       where email_confirmed_at is not null and last_sign_in_at is not null)::int,
    (select count(*) from public.profiles p join auth.users u on u.id = p.user_id
       where u.email_confirmed_at is not null and u.last_sign_in_at is not null and p.tier = 'paid')::int,
    (select count(*) from public.profiles p join auth.users u on u.id = p.user_id
       where u.email_confirmed_at is not null and u.last_sign_in_at is not null and p.tier = 'demo')::int,
    (select count(*) from public.profiles p join auth.users u on u.id = p.user_id
       where u.email_confirmed_at is not null and u.last_sign_in_at is not null and p.tier = 'waitlist')::int,
    (select count(*) from public.profiles p join auth.users u on u.id = p.user_id
       where u.email_confirmed_at is not null and u.last_sign_in_at is not null and p.tier = 'admin')::int,
    (select count(*) from auth.users
       where email_confirmed_at is not null and last_sign_in_at is not null and created_at >= current_date)::int,
    (select count(*) from public.user_presence where last_seen_at >= current_date)::int,
    now()
  on conflict (day) do update set
    mrr_cents      = excluded.mrr_cents,
    total_users    = excluded.total_users,
    paid_users     = excluded.paid_users,
    demo_users     = excluded.demo_users,
    waitlist_users = excluded.waitlist_users,
    admin_users    = excluded.admin_users,
    signups        = excluded.signups,
    active_users   = excluded.active_users,
    captured_at    = excluded.captured_at;
end $$;

------------------------------------------------------------------
-- A5. Live platform_counters.total_users — count VERIFIED + LOGGED-IN users.
--     The +1 happens when BOTH email_confirmed_at and last_sign_in_at are set
--     (for OTP these coincide on verifyOtp; the broadened trigger also catches a
--     later first-login after an out-of-band confirm). The nightly reconcile is
--     the safety net on hosted Supabase where auth.users triggers may not attach.
------------------------------------------------------------------

-- INSERT: only count rows that arrive already verified + logged-in (rare).
create or replace function public._counter_users_ins()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email_confirmed_at is not null and new.last_sign_in_at is not null then
    perform public._bump_counter('total_users', 1);
  end if;
  return new;
end $$;

-- DELETE: only un-count rows that were verified + logged-in.
create or replace function public._counter_users_del()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.email_confirmed_at is not null and old.last_sign_in_at is not null then
    perform public._bump_counter('total_users', -1);
  end if;
  return old;
end $$;

-- UPDATE: bump on the verified transition (the last of the two columns to flip).
create or replace function public._counter_users_confirm()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  old_v boolean := (old.email_confirmed_at is not null and old.last_sign_in_at is not null);
  new_v boolean := (new.email_confirmed_at is not null and new.last_sign_in_at is not null);
begin
  if not old_v and new_v then
    perform public._bump_counter('total_users', 1);
  elsif old_v and not new_v then
    perform public._bump_counter('total_users', -1);
  end if;
  return new;
end $$;

-- Broaden the trigger to fire on either column (privilege-safe, like 0074/0102).
do $$
begin
  drop trigger if exists users_counter_confirm on auth.users;
  create trigger users_counter_confirm
    after update of email_confirmed_at, last_sign_in_at on auth.users
    for each row execute function public._counter_users_confirm();
exception when insufficient_privilege then
  raise notice 'users_counter_confirm trigger skipped (insufficient privilege); nightly reconcile keeps total_users accurate';
end $$;

-- Snap the live counter to the new definition immediately.
update public.platform_counters
   set value = (select count(*) from auth.users
                  where email_confirmed_at is not null and last_sign_in_at is not null),
       updated_at = now()
 where key = 'total_users';

-- Nightly reconcile: count verified + logged-in users (rest unchanged).
create or replace function public._reconcile_universe_counters_full()
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  update public.platform_counters set value = (select count(*) from public.workspaces),                       updated_at = now() where key = 'total_workspaces';
  update public.platform_counters set value = (select count(*) from public.boards where deleted_at is null),  updated_at = now() where key = 'total_boards';
  update public.platform_counters set value = (select count(*) from public.card_index),                       updated_at = now() where key = 'total_cards';
  update public.platform_counters set value = (
    (select count(*) from public.entity_links) + (select count(*) from public.doc_backlinks)
  ), updated_at = now() where key = 'total_links';
  update public.platform_counters set value = (select count(*) from auth.users
                                                 where email_confirmed_at is not null and last_sign_in_at is not null),
                                       updated_at = now() where key = 'total_users';
  perform public._reconcile_universe_counters();
end $$;
