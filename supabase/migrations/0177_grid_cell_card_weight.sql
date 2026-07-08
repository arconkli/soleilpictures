-- 0177_grid_cell_card_weight.sql
-- Grids now count their FILLED cells toward the demo card cap. Previously a grid
-- was one card_index row = 1 toward the 100-card cap no matter how much it held,
-- so a grid packed with 25 images counted as 1 — a loophole. Add a per-row
-- `weight` to card_index (default 1); the client sync (_doSyncCardIndex) sets a
-- grid's weight = its non-empty cell count (min 1). The demo-cap trigger and
-- get_my_tier now SUM(weight) instead of counting rows, so the cap + the "N/100"
-- chip reflect real content. bonus_card_credits / effective_card_limit unchanged.

alter table public.card_index
  add column if not exists weight integer not null default 1;

-- ---------------------------------------------------------------------------
-- Demo-cap BEFORE-INSERT trigger: gate on SUM(weight), not COUNT(*).
-- (Body reproduced from 0163; only the count aggregate changes. The trigger is
--  already bound to card_index — replacing the function is enough. It backstops
--  NEW cards; increasing a grid's weight by filling cells is a card_index UPDATE
--  gated on the client, so the row-insert path stays the server guard.)
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
  if exists (
    select 1 from public.card_index
     where board_id = new.board_id and card_id = new.card_id
  ) then
    return new;  -- existing card re-sync, never blocked
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

  -- Weighted count across all of the owner's boards (a grid weighs its cells).
  select coalesce(sum(ci.weight), 0) into v_count
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
-- get_my_tier(): demo_card_count is now the LIVE weighted count from card_index
-- (was the cached profiles.demo_card_count, which counts rows not weight). Same
-- RETURNS shape, so CREATE OR REPLACE is fine (no drop/re-grant needed).
-- ---------------------------------------------------------------------------
create or replace function public.get_my_tier()
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
    coalesce((
      select sum(ci.weight)::integer
        from public.card_index ci
        join public.boards b on b.id = ci.board_id
       where b.created_by = u.id
    ), 0)::integer                                             as demo_card_count,
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
