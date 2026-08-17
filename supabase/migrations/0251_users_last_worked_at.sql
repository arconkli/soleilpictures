-- 0251_users_last_worked_at.sql — "Last active" in the Users list was presence.
--
-- admin_list_users returns user_presence.last_seen_at, and the admin UI labels
-- it "Last active". That column is written by the presence heartbeat, so it
-- means "last had a tab open" — the same conflation 0248 fixed one level down
-- in user_active_day, and it was still driving the roster an operator actually
-- looks at when deciding who to contact.
--
-- Measured over 90 days before writing this: of the users with a recent
-- last_seen_at, only about half have ANY real work event, and roughly the other
-- half have a confident "Last active" timestamp while never having made
-- anything at all. Where both exist, last_seen_at sits on average ~3 days after
-- the last real work and as much as six weeks after it.
--
-- last_worked_at is added ALONGSIDE last_seen_at rather than replacing it. Both
-- are true and they answer different questions: "are they online right now"
-- (presence, for the live dot) and "when did they last make something"
-- (work, for deciding whether an account is real).
--
-- It is NOT derived from user_active_day.did_work. That column is honest but
-- only starts at 0248's deploy, so every historical row would read "never" —
-- a measurement gap rendered as a fact, which is exactly the failure this whole
-- exercise exists to stop. Instead it comes from two sources that have real
-- history:
--
--   • card_index.updated_at for boards the user owns — server truth, and the
--     aggregate is already being computed here for card_count
--   • the work events in analytics_events — covers doc edits and comments,
--     which never touch a card
--
-- Adding a column to the RETURN TABLE changes the function's signature, so
-- `create or replace` is not enough and the old one must be dropped.

drop function if exists public.admin_list_users(integer, integer, text, text, text, text, text, text, text, text);

create or replace function public.admin_list_users(
  p_limit integer default 50, p_offset integer default 0, p_query text default null,
  p_tier text default null, p_sort text default 'recent', p_status text default null,
  p_source text default null, p_contacted text default null,
  p_verification text default 'verified', p_activity text default 'all'
)
returns table(
  user_id uuid, email text, tier text, card_count integer, seconds_in_app bigint,
  created_at timestamptz, last_sign_in_at timestamptz, subscription_plan text,
  subscription_status text, current_period_end timestamptz, subscription_amount_cents integer,
  subscription_discounted boolean, banned boolean, joined_waitlist boolean,
  display_name text, avatar_url text, color text, last_seen_at timestamptz,
  board_count integer, acquisition_source text, last_reached_out_at timestamptz,
  outreach_count integer, email_confirmed boolean, storage_bytes bigint, country text,
  last_worked_at timestamptz
)
language plpgsql
stable security definer
set search_path to 'public'
as $$
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
    -- max(updated_at) rides along on an aggregate already being computed for
    -- card_count, so real-work recency costs nothing extra.
    --
    -- The onb-% filter is on the RECENCY ONLY, never on count(*). Seeded
    -- onboarding cards are not the user's work — but card_count has always
    -- included them, and quietly changing what that number means while adding
    -- a different column would be a second, unannounced change to a figure
    -- someone may already be reading.
    select b.created_by as uid,
           count(*)::int as card_count,
           max(ci.updated_at) filter (where ci.card_id not like 'onb-%') as last_card_at
    from public.card_index ci join public.boards b on b.id = ci.board_id
    group by b.created_by
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
    -- Work that never touches a card: doc edits, comments, tags, arrows.
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
      coalesce(oc.card_count, 0)::int as card_count,
      coalesce(p.seconds_in_app, 0)::bigint as seconds_in_app,
      u.created_at as created_at, u.last_sign_in_at as last_sign_in_at,
      s.plan::text as subscription_plan, s.status::text as subscription_status,
      s.current_period_end as current_period_end, s.monthly_amount_cents as subscription_amount_cents,
      (s.discount is not null) as subscription_discounted, (p.banned_at is not null) as banned,
      -- `we2`, not `we`: the new work_ev join below takes `we`, and reusing it
      -- here would shadow it inside this subquery — legal, and exactly the kind
      -- of thing that reads fine and means something else.
      exists (select 1 from public.waitlist_entries we2 where lower(we2.email) = lower(u.email)) as joined_waitlist,
      nullif(p.display_name, '') as display_name, nullif(p.avatar_url, '') as avatar_url,
      nullif(p.color, '') as color, pr.last_seen_at as last_seen_at,
      coalesce(ob.board_count, 0)::int as board_count,
      public.derive_acquisition_channel(p.first_source) as acquisition_source,
      ox.last_reached_out_at as last_reached_out_at, coalesce(ox.outreach_count, 0)::int as outreach_count,
      (u.email_confirmed_at is not null) as email_confirmed, coalesce(ostor.bytes, 0)::bigint as storage_bytes,
      nullif(p.country, '') as country,
      -- greatest() ignores NULLs in Postgres, so a user with only one of the
      -- two sources still gets a real answer instead of null.
      greatest(oc.last_card_at, we.last_ev_at) as last_worked_at
    from auth.users u
    left join public.profiles p on p.user_id = u.id
    left join public.subscriptions s on s.user_id = u.id
    left join public.user_presence pr on pr.user_id = u.id
    left join owner_cards oc on oc.uid = u.id
    left join owner_boards ob on ob.uid = u.id
    left join owner_storage ostor on ostor.uid = u.id
    left join work_ev we on we.uid = u.id
    left join lateral (
      select max(o.reached_at) as last_reached_out_at, count(*)::int as outreach_count
      from public.user_outreach o where o.user_id = u.id or lower(o.email) = lower(u.email)
    ) ox on true
    where (case v_v
             when 'verified'   then (u.email_confirmed_at is not null and u.last_sign_in_at is not null)
             when 'unverified' then (u.email_confirmed_at is null     or  u.last_sign_in_at is null)
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
    and (case v_a
           when 'active'   then (base.card_count > 0 or base.board_count > 0)
           when 'inactive' then (base.card_count = 0 and base.board_count = 0)
           else true end)
  order by
    case when v_k = 'recent' then base.created_at end desc nulls last,
    case when v_k = 'active' then base.last_seen_at end desc nulls last,
    -- NEW: sort by when they last actually made something.
    case when v_k = 'worked' then base.last_worked_at end desc nulls last,
    case when v_k = 'cards'  then base.card_count end desc nulls last,
    case when v_k = 'spend'  then base.subscription_amount_cents end desc nulls last,
    case when v_k = 'name'   then lower(coalesce(base.display_name, base.email)) end asc nulls last,
    base.created_at desc nulls last
  limit p_limit offset p_offset;
end $$;

revoke all on function public.admin_list_users(integer, integer, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.admin_list_users(integer, integer, text, text, text, text, text, text, text, text) to authenticated;
