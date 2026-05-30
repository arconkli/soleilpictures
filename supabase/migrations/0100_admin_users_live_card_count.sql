------------------------------------------------------------------
-- 0100_admin_users_live_card_count
--
-- The admin Users table "Cards" column showed profiles.demo_card_count, a
-- cached counter that bump_demo_card_count_trg (migration 0065) maintains
-- ONLY for demo-tier users. Admin/paid users' counts froze at their one-time
-- backfill value and never grew, so the column badly undercounted them and
-- didn't reconcile with the universe total_cards stat (e.g. an admin showing
-- 162 actually owned 422 cards).
--
-- Recompute the column LIVE from card_index by board ownership
-- (boards.created_by) so it's accurate for every tier and sums to the
-- universe total. No deleted_at filter — count raw card_index rows so the
-- per-user breakdown partitions the same set the universe counter does.
--
-- The demo-cap counter (profiles.demo_card_count) and its trigger are left
-- untouched: that's a separate concern, correctly maintained for demo users
-- and consumed only by the demo cap logic (my_tier RPC / useMyTier.js).
--
-- Output column renamed demo_card_count -> card_count. The only client
-- consumer is AdminUsersTab.jsx (updated alongside this migration).
------------------------------------------------------------------

drop function if exists public.admin_list_users(integer, integer, text, text);
create function public.admin_list_users(
  p_limit  int default 50,
  p_offset int default 0,
  p_query  text default null,
  p_tier   text default null
)
returns table(
  user_id                  uuid,
  email                    text,
  tier                     text,
  card_count               int,
  seconds_in_app           bigint,
  created_at               timestamptz,
  last_sign_in_at          timestamptz,
  subscription_plan        text,
  subscription_status      text,
  current_period_end       timestamptz,
  subscription_amount_cents int,
  subscription_discounted  boolean,
  banned                   boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_q text := nullif(trim(coalesce(p_query, '')), '');
  v_t text := nullif(trim(coalesce(p_tier,  '')), '');
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
  )
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
    (p.banned_at is not null)                  as banned
  from auth.users u
  left join public.profiles      p on p.user_id = u.id
  left join public.subscriptions s on s.user_id = u.id
  left join owner_cards          oc on oc.uid   = u.id
  where (v_q is null or u.email ilike '%' || v_q || '%')
    and (v_t is null or coalesce(p.tier, 'demo') = v_t)
  order by u.created_at desc nulls last
  limit p_limit
  offset p_offset;
end $$;
revoke all on function public.admin_list_users(int, int, text, text) from public;
grant execute on function public.admin_list_users(int, int, text, text) to authenticated;
