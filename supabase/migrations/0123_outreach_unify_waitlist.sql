-- 0123_outreach_unify_waitlist.sql
--
-- Two related changes:
--
--  1. UNIFY OUTREACH ON EMAIL. The 0122 user_outreach log was keyed by user_id
--     only. Waitlist entries are keyed by EMAIL and often have no account yet, so
--     to mark/see outreach from the waitlist panel AND have it show on the Users
--     tab (and vice-versa) we make user_outreach email-aware (like paid_grants):
--     email is the stable key, user_id is linked when known. All reads now match
--     by user_id OR lower(email).
--
--  2. WAITLIST ADMIN RPCs powering a reworked two-pane Waitlist panel:
--     admin_list_waitlist / admin_waitlist_count / admin_waitlist_status_counts
--     (with per-entry outreach + a contacted filter), and bulk mutation RPCs
--     admin_waitlist_reject / _reschedule / _reopen. ACCEPT is unchanged — it
--     keeps going through the admin-waitlist-action edge fn (sends the welcome
--     email); only non-email mutations move to RPCs here.

------------------------------------------------------------------
-- 1. user_outreach — add email, make user_id nullable, backfill.
------------------------------------------------------------------
alter table public.user_outreach add column if not exists email text;
alter table public.user_outreach alter column user_id drop not null;
update public.user_outreach o
   set email = lower(au.email)
  from auth.users au
 where au.id = o.user_id and o.email is null;
alter table public.user_outreach alter column email set not null;
create index if not exists user_outreach_email_idx on public.user_outreach (lower(email));

------------------------------------------------------------------
-- 2. admin_log_outreach — accept user_id OR email (resolve both).
------------------------------------------------------------------
drop function if exists public.admin_log_outreach(uuid, text);

create or replace function public.admin_log_outreach(
  p_user_id uuid default null,
  p_email   text default null,
  p_note    text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_admin_uid   uuid := auth.uid();
  v_admin_email text;
  v_note        text := nullif(trim(coalesce(p_note, '')), '');
  v_user_id     uuid := p_user_id;
  v_email       text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_row         public.user_outreach%rowtype;
begin
  perform public._require_admin();

  -- Resolve email <-> user_id so the row is linked on whichever key we have.
  if v_user_id is not null and v_email is null then
    select lower(email) into v_email from auth.users where id = v_user_id;
  elsif v_email is not null and v_user_id is null then
    select id into v_user_id from auth.users where lower(email) = v_email;
  end if;

  if v_email is null then
    raise exception 'email or user_id required' using errcode = '22023';
  end if;

  select email::text into v_admin_email from auth.users where id = v_admin_uid;

  insert into public.user_outreach (user_id, email, reached_by, reached_by_email, note)
  values (v_user_id, v_email, v_admin_uid, v_admin_email, v_note)
  returning * into v_row;

  return jsonb_build_object(
    'id',               v_row.id,
    'email',            v_row.email,
    'reached_at',       v_row.reached_at,
    'reached_by_email', v_row.reached_by_email,
    'note',             v_row.note
  );
end $$;
revoke all on function public.admin_log_outreach(uuid, text, text) from public;
grant execute on function public.admin_log_outreach(uuid, text, text) to authenticated;

------------------------------------------------------------------
-- 3. Match outreach by user_id OR email in the user-facing RPCs.
--    (Bodies reproduced from 0122 with the one predicate change.)
------------------------------------------------------------------

-- 3a. admin_user_detail — outreach subquery now matches by user_id OR email.
create or replace function public.admin_user_detail(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
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
      'banned',      (p.banned_at is not null),
      'is_internal', exists (select 1 from public._internal_user_ids() iu(id) where iu.id = u.id)
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
      'label', case
        when nullif(p.first_source->>'fbclid', '') is not null then 'facebook'
        when nullif(lower(p.first_source->>'utm_source'), '') is not null
          then lower(p.first_source->>'utm_source')
        when nullif(p.first_source->>'referrer', '') is not null then
          split_part(
            regexp_replace(
              regexp_replace(p.first_source->>'referrer', '^https?://', '', 'i'),
              '^www\.', '', 'i'),
            '/', 1)
        else 'direct'
      end,
      'utm_source',   nullif(p.first_source->>'utm_source', ''),
      'utm_medium',   nullif(p.first_source->>'utm_medium', ''),
      'utm_campaign', nullif(p.first_source->>'utm_campaign', ''),
      'utm_content',  nullif(p.first_source->>'utm_content', ''),
      'utm_term',     nullif(p.first_source->>'utm_term', ''),
      'referrer',     nullif(p.first_source->>'referrer', ''),
      'fbclid',       nullif(p.first_source->>'fbclid', ''),
      'fbc',          nullif(p.first_source->>'fbc', ''),
      'raw',          coalesce(p.first_source, '{}'::jsonb)
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
      'demo_card_cap',   100
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
  where u.id = p_user_id
    and u.email_confirmed_at is not null;

  if v_out is null then
    raise exception 'user not found or not verified: %', p_user_id using errcode = 'P0002';
  end if;

  return v_out;
end $function$;
revoke all on function public.admin_user_detail(uuid) from public;
grant execute on function public.admin_user_detail(uuid) to authenticated;

-- 3b. admin_list_users — outreach lateral join now matches by user_id OR email.
create or replace function public.admin_list_users(
  p_limit     integer default 50,
  p_offset    integer default 0,
  p_query     text    default null,
  p_tier      text    default null,
  p_sort      text    default 'recent',
  p_status    text    default null,
  p_source    text    default null,
  p_contacted text    default null
)
returns table(
  user_id                   uuid,
  email                     text,
  tier                      text,
  card_count                integer,
  seconds_in_app            bigint,
  created_at                timestamptz,
  last_sign_in_at           timestamptz,
  subscription_plan         text,
  subscription_status       text,
  current_period_end        timestamptz,
  subscription_amount_cents integer,
  subscription_discounted   boolean,
  banned                    boolean,
  joined_waitlist           boolean,
  display_name              text,
  avatar_url                text,
  color                     text,
  last_seen_at              timestamptz,
  board_count               integer,
  acquisition_source        text,
  last_reached_out_at       timestamptz,
  outreach_count            integer
)
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_q text := nullif(trim(coalesce(p_query,     '')), '');
  v_t text := nullif(trim(coalesce(p_tier,      '')), '');
  v_s text := nullif(trim(coalesce(p_status,    '')), '');
  v_o text := nullif(trim(coalesce(p_source,    '')), '');
  v_c text := nullif(trim(coalesce(p_contacted, '')), '');
  v_k text := lower(coalesce(nullif(trim(p_sort), ''), 'recent'));
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
      case
        when nullif(p.first_source->>'fbclid', '') is not null then 'facebook'
        when nullif(lower(p.first_source->>'utm_source'), '') is not null
          then lower(p.first_source->>'utm_source')
        when nullif(p.first_source->>'referrer', '') is not null then
          split_part(
            regexp_replace(
              regexp_replace(p.first_source->>'referrer', '^https?://', '', 'i'),
              '^www\.', '', 'i'),
            '/', 1)
        else 'direct'
      end                                        as acquisition_source,
      ox.last_reached_out_at                      as last_reached_out_at,
      coalesce(ox.outreach_count, 0)::int         as outreach_count
    from auth.users u
    left join public.profiles      p  on p.user_id  = u.id
    left join public.subscriptions s  on s.user_id  = u.id
    left join public.user_presence pr on pr.user_id = u.id
    left join owner_cards          oc on oc.uid     = u.id
    left join owner_boards         ob on ob.uid     = u.id
    left join lateral (
      select max(o.reached_at) as last_reached_out_at, count(*)::int as outreach_count
      from public.user_outreach o where o.user_id = u.id or lower(o.email) = lower(u.email)
    ) ox on true
    where u.email_confirmed_at is not null
      and (v_q is null or u.email ilike '%' || v_q || '%')
      and (v_t is null or coalesce(p.tier, 'demo') = v_t)
      and (v_s is null or s.status = v_s)
  )
  select * from base
  where (v_o is null or base.acquisition_source = v_o)
    and (v_c is null
         or (v_c = 'yes' and base.last_reached_out_at is not null)
         or (v_c = 'no'  and base.last_reached_out_at is null))
  order by
    case when v_k = 'recent' then base.created_at end desc nulls last,
    case when v_k = 'active' then base.last_seen_at end desc nulls last,
    case when v_k = 'cards'  then base.card_count end desc nulls last,
    case when v_k = 'spend'  then base.subscription_amount_cents end desc nulls last,
    case when v_k = 'name'   then lower(coalesce(base.display_name, base.email)) end asc nulls last,
    base.created_at desc nulls last
  limit p_limit
  offset p_offset;
end $$;
revoke all on function public.admin_list_users(int, int, text, text, text, text, text, text) from public;
grant execute on function public.admin_list_users(int, int, text, text, text, text, text, text) to authenticated;

-- 3c. admin_user_count — contacted filter now matches by user_id OR email.
create or replace function public.admin_user_count(
  p_query     text default null,
  p_tier      text default null,
  p_status    text default null,
  p_source    text default null,
  p_contacted text default null
)
returns bigint language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_q text := nullif(trim(coalesce(p_query,     '')), '');
  v_t text := nullif(trim(coalesce(p_tier,      '')), '');
  v_s text := nullif(trim(coalesce(p_status,    '')), '');
  v_o text := nullif(trim(coalesce(p_source,    '')), '');
  v_c text := nullif(trim(coalesce(p_contacted, '')), '');
  v_n bigint;
begin
  perform public._require_admin();

  with base as (
    select
      case
        when nullif(p.first_source->>'fbclid', '') is not null then 'facebook'
        when nullif(lower(p.first_source->>'utm_source'), '') is not null
          then lower(p.first_source->>'utm_source')
        when nullif(p.first_source->>'referrer', '') is not null then
          split_part(
            regexp_replace(
              regexp_replace(p.first_source->>'referrer', '^https?://', '', 'i'),
              '^www\.', '', 'i'),
            '/', 1)
        else 'direct'
      end as acquisition_source
    from auth.users u
    left join public.profiles      p on p.user_id = u.id
    left join public.subscriptions s on s.user_id = u.id
    where u.email_confirmed_at is not null
      and (v_q is null or u.email ilike '%' || v_q || '%')
      and (v_t is null or coalesce(p.tier, 'demo') = v_t)
      and (v_s is null or s.status = v_s)
      and (v_c is null
           or (v_c = 'yes' and     exists (select 1 from public.user_outreach o where o.user_id = u.id or lower(o.email) = lower(u.email)))
           or (v_c = 'no'  and not exists (select 1 from public.user_outreach o where o.user_id = u.id or lower(o.email) = lower(u.email))))
  )
  select count(*) into v_n from base
  where (v_o is null or base.acquisition_source = v_o);

  return v_n;
end $$;
revoke all on function public.admin_user_count(text, text, text, text, text) from public;
grant execute on function public.admin_user_count(text, text, text, text, text) to authenticated;

------------------------------------------------------------------
-- 4. Waitlist read RPCs (two-pane panel).
------------------------------------------------------------------
create or replace function public.admin_list_waitlist(
  p_limit     integer default 50,
  p_offset    integer default 0,
  p_query     text    default null,
  p_status    text    default null,
  p_contacted text    default null
)
returns table(
  id                  uuid,
  email               text,
  links               jsonb,
  timezone            text,
  status              text,
  scheduled_accept_at timestamptz,
  accepted_at         timestamptz,
  rejected_at         timestamptz,
  reviewed_by         uuid,
  reviewed_by_email   text,
  created_at          timestamptz,
  user_id             uuid,
  last_reached_out_at timestamptz,
  outreach_count      integer,
  outreach            jsonb
)
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_q text := nullif(trim(coalesce(p_query,     '')), '');
  v_s text := nullif(trim(coalesce(p_status,    '')), '');
  v_c text := nullif(trim(coalesce(p_contacted, '')), '');
begin
  perform public._require_admin();
  p_limit  := greatest(1, least(p_limit, 200));
  p_offset := greatest(0, p_offset);

  return query
  with base as (
    select
      we.id, we.email, we.links, we.timezone, we.status,
      we.scheduled_accept_at, we.accepted_at, we.rejected_at,
      we.reviewed_by,
      (select rb.email::text from auth.users rb where rb.id = we.reviewed_by) as reviewed_by_email,
      we.created_at,
      (select au.id from auth.users au where lower(au.email) = lower(we.email)) as user_id,
      ox.last_reached_out_at,
      coalesce(ox.outreach_count, 0)::int as outreach_count,
      ox.outreach
    from public.waitlist_entries we
    left join lateral (
      select
        max(o.reached_at) as last_reached_out_at,
        count(*)::int     as outreach_count,
        coalesce(jsonb_agg(jsonb_build_object(
          'id', o.id, 'email', o.email, 'reached_at', o.reached_at,
          'reached_by_email', o.reached_by_email, 'note', o.note
        ) order by o.reached_at desc), '[]'::jsonb) as outreach
      from public.user_outreach o
      where lower(o.email) = lower(we.email)
    ) ox on true
    where (v_q is null or we.email ilike '%' || v_q || '%')
      and (v_s is null or we.status = v_s)
      and (v_c is null
           or (v_c = 'yes' and ox.last_reached_out_at is not null)
           or (v_c = 'no'  and ox.last_reached_out_at is null))
  )
  select * from base
  order by
    case base.status when 'pending' then 0 when 'accepted' then 1 when 'rejected' then 2 else 3 end asc,
    base.scheduled_accept_at asc nulls last,
    base.created_at desc
  limit p_limit offset p_offset;
end $$;
revoke all on function public.admin_list_waitlist(int, int, text, text, text) from public;
grant execute on function public.admin_list_waitlist(int, int, text, text, text) to authenticated;

create or replace function public.admin_waitlist_count(
  p_query     text default null,
  p_status    text default null,
  p_contacted text default null
)
returns bigint language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_q text := nullif(trim(coalesce(p_query,     '')), '');
  v_s text := nullif(trim(coalesce(p_status,    '')), '');
  v_c text := nullif(trim(coalesce(p_contacted, '')), '');
  v_n bigint;
begin
  perform public._require_admin();
  select count(*) into v_n
    from public.waitlist_entries we
   where (v_q is null or we.email ilike '%' || v_q || '%')
     and (v_s is null or we.status = v_s)
     and (v_c is null
          or (v_c = 'yes' and     exists (select 1 from public.user_outreach o where lower(o.email) = lower(we.email)))
          or (v_c = 'no'  and not exists (select 1 from public.user_outreach o where lower(o.email) = lower(we.email))));
  return v_n;
end $$;
revoke all on function public.admin_waitlist_count(text, text, text) from public;
grant execute on function public.admin_waitlist_count(text, text, text) to authenticated;

create or replace function public.admin_waitlist_status_counts()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_out jsonb;
begin
  perform public._require_admin();
  select jsonb_build_object(
    'total',    count(*),
    'pending',  count(*) filter (where status = 'pending'),
    'accepted', count(*) filter (where status = 'accepted'),
    'rejected', count(*) filter (where status = 'rejected'),
    'canceled', count(*) filter (where status = 'canceled')
  ) into v_out from public.waitlist_entries;
  return v_out;
end $$;
revoke all on function public.admin_waitlist_status_counts() from public;
grant execute on function public.admin_waitlist_status_counts() to authenticated;

------------------------------------------------------------------
-- 5. Waitlist mutation RPCs (bulk). ACCEPT stays on the edge fn.
--    Each gates on _require_admin, stamps reviewed_by, skips non-qualifying
--    rows, and returns {affected, skipped}.
------------------------------------------------------------------
create or replace function public.admin_waitlist_reject(p_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_aff int; v_total int := coalesce(array_length(p_ids, 1), 0);
begin
  perform public._require_admin();
  update public.waitlist_entries
     set status = 'rejected', rejected_at = now(), reviewed_by = auth.uid()
   where id = any(p_ids) and status = 'pending';
  get diagnostics v_aff = row_count;
  return jsonb_build_object('affected', v_aff, 'skipped', v_total - v_aff);
end $$;
revoke all on function public.admin_waitlist_reject(uuid[]) from public;
grant execute on function public.admin_waitlist_reject(uuid[]) to authenticated;

create or replace function public.admin_waitlist_reschedule(
  p_ids uuid[],
  p_scheduled_at timestamptz default null,
  p_days int default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_aff int;
  v_total int := coalesce(array_length(p_ids, 1), 0);
  v_when timestamptz;
begin
  perform public._require_admin();
  if p_scheduled_at is not null then
    v_when := p_scheduled_at;
  else
    v_when := now() + (least(greatest(coalesce(p_days, 7), 1), 30) || ' days')::interval;
  end if;
  if v_when <= now() then
    raise exception 'scheduled time must be in the future' using errcode = '22023';
  end if;

  update public.waitlist_entries
     set scheduled_accept_at = v_when, reviewed_by = auth.uid()
   where id = any(p_ids) and status = 'pending';
  get diagnostics v_aff = row_count;
  return jsonb_build_object('affected', v_aff, 'skipped', v_total - v_aff, 'scheduled_at', v_when);
end $$;
revoke all on function public.admin_waitlist_reschedule(uuid[], timestamptz, int) from public;
grant execute on function public.admin_waitlist_reschedule(uuid[], timestamptz, int) to authenticated;

create or replace function public.admin_waitlist_reopen(p_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_aff int;
  v_total int := coalesce(array_length(p_ids, 1), 0);
  v_when timestamptz := now() + interval '7 days';
begin
  perform public._require_admin();

  -- Re-opening an ACCEPTED entry revokes access: demote the matching user from
  -- demo back to waitlist (never touch paid/admin). Do this BEFORE status flips.
  update public.profiles p
     set tier = 'waitlist'
   where p.tier = 'demo'
     and p.user_id in (
       select au.id from auth.users au
       join public.waitlist_entries we on lower(we.email) = lower(au.email)
       where we.id = any(p_ids) and we.status = 'accepted'
     );

  update public.waitlist_entries
     set status = 'pending', scheduled_accept_at = v_when,
         accepted_at = null, rejected_at = null, reviewed_by = auth.uid()
   where id = any(p_ids) and status in ('accepted', 'rejected', 'canceled');
  get diagnostics v_aff = row_count;
  return jsonb_build_object('affected', v_aff, 'skipped', v_total - v_aff);
end $$;
revoke all on function public.admin_waitlist_reopen(uuid[]) from public;
grant execute on function public.admin_waitlist_reopen(uuid[]) to authenticated;
