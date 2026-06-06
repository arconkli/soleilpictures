-- 0121_device_tracking.sql
--
-- Device-type analytics. The client now stamps device_type / os / browser
-- (parsed categories, never raw user-agent) into analytics_events.props on every
-- event (see boards/src/lib/device.js + analytics.js buildRow). This adds:
--   1. admin_device_breakdown — aggregate device/os/browser by sessions + users.
--   2. admin_user_detail.device — per-user most-recent device + breakdown.
-- Forward-looking: events predating this have no device props and bucket as
-- 'unknown'. Conventions mirror 0117/0110 (_require_admin, internal exclusion).

------------------------------------------------------------------
-- 1. admin_device_breakdown(p_days, p_exclude_internal)
------------------------------------------------------------------
create or replace function public.admin_device_breakdown(
  p_days integer default 30, p_exclude_internal boolean default true
)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v_out jsonb;
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 36500));
  with ev as (
    select e.session_id, e.user_id,
           coalesce(nullif(e.props->>'device_type', ''), 'unknown') as device_type,
           coalesce(nullif(e.props->>'os', ''),          'unknown') as os,
           coalesce(nullif(e.props->>'browser', ''),     'unknown') as browser
      from public.analytics_events e
     where e.occurred_at >= now() - (p_days || ' days')::interval
       and (not p_exclude_internal
            or e.session_id is null
            or e.session_id not in (select isess.session_id from public._internal_session_ids() isess))
  ),
  dt as (
    select device_type as value, count(distinct session_id)::int as sessions, count(distinct user_id)::int as users
      from ev group by device_type
  ),
  os_ as (
    select os as value, count(distinct session_id)::int as sessions, count(distinct user_id)::int as users
      from ev group by os
  ),
  br as (
    select browser as value, count(distinct session_id)::int as sessions, count(distinct user_id)::int as users
      from ev group by browser
  )
  select jsonb_build_object(
    'by_device_type', coalesce((select jsonb_agg(jsonb_build_object('value', value, 'sessions', sessions, 'users', users) order by sessions desc) from dt),  '[]'::jsonb),
    'by_os',          coalesce((select jsonb_agg(jsonb_build_object('value', value, 'sessions', sessions, 'users', users) order by sessions desc) from os_), '[]'::jsonb),
    'by_browser',     coalesce((select jsonb_agg(jsonb_build_object('value', value, 'sessions', sessions, 'users', users) order by sessions desc) from br),  '[]'::jsonb)
  ) into v_out;
  return v_out;
end $function$;
revoke all on function public.admin_device_breakdown(integer, boolean) from public;
grant execute on function public.admin_device_breakdown(integer, boolean) to authenticated;

------------------------------------------------------------------
-- 2. admin_user_detail — add a `device` key (most-recent + breakdown).
--    Full CREATE OR REPLACE of the 0117 function with one added top-level key.
------------------------------------------------------------------
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
      'banned',      (p.banned_at is not null),
      'is_internal', exists (select 1 from public._internal_user_ids() iu(id) where iu.id = u.id)
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
  where u.id = p_user_id
    and u.email_confirmed_at is not null;

  if v_out is null then
    raise exception 'user not found or not verified: %', p_user_id using errcode = 'P0002';
  end if;

  return v_out;
end $function$;
revoke all on function public.admin_user_detail(uuid) from public;
grant execute on function public.admin_user_detail(uuid) to authenticated;
