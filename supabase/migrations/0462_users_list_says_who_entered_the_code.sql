-- 0462_users_list_says_who_entered_the_code.sql
--
-- The Users list's email_confirmed column now says whether the address was
-- proven: whether its owner entered the emailed code, by 0461's
-- _admin_entered_code(). Email autoconfirm stamps email_confirmed_at on every
-- account the moment a code is asked for, so the column was true on every row
-- and the list could not mark the accounts that never got in. The detail view
-- already reads the helper, as flags.verified, since 0461.
--
-- The body is the live one, 0461's, with only that expression replaced,
-- checked by md5 against the database as it was applied.

begin;

set local lock_timeout = '3s';

create or replace function public.admin_list_users(p_limit integer default 50, p_offset integer default 0, p_query text default null, p_tier text default null, p_sort text default 'recent', p_status text default null, p_source text default null, p_contacted text default null, p_verification text default 'verified', p_activity text default 'all')
returns table (user_id uuid, email text, tier text, card_count integer, seconds_in_app bigint, created_at timestamptz, last_sign_in_at timestamptz, subscription_plan text, subscription_status text, current_period_end timestamptz, subscription_amount_cents integer, subscription_discounted boolean, banned boolean, joined_waitlist boolean, display_name text, avatar_url text, color text, last_seen_at timestamptz, board_count integer, acquisition_source text, last_reached_out_at timestamptz, outreach_count integer, email_confirmed boolean, storage_bytes bigint, country text, last_worked_at timestamptz)
language plpgsql stable security definer set search_path = public
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
    select b.created_by as uid,
           max(ci.updated_at) filter (where ci.card_id not like 'onb-%') as last_card_at
    from public.card_index ci join public.boards b on b.id = ci.board_id
    group by b.created_by
  ),
  owner_counts as (
    select c.user_id as uid, c.live_cards from public._owner_card_counts c
  ),
  owner_boards as (
    select b.created_by as uid, count(*)::int as board_count
    from public.boards b where b.created_by is not null and b.deleted_at is null
    group by b.created_by
  ),
  owner_storage as (
    select w.created_by as uid, coalesce(sum(i.size_bytes), 0)::bigint as bytes
    from public.images i join public.workspaces w on w.id = i.workspace_id
    where i.deleted_at is null group by w.created_by
  ),
  work_ev as (
    select e.user_id as uid, max(e.occurred_at) as last_ev_at
    from public.analytics_events e
    where e.user_id is not null
      and e.event in ('card_placed','card_edit','doc_edit','comment_create',
                      'arrow_created','remix_clone','tag_manual_apply','tag_confirm')
      and coalesce(e.props->>'synthetic', '') <> 'true'
    group by e.user_id
  ),
  base as (
    select
      u.id as user_id, u.email::text as email, coalesce(p.tier, 'demo')::text as tier,
      coalesce(occ.live_cards, 0)::int as card_count,
      coalesce(p.seconds_in_app, 0)::bigint as seconds_in_app,
      u.created_at as created_at, u.last_sign_in_at as last_sign_in_at,
      s.plan::text as subscription_plan, s.status::text as subscription_status,
      s.current_period_end as current_period_end, s.monthly_amount_cents as subscription_amount_cents,
      (s.discount is not null) as subscription_discounted, (p.banned_at is not null) as banned,
      exists (select 1 from public.waitlist_entries we2 where lower(we2.email) = lower(u.email)) as joined_waitlist,
      nullif(p.display_name, '') as display_name, nullif(p.avatar_url, '') as avatar_url,
      nullif(p.color, '') as color, pr.last_seen_at as last_seen_at,
      coalesce(ob.board_count, 0)::int as board_count,
      public.derive_acquisition_channel(p.first_source) as acquisition_source,
      ox.last_reached_out_at as last_reached_out_at, coalesce(ox.outreach_count, 0)::int as outreach_count,
      (u.id in (select ec.entered_id from public._admin_entered_code() ec)) as email_confirmed, coalesce(ostor.bytes, 0)::bigint as storage_bytes,
      nullif(p.country, '') as country,
      greatest(oc.last_card_at, we.last_ev_at) as last_worked_at
    from auth.users u
    left join public.profiles p on p.user_id = u.id
    left join public.subscriptions s on s.user_id = u.id
    left join public.user_presence pr on pr.user_id = u.id
    left join owner_cards oc on oc.uid = u.id
    left join owner_counts occ on occ.uid = u.id
    left join owner_boards ob on ob.uid = u.id
    left join owner_storage ostor on ostor.uid = u.id
    left join work_ev we on we.uid = u.id
    left join lateral (
      select max(o.reached_at) as last_reached_out_at, count(*)::int as outreach_count
      from public.user_outreach o where o.user_id = u.id or lower(o.email) = lower(u.email)
    ) ox on true
    where (case v_v
             when 'verified'   then (u.id in (select ec.entered_id from public._admin_entered_code() ec))
             when 'unverified' then (u.id not in (select ec.entered_id from public._admin_entered_code() ec))
             else true end)
      and (v_q is null or u.email ilike '%' || v_q || '%')
      and (v_t is null or coalesce(p.tier, 'demo') = v_t)
      and (v_s is null or s.status = v_s)
  )
  select * from base
  where (v_o is null or base.acquisition_source = v_o)
    and (v_c is null
         or (v_c = 'yes' and base.last_reached_out_at is not null)
         or (v_c = 'no'  and base.last_reached_out_at is null))
    -- 0460: "active" meant cards OR any cluster, and every account's Studio
    -- is a cluster. It means made something now; see _admin_made_something.
    and (case v_a
           when 'active'   then base.user_id in     (select m.user_id from public._admin_made_something() m)
           when 'inactive' then base.user_id not in (select m.user_id from public._admin_made_something() m)
           else true end)
  order by
    case when v_k = 'recent' then base.created_at end desc nulls last,
    case when v_k = 'active' then base.last_seen_at end desc nulls last,
    case when v_k = 'worked' then base.last_worked_at end desc nulls last,
    case when v_k = 'cards'  then base.card_count end desc nulls last,
    case when v_k = 'spend'  then base.subscription_amount_cents end desc nulls last,
    case when v_k = 'name'   then lower(coalesce(base.display_name, base.email)) end asc nulls last,
    base.created_at desc nulls last
  limit p_limit offset p_offset;
end $function$;

do $proof$
declare
  v_fn  constant regprocedure := 'public.admin_list_users(integer,integer,text,text,text,text,text,text,text,text)';
  v_src text;
begin
  select p.prosrc into v_src from pg_proc p where p.oid = v_fn;
  if v_src !~ '\(u\.id in \(select ec\.entered_id from public\._admin_entered_code\(\) ec\)\) as email_confirmed' then
    raise exception '0462: admin_list_users does not take email_confirmed from the helper';
  end if;
  if v_src ~ 'email_confirmed_at' then
    raise exception '0462: admin_list_users still reads email_confirmed_at';
  end if;
  if has_function_privilege('anon', v_fn, 'execute')
     or not has_function_privilege('authenticated', v_fn, 'execute')
     or not has_function_privilege('service_role', v_fn, 'execute') then
    raise exception '0462: the grants on admin_list_users moved';
  end if;
end $proof$;

notify pgrst, 'reload schema';

commit;
