-- 0119_onboarding_state.sql
--
-- First-run onboarding state.
--
-- New users were landing on a blank "Studio" canvas and bouncing (live data:
-- median ~44s in app, 6 of 10 demo users under a minute total, only 3 ever
-- placed a card). We now seed a few starter cards + show a one-time first-card
-- coachmark on first run. The state persists in profiles.settings.onboarding =
-- { "seeded": bool, "done": bool }, written through the existing
-- merge_profile_settings RPC (shallow top-level ||, so it never clobbers
-- sibling keys like ad_offer_pending / ui) — exactly mirroring the
-- ad_offer_pending pattern from 0113.
--
-- This migration only re-declares get_my_tier() to surface the flag to the
-- client. Postgres can't add a column to an existing RETURNS TABLE function, so
-- we drop + recreate the verbatim 0113 body plus one `onboarding jsonb` column.

begin;

drop function if exists public.get_my_tier();
create function public.get_my_tier()
returns table(
  tier                 text,
  demo_card_count      integer,
  subscription_status  text,
  current_period_end   timestamptz,
  cancel_at_period_end boolean,
  grant_active         boolean,
  grant_expires_at     timestamptz,
  banned               boolean,
  ad_offer_pending     boolean,
  onboarding           jsonb
)
language sql stable security definer set search_path to 'public' as $function$
  select
    coalesce(p.tier, 'demo')::text,
    coalesce(p.demo_card_count, 0)::integer,
    s.status::text,
    s.current_period_end,
    coalesce(s.cancel_at_period_end, false),
    (gr.hit is not null)                                      as grant_active,
    gr.gexp                                                   as grant_expires_at,
    (p.banned_at is not null)                                 as banned,
    coalesce((p.settings->>'ad_offer_pending')::boolean, false) as ad_offer_pending,
    coalesce(p.settings->'onboarding', '{}'::jsonb)             as onboarding
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
$function$;
grant execute on function public.get_my_tier() to authenticated;

commit;
