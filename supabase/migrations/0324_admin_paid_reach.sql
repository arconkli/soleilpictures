-- 0324 — paid reach: who has actually been shown a price, by how much they built.
--
-- The question the monetization read could not answer from the deck: of the
-- people who built a real board, how many were ever shown what Creator costs?
-- The answer from the raw table was that more accounts with fewer than six
-- cards had seen a price than everyone with thirteen or more combined, and a
-- third of the accounts within reach of the wall had never seen one. That is
-- the number to grade the reach change on, weekly, and it needs a home.
--
-- Bands are by LIVE cards today (card_index joined through live boards — the
-- profile counter drifts), relative to the caller's own cap where the band is
-- about the wall. Columns are DISTINCT USERS, never events:
--   saw_price   any pricing_view (a modal or a page with a number on it)
--   price_seen  the once-per-account price_seen stamp from the ambient
--               surfaces (chip pill, banner, near-cap toast) — new with this
--               deploy, so it lags saw_price until the base ages
--   saw_wall    the cap-hit modal specifically
--   saw_banner  the first-value banner (carries a price from this deploy on)
--   saw_toast   the approaching-limit toast
--   clicked     up_chip_click or up_settings_upgrade_click
--   blocked     a server_cap / demo_cap refusal
--   intent      pricing_creator_intent — the buy button
--
-- p_since bounds SIGNUP date (auth.users.created_at), so the read is a cohort,
-- not a window over events: "of the people who joined since X, how many have
-- ever seen a price". Default is the day the waitlist came off.

create or replace function public.admin_paid_reach(
  p_since date default '2026-06-16',
  p_exclude_internal boolean default true
)
returns table (
  band text,
  band_order int,
  users bigint,
  saw_price bigint,
  price_seen bigint,
  saw_wall bigint,
  saw_banner bigint,
  saw_toast bigint,
  clicked bigint,
  blocked bigint,
  intent bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return query
  with ext as (
    select p.user_id,
           p.card_cap_base + coalesce(p.bonus_card_credits, 0) as cap
      from public.profiles p
      join auth.users u on u.id = p.user_id
     where u.created_at >= p_since
       and p.tier = 'demo'
       and not coalesce(p.is_service, false)
       and (not p_exclude_internal or p.user_id not in (select _internal_user_ids()))
  ),
  ci as (
    select b.created_by as user_id, count(*)::int as cards
      from public.card_index c
      join public.boards b on b.id = c.board_id
     where b.deleted_at is null
     group by 1
  ),
  ev as (
    select e.user_id,
           bool_or(e.event = 'pricing_view')                                            as saw_price,
           bool_or(e.event = 'price_seen')                                              as price_seen,
           bool_or(e.event = 'pricing_view' and e.props->>'header' = 'cap-hit')       as saw_wall,
           bool_or(e.event = 'first_value_upgrade_view')                               as saw_banner,
           bool_or(e.event = 'up_cap_toast_view')                                      as saw_toast,
           bool_or(e.event in ('up_chip_click', 'up_settings_upgrade_click'))          as clicked,
           bool_or(e.event = 'card_create_blocked'
                   and e.props->>'reason' in ('server_cap', 'demo_cap'))               as blocked,
           bool_or(e.event = 'pricing_creator_intent')                                 as intent
      from public.analytics_events e
     where e.user_id is not null
       and e.event in ('pricing_view', 'price_seen', 'first_value_upgrade_view', 'up_cap_toast_view',
                       'up_chip_click', 'up_settings_upgrade_click', 'card_create_blocked',
                       'pricing_creator_intent')
     group by 1
  ),
  banded as (
    select e.user_id,
           case when coalesce(ci.cards, 0) >= 0.8 * e.cap then 'At or near the cap (≥80%)'
                when coalesce(ci.cards, 0) >= 30 then '30+ cards'
                when coalesce(ci.cards, 0) >= 13 then '13–29 cards'
                when coalesce(ci.cards, 0) >= 6  then '6–12 cards'
                else 'Under 6 cards' end as band,
           case when coalesce(ci.cards, 0) >= 0.8 * e.cap then 1
                when coalesce(ci.cards, 0) >= 30 then 2
                when coalesce(ci.cards, 0) >= 13 then 3
                when coalesce(ci.cards, 0) >= 6  then 4
                else 5 end as band_order,
           v.*
      from ext e
      left join ci on ci.user_id = e.user_id
      left join ev v on v.user_id = e.user_id
  )
  select b.band, b.band_order,
         count(*)::bigint,
         count(*) filter (where b.saw_price)::bigint,
         count(*) filter (where b.price_seen)::bigint,
         count(*) filter (where b.saw_wall)::bigint,
         count(*) filter (where b.saw_banner)::bigint,
         count(*) filter (where b.saw_toast)::bigint,
         count(*) filter (where b.clicked)::bigint,
         count(*) filter (where b.blocked)::bigint,
         count(*) filter (where b.intent)::bigint
    from banded b
   group by b.band, b.band_order
   order by b.band_order;
end;
$$;

revoke all on function public.admin_paid_reach(date, boolean) from public, anon;
grant execute on function public.admin_paid_reach(date, boolean) to authenticated, service_role;

comment on function public.admin_paid_reach(date, boolean) is
  'Admin. Of demo accounts that signed up since p_since, by live-card band: how many '
  'were ever shown a price (pricing_view, price_seen), the wall, the banner, the toast; '
  'how many clicked an upgrade entry, were cap-blocked, or clicked Get Creator. Distinct '
  'users per column. The reach read the price-visibility change is graded on.';

-- The 0311 habit: prove the grants rather than trust the REVOKE.
do $$
begin
  if has_function_privilege('anon', 'public.admin_paid_reach(date, boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.admin_paid_reach(date, boolean)', 'execute')
     or not has_function_privilege('service_role', 'public.admin_paid_reach(date, boolean)', 'execute') then
    raise exception '0324: admin_paid_reach grants are wrong';
  end if;
end $$;
