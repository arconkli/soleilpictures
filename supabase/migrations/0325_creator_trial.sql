-- 0325 — the Creator trial: one per account, stamped when it actually starts.
--
-- profiles.creator_trial_started_at is written by the activation path
-- (_shared/activate.ts, service role) the first time a subscription for this
-- user is seen in status 'trialing' — NOT when the checkout session is
-- created, so bouncing at Stripe's card form does not burn the one offer.
-- create-checkout-session reads it (through get_my_tier, as the caller) to
-- refuse a second trial; the client reads it to decide whether to offer one.
--
-- profiles UPDATE is column-scoped for authenticated (avatar_url, color,
-- display_name, notification_prefs), so the new column is not client-writable.
-- The proof block at the end asserts exactly that, because a table-level grant
-- would make "no prior trial" a client-settable fact.
--
-- get_my_tier gains a trailing column. Its return type is a TABLE, so this is
-- DROP + CREATE; grants are restated because a dropped function takes its ACL
-- with it. The existing effective grant set (anon, authenticated, service_role
-- — the function keys on auth.uid() and returns no row for anon) is preserved
-- deliberately: tightening it is a separate decision from adding a column, and
-- a regression here would be a sign-in outage.

alter table public.profiles
  add column if not exists creator_trial_started_at timestamptz;

comment on column public.profiles.creator_trial_started_at is
  'When this account''s Creator trial subscription first reached status trialing. '
  'Written by the billing activation path only. Non-null means no second trial.';

drop function if exists public.get_my_tier();

create function public.get_my_tier()
returns table (
  tier text,
  demo_card_count integer,
  subscription_status text,
  current_period_end timestamptz,
  cancel_at_period_end boolean,
  grant_active boolean,
  grant_expires_at timestamptz,
  banned boolean,
  ad_offer_pending boolean,
  onboarding jsonb,
  bonus_card_credits integer,
  effective_card_limit integer,
  creator_trial_started_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(p.tier, 'demo')::text,
    coalesce((
      select sum(ci.weight)::integer
        from public.card_index ci
        join public.boards b     on b.id = ci.board_id
        join public.workspaces w on w.id = b.workspace_id
       where w.created_by = u.id
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
    (coalesce(p.card_cap_base, 50) + coalesce(p.bonus_card_credits, 0))::integer
                                                               as effective_card_limit,
    p.creator_trial_started_at
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

revoke all on function public.get_my_tier() from public;
grant execute on function public.get_my_tier() to anon, authenticated, service_role;

comment on function public.get_my_tier() is
  'The caller''s tier, live card count (weighted), subscription mirror, grant, cap and '
  'creator_trial_started_at. Keys on auth.uid(); returns no row for anon.';

-- Prove the grants and the column privilege rather than trust the statements.
do $$
begin
  if not has_function_privilege('authenticated', 'public.get_my_tier()', 'execute')
     or not has_function_privilege('service_role', 'public.get_my_tier()', 'execute')
     or not has_function_privilege('anon', 'public.get_my_tier()', 'execute') then
    raise exception '0325: get_my_tier grants are wrong';
  end if;
  if has_column_privilege('authenticated', 'public.profiles', 'creator_trial_started_at', 'update')
     or has_column_privilege('anon', 'public.profiles', 'creator_trial_started_at', 'update') then
    raise exception '0325: creator_trial_started_at must not be client-writable';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'get_my_tier') <> 1 then
    raise exception '0325: get_my_tier has an overload';
  end if;
end $$;
