-- 0117_admin_users_redesign.sql
--
-- Powers the two-pane master–detail Users tab. Three changes:
--
--   A. admin_list_users — LEAN per-row enrichment for the compact left list:
--      display_name / avatar_url / color (identity chip), last_seen_at
--      (presence dot), board_count, and a derived acquisition_source badge.
--      Adds optional p_sort / p_status / p_source params (backward-compatible
--      defaults). Existing 14 return columns are preserved IN ORDER and the new
--      ones appended, so the current AdminUsersTab keeps working during rollout.
--
--   B. admin_user_count — gains the same p_status / p_source filters so paging
--      totals match the filtered list.
--
--   C. admin_user_detail(uuid) — one rich JSONB for the right detail panel:
--      identity, acquisition (first_source broken out), activation timeline,
--      engagement, billing (subscription), grants (active + historical).
--
-- Return-shape changes → DROP + CREATE (same pattern as 0099 / 0108). The old
-- 4-arg admin_list_users / 2-arg admin_user_count overloads are dropped first so
-- PostgREST doesn't see ambiguous overloads.
--
-- Verified against LIVE schema (project ehlhlmbpwwalmeisvmdp): all referenced
-- columns exist. Drift handled: subscriptions has NO trial_end (trialing is
-- derived from status); first_source.fbc is absent in prod (read opportunistically
-- → null). Card count stays LIVE (card_index ⋈ boards), not demo_card_count.

------------------------------------------------------------------
-- A. admin_list_users — enriched + sortable/filterable
------------------------------------------------------------------
drop function if exists public.admin_list_users(integer, integer, text, text);

create function public.admin_list_users(
  p_limit  integer default 50,
  p_offset integer default 0,
  p_query  text    default null,
  p_tier   text    default null,
  p_sort   text    default 'recent',
  p_status text    default null,
  p_source text    default null
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
  -- new lean enrichment, appended:
  display_name              text,
  avatar_url                text,
  color                     text,
  last_seen_at              timestamptz,
  board_count               integer,
  acquisition_source        text
)
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_q text := nullif(trim(coalesce(p_query,  '')), '');
  v_t text := nullif(trim(coalesce(p_tier,   '')), '');
  v_s text := nullif(trim(coalesce(p_status, '')), '');
  v_o text := nullif(trim(coalesce(p_source, '')), '');
  v_k text := lower(coalesce(nullif(trim(p_sort), ''), 'recent'));
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
      -- derived compact acquisition label
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
      end                                        as acquisition_source
    from auth.users u
    left join public.profiles      p  on p.user_id  = u.id
    left join public.subscriptions s  on s.user_id  = u.id
    left join public.user_presence pr on pr.user_id = u.id
    left join owner_cards          oc on oc.uid     = u.id
    left join owner_boards         ob on ob.uid     = u.id
    where u.email_confirmed_at is not null
      and (v_q is null or u.email ilike '%' || v_q || '%')
      and (v_t is null or coalesce(p.tier, 'demo') = v_t)
      and (v_s is null or s.status = v_s)
  )
  select * from base
  where (v_o is null or base.acquisition_source = v_o)
  order by
    case when v_k = 'recent' then base.created_at end desc nulls last,
    case when v_k = 'active' then base.last_seen_at end desc nulls last,
    case when v_k = 'cards'  then base.card_count end desc nulls last,
    case when v_k = 'spend'  then base.subscription_amount_cents end desc nulls last,
    case when v_k = 'name'   then lower(coalesce(base.display_name, base.email)) end asc nulls last,
    base.created_at desc nulls last            -- stable tiebreaker / default
  limit p_limit
  offset p_offset;
end $$;

revoke all on function public.admin_list_users(int, int, text, text, text, text, text) from public;
grant execute on function public.admin_list_users(int, int, text, text, text, text, text) to authenticated;

------------------------------------------------------------------
-- B. admin_user_count — matching status/source filters
------------------------------------------------------------------
drop function if exists public.admin_user_count(text, text);

create function public.admin_user_count(
  p_query  text default null,
  p_tier   text default null,
  p_status text default null,
  p_source text default null
)
returns bigint language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_q text := nullif(trim(coalesce(p_query,  '')), '');
  v_t text := nullif(trim(coalesce(p_tier,   '')), '');
  v_s text := nullif(trim(coalesce(p_status, '')), '');
  v_o text := nullif(trim(coalesce(p_source, '')), '');
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
    where u.email_confirmed_at is not null
      and (v_q is null or u.email ilike '%' || v_q || '%')
      and (v_t is null or coalesce(p.tier, 'demo') = v_t)
      and (v_s is null or s.status = v_s)
  )
  select count(*) into v_n from base
  where (v_o is null or base.acquisition_source = v_o);

  return v_n;
end $$;

revoke all on function public.admin_user_count(text, text, text, text) from public;
grant execute on function public.admin_user_count(text, text, text, text) to authenticated;

------------------------------------------------------------------
-- C. admin_user_detail(uuid) — rich detail panel payload
------------------------------------------------------------------
create or replace function public.admin_user_detail(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
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
      'fbc',          nullif(p.first_source->>'fbc', ''),   -- absent in prod → null
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
      'demo_card_cap',   100   -- demo cap context (server-enforced limit)
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
        case when g.revoked_at is null then 0 else 1 end asc,  -- active first
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
end $$;

revoke all on function public.admin_user_detail(uuid) from public;
grant execute on function public.admin_user_detail(uuid) to authenticated;
