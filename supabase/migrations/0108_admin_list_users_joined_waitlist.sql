------------------------------------------------------------------
-- 0108_admin_list_users_joined_waitlist
--
-- Surface, in the admin Users list, whether each account ever actually
-- submitted the waitlist form. signInWithOtp creates an account (default
-- tier 'waitlist') the moment someone verifies their email — even if they
-- never filled out the waitlist form and just fell off. Those "ghost"
-- signups were indistinguishable from real waitlist members in the admin UI.
--
-- Adds a `joined_waitlist boolean` to admin_list_users: true iff a
-- public.waitlist_entries row exists for the user's email (that table links
-- by email only — no user_id FK — so we match on lower(email)). The
-- RETURNS TABLE shape changes, so DROP + CREATE (same pattern as 0099).
-- Body is otherwise identical to 0102's live definition.
------------------------------------------------------------------

drop function if exists public.admin_list_users(integer, integer, text, text);

create function public.admin_list_users(
  p_limit integer default 50, p_offset integer default 0,
  p_query text default null, p_tier text default null)
returns table(user_id uuid, email text, tier text, card_count integer,
  seconds_in_app bigint, created_at timestamptz, last_sign_in_at timestamptz,
  subscription_plan text, subscription_status text, current_period_end timestamptz,
  subscription_amount_cents integer, subscription_discounted boolean, banned boolean,
  joined_waitlist boolean)
language plpgsql stable security definer set search_path to 'public' as $$
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
    (p.banned_at is not null)                  as banned,
    exists (select 1 from public.waitlist_entries we
            where lower(we.email) = lower(u.email)) as joined_waitlist
  from auth.users u
  left join public.profiles      p on p.user_id = u.id
  left join public.subscriptions s on s.user_id = u.id
  left join owner_cards          oc on oc.uid   = u.id
  where u.email_confirmed_at is not null
    and (v_q is null or u.email ilike '%' || v_q || '%')
    and (v_t is null or coalesce(p.tier, 'demo') = v_t)
  order by u.created_at desc nulls last
  limit p_limit
  offset p_offset;
end $$;

revoke all on function public.admin_list_users(int, int, text, text) from public;
grant execute on function public.admin_list_users(int, int, text, text) to authenticated;
