-- 0192_admin_activity_filter.sql
-- Admin Users tab: hide zero-activity "junk" accounts by default.
--
-- Instant-entry auth marks EVERY signup email_confirmed + signed-in, so the
-- "verified" filter (email_confirmed_at not null AND last_sign_in_at not null)
-- does NOT catch undeliverable/junk emails (e.g. andrew@andrewconklin.om). The
-- reliable signal is ACTIVITY: junk accounts have 0 owned cards AND 0 owned
-- boards. Add a p_activity filter to admin_list_users + admin_user_count.
--
--   p_activity = 'active'   -> card_count > 0 OR board_count > 0
--                'inactive' -> card_count = 0 AND board_count = 0
--                'all'/null -> no activity filter (DEFAULT; preserves old
--                              behavior for admin_overview + positional callers)
--
-- Drift-aware: bodies reproduce the LIVE prod definitions verbatim (introspected
-- via pg_get_functiondef) with only the additive p_activity change. Adding a
-- parameter creates a NEW overload, so we DROP the old signatures first (mirrors
-- 0164) to avoid PostgREST overload ambiguity (PGRST203), then re-grant on the
-- new signatures.

-- ── A. admin_list_users  (+ p_activity as the LAST param) ────────────────────
drop function if exists public.admin_list_users(integer, integer, text, text, text, text, text, text, text);

create or replace function public.admin_list_users(
  p_limit integer default 50, p_offset integer default 0, p_query text default null,
  p_tier text default null, p_sort text default 'recent', p_status text default null,
  p_source text default null, p_contacted text default null, p_verification text default 'verified',
  p_activity text default 'all')
returns table(
  user_id uuid, email text, tier text, card_count integer, seconds_in_app bigint,
  created_at timestamptz, last_sign_in_at timestamptz,
  subscription_plan text, subscription_status text, current_period_end timestamptz,
  subscription_amount_cents integer, subscription_discounted boolean, banned boolean,
  joined_waitlist boolean, display_name text, avatar_url text, color text,
  last_seen_at timestamptz, board_count integer, acquisition_source text,
  last_reached_out_at timestamptz, outreach_count integer, email_confirmed boolean,
  storage_bytes bigint)
language plpgsql stable security definer set search_path to 'public'
as $function$
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
  owner_storage as (
    select w.created_by as uid, coalesce(sum(i.size_bytes), 0)::bigint as bytes
    from public.images i
    join public.workspaces w on w.id = i.workspace_id
    where i.deleted_at is null
    group by w.created_by
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
      (u.email_confirmed_at is not null)          as email_confirmed,
      coalesce(ostor.bytes, 0)::bigint            as storage_bytes
    from auth.users u
    left join public.profiles      p  on p.user_id  = u.id
    left join public.subscriptions s  on s.user_id  = u.id
    left join public.user_presence pr on pr.user_id = u.id
    left join owner_cards          oc on oc.uid     = u.id
    left join owner_boards         ob on ob.uid     = u.id
    left join owner_storage        ostor on ostor.uid = u.id
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
    and (case v_a
           when 'active'   then (base.card_count > 0 or base.board_count > 0)
           when 'inactive' then (base.card_count = 0 and base.board_count = 0)
           else true
         end)
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

revoke all on function public.admin_list_users(integer, integer, text, text, text, text, text, text, text, text) from public;
grant execute on function public.admin_list_users(integer, integer, text, text, text, text, text, text, text, text) to anon, authenticated, service_role;

-- ── B. admin_user_count  (+ p_activity via EXISTS, consistent with the list) ─
--    The list's card_count (owner_cards) does NOT filter boards.deleted_at,
--    while board_count (owner_boards) DOES. The EXISTS below mirror that exactly
--    so list rows and the total agree.
drop function if exists public.admin_user_count(text, text, text, text, text, text);

create or replace function public.admin_user_count(
  p_query text default null, p_tier text default null, p_status text default null,
  p_source text default null, p_contacted text default null, p_verification text default 'verified',
  p_activity text default 'all')
returns bigint language plpgsql stable security definer set search_path to 'public'
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
      and (case v_a
             when 'active' then (
                   exists (select 1 from public.card_index ci join public.boards b on b.id = ci.board_id where b.created_by = u.id)
               or  exists (select 1 from public.boards b where b.created_by = u.id and b.deleted_at is null))
             when 'inactive' then (
                   not exists (select 1 from public.card_index ci join public.boards b on b.id = ci.board_id where b.created_by = u.id)
               and not exists (select 1 from public.boards b where b.created_by = u.id and b.deleted_at is null))
             else true
           end)
  )
  select count(*) into v_n from base
  where (v_o is null or base.acquisition_source = v_o);

  return v_n;
end $function$;

revoke all on function public.admin_user_count(text, text, text, text, text, text, text) from public;
grant execute on function public.admin_user_count(text, text, text, text, text, text, text) to anon, authenticated, service_role;
