-- Four admin RPCs recomputed cards-held inline instead of calling the 0333
-- definition, and every copy diverged the same three ways: soft-deleted
-- clusters counted, keyed on boards.created_by rather than the workspace
-- owner, counting rows rather than summing weight. They now read
-- _owner_card_counts (0338), so /admin and the cap can no longer disagree.
--
-- admin_user_detail additionally stops reading profiles.demo_card_count -- a
-- counter that only moves while tier = 'demo' and that the 30-day purge never
-- decrements -- and gains the discarded_* and guest_* figures instead. 0340
-- drops that column.
--
-- Two board counts (admin_top_users, admin_tier_usage_compare) were missing a
-- deleted_at filter as well, one line from the card count. Fixed here too:
-- leaving them would have put a live card count next to a board count that
-- still included deleted clusters.
--
-- NOTE ON admin_user_count: the live body had drifted from 0192, the newest
-- migration that defines it -- the file and the database differed in code, not
-- just comments. This migration is written from the LIVE definition so the
-- drift is not silently reverted while fixing the counts. The other four
-- differed from their files only by stripped comments.

-- ------------------------------------------------------------------------
-- admin_list_users
-- ------------------------------------------------------------------------
create or replace function public.admin_list_users(
  p_limit integer default 50, p_offset integer default 0, p_query text default null,
  p_tier text default null, p_sort text default 'recent', p_status text default null,
  p_source text default null, p_contacted text default null,
  p_verification text default 'verified', p_activity text default 'all'
)
returns table(
  user_id uuid, email text, tier text, card_count integer, seconds_in_app bigint,
  created_at timestamptz, last_sign_in_at timestamptz, subscription_plan text,
  subscription_status text, current_period_end timestamptz, subscription_amount_cents integer,
  subscription_discounted boolean, banned boolean, joined_waitlist boolean,
  display_name text, avatar_url text, color text, last_seen_at timestamptz,
  board_count integer, acquisition_source text, last_reached_out_at timestamptz,
  outreach_count integer, email_confirmed boolean, storage_bytes bigint, country text,
  last_worked_at timestamptz
)
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_q text := nullif(trim(coalesce(p_query,     '')), '');
  v_t text := nullif(trim(coalesce(p_tier,      '')), '');
  v_s text := nullif(trim(coalesce(p_status,    '')), '');
  v_o text := nullif(trim(coalesce(p_source,    '')), '');
  v_c text := nullif(trim(coalesce(p_contacted, '')), '');
  v_k text := lower(coalesce(nullif(trim(p_sort), ''), 'recent'));
  v_v text := lower(coalesce(nullif(trim(p_verification), ''), 'verified'));
  v_a text := lower(coalesce(nullif(trim(p_activity), ''), 'all'));
begin
  perform public._require_admin();
  p_limit  := greatest(1, least(p_limit, 200));
  p_offset := greatest(0, p_offset);
  return query
  with owner_cards as (
    -- card-count-lint: activity
    -- Recency ONLY. The card count used to be computed here too, over every
    -- cluster including deleted ones, which is what made this row disagree
    -- with the cap; it now comes from _owner_card_counts (0338). This CTE
    -- stays deliberately unfiltered because "last made something" remains
    -- true even if the cluster it happened in has since been deleted.
    --
    -- The onb-% filter is on the RECENCY ONLY. Seeded onboarding cards are
    -- not the user's work, but card_count has always included them and
    -- _owner_card_counts.live_cards still does, so that figure keeps meaning
    -- exactly what it meant.
    select b.created_by as uid,
           max(ci.updated_at) filter (where ci.card_id not like 'onb-%') as last_card_at
    from public.card_index ci join public.boards b on b.id = ci.board_id
    group by b.created_by
  ),
  owner_counts as (
    select c.user_id as uid, c.live_cards from public._owner_card_counts c
  ),
  owner_boards as (
    select b.created_by as uid, count(*)::int as board_count
    from public.boards b where b.created_by is not null and b.deleted_at is null
    group by b.created_by
  ),
  owner_storage as (
    select w.created_by as uid, coalesce(sum(i.size_bytes), 0)::bigint as bytes
    from public.images i join public.workspaces w on w.id = i.workspace_id
    where i.deleted_at is null group by w.created_by
  ),
  work_ev as (
    -- Work that never touches a card: doc edits, comments, tags, arrows.
    select e.user_id as uid, max(e.occurred_at) as last_ev_at
    from public.analytics_events e
    where e.user_id is not null
      and e.event in ('card_placed','card_edit','doc_edit','comment_create',
                      'arrow_created','remix_clone','tag_manual_apply','tag_confirm')
      and coalesce(e.props->>'synthetic', '') <> 'true'
    group by e.user_id
  ),
  base as (
    select
      u.id as user_id, u.email::text as email, coalesce(p.tier, 'demo')::text as tier,
      coalesce(occ.live_cards, 0)::int as card_count,
      coalesce(p.seconds_in_app, 0)::bigint as seconds_in_app,
      u.created_at as created_at, u.last_sign_in_at as last_sign_in_at,
      s.plan::text as subscription_plan, s.status::text as subscription_status,
      s.current_period_end as current_period_end, s.monthly_amount_cents as subscription_amount_cents,
      (s.discount is not null) as subscription_discounted, (p.banned_at is not null) as banned,
      -- `we2`, not `we`: the new work_ev join below takes `we`, and reusing it
      -- here would shadow it inside this subquery — legal, and exactly the kind
      -- of thing that reads fine and means something else.
      exists (select 1 from public.waitlist_entries we2 where lower(we2.email) = lower(u.email)) as joined_waitlist,
      nullif(p.display_name, '') as display_name, nullif(p.avatar_url, '') as avatar_url,
      nullif(p.color, '') as color, pr.last_seen_at as last_seen_at,
      coalesce(ob.board_count, 0)::int as board_count,
      public.derive_acquisition_channel(p.first_source) as acquisition_source,
      ox.last_reached_out_at as last_reached_out_at, coalesce(ox.outreach_count, 0)::int as outreach_count,
      (u.email_confirmed_at is not null) as email_confirmed, coalesce(ostor.bytes, 0)::bigint as storage_bytes,
      nullif(p.country, '') as country,
      -- greatest() ignores NULLs in Postgres, so a user with only one of the
      -- two sources still gets a real answer instead of null.
      greatest(oc.last_card_at, we.last_ev_at) as last_worked_at
    from auth.users u
    left join public.profiles p on p.user_id = u.id
    left join public.subscriptions s on s.user_id = u.id
    left join public.user_presence pr on pr.user_id = u.id
    left join owner_cards oc on oc.uid = u.id
    left join owner_counts occ on occ.uid = u.id
    left join owner_boards ob on ob.uid = u.id
    left join owner_storage ostor on ostor.uid = u.id
    left join work_ev we on we.uid = u.id
    left join lateral (
      select max(o.reached_at) as last_reached_out_at, count(*)::int as outreach_count
      from public.user_outreach o where o.user_id = u.id or lower(o.email) = lower(u.email)
    ) ox on true
    where (case v_v
             when 'verified'   then (u.email_confirmed_at is not null and u.last_sign_in_at is not null)
             when 'unverified' then (u.email_confirmed_at is null     or  u.last_sign_in_at is null)
             else true end)
      and (v_q is null or u.email ilike '%' || v_q || '%')
      and (v_t is null or coalesce(p.tier, 'demo') = v_t)
      and (v_s is null or s.status = v_s)
  )
  select * from base
  where (v_o is null or base.acquisition_source = v_o)
    and (v_c is null
         or (v_c = 'yes' and base.last_reached_out_at is not null)
         or (v_c = 'no'  and base.last_reached_out_at is null))
    and (case v_a
           when 'active'   then (base.card_count > 0 or base.board_count > 0)
           when 'inactive' then (base.card_count = 0 and base.board_count = 0)
           else true end)
  order by
    case when v_k = 'recent' then base.created_at end desc nulls last,
    case when v_k = 'active' then base.last_seen_at end desc nulls last,
    -- NEW: sort by when they last actually made something.
    case when v_k = 'worked' then base.last_worked_at end desc nulls last,
    case when v_k = 'cards'  then base.card_count end desc nulls last,
    case when v_k = 'spend'  then base.subscription_amount_cents end desc nulls last,
    case when v_k = 'name'   then lower(coalesce(base.display_name, base.email)) end asc nulls last,
    base.created_at desc nulls last
  limit p_limit offset p_offset;
end $$;

-- ------------------------------------------------------------------------
-- admin_user_count
-- ------------------------------------------------------------------------
create or replace function public.admin_user_count(
  p_query text default null, p_tier text default null, p_status text default null,
  p_source text default null, p_contacted text default null,
  p_verification text default 'verified', p_activity text default 'all')
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
  v_a text := lower(coalesce(nullif(trim(p_activity), ''), 'all'));
  v_n bigint;
begin
  perform public._require_admin();
  with base as (
    select public.derive_acquisition_channel(p.first_source) as acquisition_source
    from auth.users u
    left join public.profiles p on p.user_id = u.id
    left join public.subscriptions s on s.user_id = u.id
    where (case v_v
             when 'verified'   then (u.email_confirmed_at is not null and u.last_sign_in_at is not null)
             when 'unverified' then (u.email_confirmed_at is null     or  u.last_sign_in_at is null)
             else true end)
      and (v_q is null or u.email ilike '%' || v_q || '%')
      and (v_t is null or coalesce(p.tier, 'demo') = v_t)
      and (v_s is null or s.status = v_s)
      and (v_c is null
           or (v_c = 'yes' and     exists (select 1 from public.user_outreach o where o.user_id = u.id or lower(o.email) = lower(u.email)))
           or (v_c = 'no'  and not exists (select 1 from public.user_outreach o where o.user_id = u.id or lower(o.email) = lower(u.email))))
      -- Cards held now, not cards ever indexed. An account whose every cluster
      -- is deleted counted as active here while /admin's own list said the
      -- same thing from the same broken predicate.
      and (case v_a
             when 'active' then (
                   exists (select 1 from public._owner_card_counts c where c.user_id = u.id and c.live_cards > 0)
               or  exists (select 1 from public.boards b where b.created_by = u.id and b.deleted_at is null))
             when 'inactive' then (
                   not exists (select 1 from public._owner_card_counts c where c.user_id = u.id and c.live_cards > 0)
               and not exists (select 1 from public.boards b where b.created_by = u.id and b.deleted_at is null))
             else true end)
  )
  select count(*) into v_n from base where (v_o is null or base.acquisition_source = v_o);
  return v_n;
end $function$;

-- ------------------------------------------------------------------------
-- admin_top_users
-- ------------------------------------------------------------------------
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
      (select count(*) from public.boards b
        where b.created_by = u.id and b.deleted_at is null) as board_count,
      (select coalesce(c.live_cards, 0) from public._owner_card_counts c
        where c.user_id = u.id) as card_count
  ) stats on true
  where (v_t is null or coalesce(p.tier, 'demo') = v_t)
    and (not p_exclude_internal or u.id not in (select iu.user_id from public._internal_user_ids() iu))
    and (not p_verified_only or (u.email_confirmed_at is not null and u.last_sign_in_at is not null))
  order by stats.card_count desc nulls last
  limit p_limit;
end;
$function$;

-- ------------------------------------------------------------------------
-- admin_tier_usage_compare
-- ------------------------------------------------------------------------
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
      coalesce((select count(*) from public.boards b
                 where b.created_by = u.id and b.deleted_at is null), 0)::bigint as board_count,
      coalesce((select c.live_cards from public._owner_card_counts c
                 where c.user_id = u.id), 0)::bigint as card_count
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

-- ------------------------------------------------------------------------
-- admin_user_detail
-- ------------------------------------------------------------------------
create or replace function public.admin_user_detail(p_user_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public as $$
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
      'share',         sh.info,
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
      'card_count',         coalesce(occ.live_cards, 0),
      'discarded_cards',    coalesce(occ.discarded_cards, 0),
      'discarded_clusters', coalesce(occ.discarded_clusters, 0),
      'guest_cards',        coalesce(occ.guest_cards, 0),
      'guest_clusters',     coalesce(occ.guest_clusters, 0),
      'guest_workspaces',   coalesce(occ.guest_workspaces, 0),
      'board_count',     coalesce(ob.board_count, 0),
      'demo_card_cap',   (coalesce(p.card_cap_base, 50) + coalesce(p.bonus_card_credits, 0)),
      'card_cap_base',   coalesce(p.card_cap_base, 50),
      'bonus_card_credits',   coalesce(p.bonus_card_credits, 0),
      'effective_card_limit', (coalesce(p.card_cap_base, 50) + coalesce(p.bonus_card_credits, 0)),
      'storage', jsonb_build_object(
        'used_bytes',  coalesce(st.used_bytes, 0),
        'quota_bytes', public._storage_quota_bytes(),
        'image_count', coalesce(st.image_count, 0)
      )
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
    'geo', jsonb_build_object(
      'signup_country', nullif(p.signup_country, ''),
      'country',        nullif(p.country, ''),
      'breakdown', coalesce((
        select jsonb_agg(jsonb_build_object('country', g.cc, 'events', g.n) order by g.n desc)
        from (
          select e.country as cc, count(*)::int as n
          from public.analytics_events e
          where e.user_id = u.id and nullif(e.country, '') is not null
          group by 1
        ) g
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
  left join public._owner_card_counts occ on occ.user_id = u.id
  left join lateral (
    select count(*)::int as board_count
    from public.boards b
    where b.created_by = u.id and b.deleted_at is null
  ) ob on true
  left join lateral (
    select coalesce(sum(i.size_bytes), 0)::bigint as used_bytes, count(*)::bigint as image_count
    from public.images i
    join public.workspaces w on w.id = i.workspace_id
    where w.created_by = u.id and i.deleted_at is null
  ) st on true
  left join lateral (
    select case
      when nullif(p.first_source->>'share_token','') is not null then (
        select jsonb_build_object(
          'kind',            'share_link',
          'token',           p.first_source->>'share_token',
          'board_id',        psl.board_id,
          'board_title',     b2.name,
          'shared_by_email', su.email::text,
          'link_kind',       psl.kind,
          'link_role',       psl.role,
          'link_created_at', psl.created_at,
          'link_revoked_at', psl.revoked_at,
          'cohort_signups',  (select count(*) from public.profiles p2
                               where p2.first_source->>'share_token' = p.first_source->>'share_token')
        )
        from public.public_share_links psl
        left join public.boards b2 on b2.id = psl.board_id
        left join auth.users su on su.id = psl.created_by
        where psl.token::text = p.first_source->>'share_token'
        limit 1
      )
      when nullif(p.first_source->>'public_slug','') is not null then (
        select jsonb_build_object(
          'kind',            'public_board',
          'slug',            p.first_source->>'public_slug',
          'board_id',        pb.board_id,
          'board_title',     b3.name,
          'shared_by_email', su2.email::text,
          'cohort_signups',  (select count(*) from public.profiles p3
                               where p3.first_source->>'public_slug' = p.first_source->>'public_slug')
        )
        from public.public_boards pb
        left join public.boards b3 on b3.id = pb.board_id
        left join auth.users su2 on su2.id = pb.created_by
        where pb.slug = p.first_source->>'public_slug'
        limit 1
      )
      else null
    end as info
  ) sh on true
  left join lateral (
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
end $$;

-- create or replace preserves a function's ACL (unlike drop+create, which
-- discards it), but a REVOKE or a preserved grant reporting success proves
-- nothing. Assert the 0311 posture explicitly: admin RPCs are callable by
-- authenticated (they gate internally on _require_admin) and never by anon.
do $$
declare
  v_bad text;
begin
  select string_agg(format('%s(%s)', p.proname, pg_get_function_identity_arguments(p.oid)), ', ')
    into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('admin_list_users', 'admin_user_count', 'admin_top_users',
                       'admin_tier_usage_compare', 'admin_user_detail')
     and (has_function_privilege('anon', p.oid, 'EXECUTE')
          or not has_function_privilege('authenticated', p.oid, 'EXECUTE')
          or not has_function_privilege('service_role', p.oid, 'EXECUTE'));
  if v_bad is not null then
    raise exception 'admin RPC grants are wrong on: %', v_bad;
  end if;
end $$;
