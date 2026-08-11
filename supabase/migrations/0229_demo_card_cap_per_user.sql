-- 0229_demo_card_cap_per_user.sql — the demo card cap becomes PER-USER state.
--
-- Until now the cap was a literal `100` compiled into five separate functions.
-- New accounts should start at 50, but every account that already exists keeps
-- the 100 it signed up under. A literal can't express two cohorts, so the cap
-- moves out of the function bodies and into a column:
--
--     profiles.card_cap_base  — the account's base cap, before referral bonuses
--
-- Effective cap is, and stays, `card_cap_base + bonus_card_credits`.
--
-- ORDER MATTERS. On PG11+ `add column ... default 50` backfills EXISTING rows
-- with 50 — the exact opposite of grandfathering. So: add the column bare,
-- backfill everyone to 100, and only then attach the 50 default that new
-- signups inherit.
--
-- Why a column default is sufficient for new signups: ensure_profile_for_new_user
-- (the auth.users INSERT trigger) inserts `(user_id, tier)` only. It never names
-- a cap column, so the default applies with no trigger change.
--
-- Write safety: public.profiles grants UPDATE to `authenticated` on exactly four
-- columns (avatar_url, color, display_name, notification_prefs). A new column is
-- therefore NOT client-writable. This is the opposite of the table-level-grant
-- hazard that made every new column writable on the public analytics tables —
-- verified here rather than assumed, and re-asserted at the foot of this file.
--
-- The five functions below are the complete set that computed `100 + bonus`.
-- They must move together: the trigger is what actually blocks, and the other
-- four are what the UI believes. If they disagree, users see a limit that isn't
-- the one being enforced.
--
--   enforce_demo_card_cap_trg  (0187) — the authoritative BEFORE INSERT gate
--   get_my_tier                (0187) — effective_card_limit for the client
--   get_board_capacity         (0187) — owner-keyed capacity on shared boards
--   scout_board_capacity       (0216) — the service-role mirror for Scout
--   admin_user_detail          (0205) — demo_card_cap + effective_card_limit
--
-- Bodies are otherwise VERBATIM from the live definitions; only the cap
-- expression changes. Superseded historical migrations (0091/0163/0177/0164/
-- 0193 and the older admin RPCs) are deliberately left alone — last writer wins,
-- and rewriting them would break `db reset` reproducibility.

-----------------------------------------------------------------------
-- 1. The column. Grandfather everyone, then default new signups to 50.
-----------------------------------------------------------------------
alter table public.profiles
  add column if not exists card_cap_base integer;

-- Every account that exists right now keeps the cap it signed up under.
update public.profiles set card_cap_base = 100 where card_cap_base is null;

alter table public.profiles alter column card_cap_base set default 50;
alter table public.profiles alter column card_cap_base set not null;

comment on column public.profiles.card_cap_base is
  'Base demo card cap for this account, before bonus_card_credits. 100 for '
  'accounts created before migration 0229 (grandfathered); 50 by default for '
  'accounts created after. Never client-writable — see the column grants at the '
  'foot of 0229.';

-----------------------------------------------------------------------
-- 2. enforce_demo_card_cap_trg — the authoritative gate.
--    Body verbatim from 0187 except the cap expression.
-----------------------------------------------------------------------
create or replace function public.enforce_demo_card_cap_trg()
returns trigger
language plpgsql security definer
set search_path = public as $$
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
    return new;
  end if;
  v_owner := public.board_workspace_owner(new.board_id);
  if v_owner is null then
    return new;
  end if;
  select tier, coalesce(card_cap_base, 50) + coalesce(bonus_card_credits, 0)
    into v_tier, v_cap
    from public.profiles where user_id = v_owner;
  if v_tier is distinct from 'demo' then
    return new;
  end if;
  select coalesce(sum(ci.weight), 0) into v_count
    from public.card_index ci
    join public.boards b     on b.id = ci.board_id
    join public.workspaces w on w.id = b.workspace_id
   where w.created_by = v_owner;
  if v_count >= coalesce(v_cap, 50) then
    raise exception
      'Demo accounts are limited to % cards. Invite friends or upgrade to add more.', coalesce(v_cap, 50)
      using errcode = '42501';
  end if;
  return new;
end $$;

-----------------------------------------------------------------------
-- 3. get_my_tier — effective_card_limit is what the whole client UI reads.
--    Body verbatim from 0187 except the cap expression.
-----------------------------------------------------------------------
create or replace function public.get_my_tier()
returns table(
  tier text, demo_card_count integer, subscription_status text,
  current_period_end timestamptz, cancel_at_period_end boolean,
  grant_active boolean, grant_expires_at timestamptz, banned boolean,
  ad_offer_pending boolean, onboarding jsonb,
  bonus_card_credits integer, effective_card_limit integer
)
language sql stable security definer
set search_path = public as $$
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
                                                               as effective_card_limit
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

-----------------------------------------------------------------------
-- 4. get_board_capacity — the OWNER's capacity, for clients on boards they
--    don't own. Body verbatim from 0187 except the cap expression.
-----------------------------------------------------------------------
create or replace function public.get_board_capacity(p_board_id uuid)
returns table(is_capped boolean, used integer, cap integer)
language plpgsql stable security definer
set search_path = public as $$
declare
  v_owner uuid;
  v_tier  text;
  v_cap   integer;
  v_used  integer;
begin
  if not public.can_read_board(p_board_id) then
    raise exception 'you do not have access to this board' using errcode = '42501';
  end if;
  v_owner := public.board_workspace_owner(p_board_id);
  if v_owner is null then
    return query select false, 0, 0; return;
  end if;
  select p.tier, coalesce(p.card_cap_base, 50) + coalesce(p.bonus_card_credits, 0)
    into v_tier, v_cap
    from public.profiles p where p.user_id = v_owner;
  if v_tier is distinct from 'demo' then
    return query select false, 0, 0; return;
  end if;
  select coalesce(sum(ci.weight), 0)::integer into v_used
    from public.card_index ci
    join public.boards b     on b.id = ci.board_id
    join public.workspaces w on w.id = b.workspace_id
   where w.created_by = v_owner;
  return query select true, v_used, coalesce(v_cap, 50);
end $$;
revoke all on function public.get_board_capacity(uuid) from public;
grant execute on function public.get_board_capacity(uuid) to authenticated;

-----------------------------------------------------------------------
-- 5. scout_board_capacity — the service-role mirror Scout authorizes with.
--    Body verbatim from 0216 except the cap expression.
-----------------------------------------------------------------------
create or replace function public.scout_board_capacity(p_board_id uuid, p_user_id uuid)
returns table(is_capped boolean, used integer, cap integer)
language plpgsql stable security definer
set search_path = public, auth as $$
declare
  v_owner uuid;
  v_tier  text;
  v_cap   integer;
  v_used  integer;
begin
  -- Same predicate the rest of Scout authorizes with, so "may I write here"
  -- and "how much room is left here" can never disagree.
  if not public.scout_can_write_board(p_board_id, p_user_id) then
    raise exception 'you do not have access to this board' using errcode = '42501';
  end if;

  v_owner := public.board_workspace_owner(p_board_id);
  if v_owner is null then
    return query select false, 0, 0; return;
  end if;

  select p.tier, coalesce(p.card_cap_base, 50) + coalesce(p.bonus_card_credits, 0)
    into v_tier, v_cap
    from public.profiles p where p.user_id = v_owner;

  if v_tier is distinct from 'demo' then
    return query select false, 0, 0; return;
  end if;

  select coalesce(sum(ci.weight), 0)::integer into v_used
    from public.card_index ci
    join public.boards b     on b.id = ci.board_id
    join public.workspaces w on w.id = b.workspace_id
   where w.created_by = v_owner;

  return query select true, v_used, coalesce(v_cap, 50);
end $$;

-----------------------------------------------------------------------
-- 6. admin_user_detail — the admin panel must show the user's REAL cap, or
--    it can't be used to verify grandfathering. Body verbatim from 0205
--    except the two cap expressions in the 'engagement' object.
-----------------------------------------------------------------------
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
      'card_count',      coalesce(oc.card_count, 0),
      'board_count',     coalesce(ob.board_count, 0),
      'demo_card_count', coalesce(p.demo_card_count, 0),
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

-----------------------------------------------------------------------
-- 7. Write safety. profiles UPDATE is column-scoped for `authenticated`;
--    card_cap_base must never join that list. Re-asserted here so a future
--    blanket `grant update on profiles` can't silently hand users their own
--    cap dial.
-----------------------------------------------------------------------
revoke update (card_cap_base) on public.profiles from anon, authenticated;
