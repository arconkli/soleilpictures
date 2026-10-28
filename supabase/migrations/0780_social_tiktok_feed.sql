-- 0780_social_tiktok_feed.sql
--
-- The TikTok slideshow machine (a private job on the owner's Mac) lines its
-- posts up with arrivals on the site. It reads AGGREGATES only: counts by hour
-- and by day, never a user, a session, an address or an email. It may call
-- this function only with a key whose SHA-256 is stored in social_feed_keys;
-- the key itself lives on the owner's Mac, and nothing in this repo or the
-- client knows it. The machine holds no database credentials.
--
-- TikTok viewers mostly arrive by typing the address in the page's bio or by
-- searching the name (the bio isn't a link yet), so beside sessions TikTok
-- tagged (utm, referrer, TikTok's in-app browser) the feed counts mobile
-- sessions that typed the home page or reached it from Google, the same groups
-- of signups, and Search Console's brand queries by day. The machine credits
-- what rises above each hour's usual level to the posts gaining views then.

create table if not exists public.social_feed_keys (
  key_hash   text primary key check (key_hash ~ '^[0-9a-f]{64}$'),
  label      text not null,
  created_at timestamptz not null default now()
);
alter table public.social_feed_keys enable row level security;
revoke all on table public.social_feed_keys from public, anon, authenticated;

create or replace function public.social_tiktok_feed(p_key text, p_days integer default 21)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_since timestamptz;
  v_hours jsonb;
  v_days  jsonb;
begin
  if p_key is null or length(p_key) < 32 or not exists (
    select 1 from social_feed_keys k where k.key_hash = encode(sha256(convert_to(p_key, 'UTF8')), 'hex')
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_since := date_trunc('hour', now()) - make_interval(days => least(greatest(coalesce(p_days, 21), 1), 60));

  with ev as (
    select e.session_id, e.occurred_at, e.event, e.props
      from analytics_events e
     where e.occurred_at >= v_since
       and e.session_id is not null
       and e.event in ('lp_view', 'landing_view', 'seo_landing_view', 'app_open', 'session_context')
  ),
  -- A session's first landing event says where it came from.
  first_landing as (
    select distinct on (session_id) session_id, occurred_at, props
      from ev
     where event <> 'session_context'
     order by session_id, occurred_at
  ),
  tiktok_browser as (
    select distinct session_id from ev
     where event = 'session_context' and props->>'webview_app' = 'tiktok'
  ),
  sessions as (
    select date_trunc('hour', f.occurred_at) as h,
           (lower(coalesce(f.props->>'utm_source', '')) like '%tiktok%'
             or lower(coalesce(f.props->>'referrer_host', '')) like '%tiktok%'
             or t.session_id is not null) as tiktok,
           coalesce(f.props->>'device_type', '') = 'mobile' as mobile,
           coalesce(f.props->>'landing_path', '') = '/' as home,
           coalesce(f.props->>'utm_source', '') = '' and coalesce(f.props->>'referrer_host', '') = '' as typed,
           coalesce(f.props->>'utm_source', '') = '' and lower(coalesce(f.props->>'referrer_host', '')) ~ '(^|[.])google[.]' as google
      from first_landing f
      left join tiktok_browser t using (session_id)
  ),
  s as (
    select h,
           count(*) filter (where tiktok)                              as tiktok,
           count(*) filter (where not tiktok and mobile and home and typed)  as typed_home,
           count(*) filter (where not tiktok and mobile and home and google) as google_home,
           count(*) filter (where mobile)                              as mobile_all
      from sessions group by h
  ),
  people as (
    select date_trunc('hour', u.created_at) as h,
           derive_acquisition_channel(p.first_source) as ch,
           coalesce(p.first_source->>'landing_path', '') as lp
      from auth.users u
      join profiles p on p.user_id = u.id
     where u.created_at >= v_since
       and u.email_confirmed_at is not null
       and u.id not in (select i.user_id from _internal_user_ids() i)
  ),
  u as (
    select h,
           count(*) filter (where ch = 'tiktok')                         as tiktok,
           count(*) filter (where ch = 'direct' and lp in ('/', ''))     as typed_home,
           count(*) filter (where ch = 'google' and lp in ('/', ''))     as google_home,
           count(*)                                                      as all_signups
      from people group by h
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'h', to_char(coalesce(s.h, u.h) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:00:00"Z"'),
           's', jsonb_build_object('tiktok', coalesce(s.tiktok, 0), 'typed_home', coalesce(s.typed_home, 0),
                                   'google_home', coalesce(s.google_home, 0), 'mobile_all', coalesce(s.mobile_all, 0)),
           'u', jsonb_build_object('tiktok', coalesce(u.tiktok, 0), 'typed_home', coalesce(u.typed_home, 0),
                                   'google_home', coalesce(u.google_home, 0), 'all', coalesce(u.all_signups, 0))
         ) order by coalesce(s.h, u.h)), '[]'::jsonb)
    into v_hours
    from s full outer join u on u.h = s.h;

  select coalesce(jsonb_agg(jsonb_build_object('d', g.day, 'impressions', g.impressions, 'clicks', g.clicks) order by g.day), '[]'::jsonb)
    into v_days
    from (
      select d.day, sum(d.impressions)::integer as impressions, sum(d.clicks)::integer as clicks
        from seo_page_daily d
       where d.day >= (v_since at time zone 'UTC')::date
         and d.query <> '' and d.search_type = 'web'
         and d.query ilike '%soleil%'
       group by d.day
    ) g;

  return jsonb_build_object(
    'since', to_char(v_since at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'generated', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'hours', v_hours,
    'brand_days', v_days
  );
end;
$$;

revoke execute on function public.social_tiktok_feed(text, integer) from public, anon, authenticated;
grant execute on function public.social_tiktok_feed(text, integer) to anon, service_role;

do $$
begin
  if not has_function_privilege('anon', 'public.social_tiktok_feed(text, integer)', 'execute') then
    raise exception '0780: anon cannot run social_tiktok_feed';
  end if;
  if has_function_privilege('authenticated', 'public.social_tiktok_feed(text, integer)', 'execute') then
    raise exception '0780: authenticated can run social_tiktok_feed';
  end if;
  if has_function_privilege('public', 'public.social_tiktok_feed(text, integer)', 'execute') then
    raise exception '0780: PUBLIC can run social_tiktok_feed';
  end if;
  if has_table_privilege('anon', 'public.social_feed_keys', 'select')
     or has_table_privilege('authenticated', 'public.social_feed_keys', 'select') then
    raise exception '0780: social_feed_keys is readable by a client';
  end if;
end $$;
