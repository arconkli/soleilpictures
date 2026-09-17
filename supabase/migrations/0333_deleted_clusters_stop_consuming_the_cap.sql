-- 0333 — a deleted cluster stops consuming the cap, and a restore cannot
-- carry you over it.
--
-- Owner decision, 2026-09-17: "if something gets deleted that should NOT go to
-- their cap but they also shouldn't be able to restore it and go above their
-- cap."
--
-- What was happening. soft_delete_board() only stamps boards.deleted_at, and
-- every expression that counts cards joined card_index to boards with NO
-- deleted_at filter. purge_old_deleted_boards() hard-deletes after 30 days, so
-- the cap came back — eventually, silently, a month later. In the meantime a
-- user who deleted a whole cluster to make room was refused anyway and told
-- "Demo accounts are limited to N cards" while holding far fewer than N. Live
-- accounts were in that state when this was written, including one whose
-- entire counted usage was a cluster they had deleted, and one a single card
-- from the wall who was carrying deleted cards.
--
-- Why it was wrong in six places at once: the expression was copy-pasted six
-- times. get_my_tier, enforce_demo_card_cap_trg, get_board_capacity,
-- scout_board_capacity, admin_paid_reach and _live_card_counts each carried
-- their own copy. That is the actual defect; the missing filter is a symptom.
-- _owner_card_count() below is now THE definition and all six call it.
--
-- The restore half. Freeing the cap on delete opens an obvious hole: delete a
-- 33-card cluster, add 33 new cards, restore. restore_board() therefore asks
-- the cap before it un-deletes, and refuses with the same 42501 the card
-- trigger uses, so every existing client path already surfaces our sentence
-- rather than a generic failure. The board is still soft-deleted at that
-- moment, so _owner_card_count already excludes the cards coming back and
-- there is no double count.
--
-- Note for whoever changes restore next: the client used to fall back to a
-- direct `update boards set deleted_at = null` whenever the RPC errored, and
-- the RLS UPDATE policy on boards permits exactly that for any workspace
-- member. A refusal here would have been silently overridden. That fallback is
-- removed in the same commit as this migration; do not reintroduce it.

begin;

-- ── THE definition of "cards held" ──────────────────────────────────────────
create or replace function public._owner_card_count(p_owner uuid)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(sum(ci.weight), 0)::integer
    from public.card_index ci
    join public.boards b     on b.id = ci.board_id
    join public.workspaces w on w.id = b.workspace_id
   where w.created_by = p_owner
     and b.deleted_at is null;
$$;

comment on function public._owner_card_count(uuid) is
  'Cards charged to a workspace owner. The ONE definition — get_my_tier, the cap trigger, both capacity readers and the admin decks all call this. Excludes soft-deleted clusters (0333).';

revoke execute on function public._owner_card_count(uuid) from public, anon, authenticated;

-- The population-scan twin, for whole-base admin reads where a per-row scalar
-- would be one aggregate per profile. Same rule; the proof block at the end
-- asserts the two agree for every owner.
create or replace function public._live_card_counts()
returns table (user_id uuid, cards integer)
language sql
stable
security definer
set search_path to 'public'
as $$
  select w.created_by, sum(ci.weight)::int
    from public.card_index ci
    join public.boards b     on b.id = ci.board_id
    join public.workspaces w on w.id = b.workspace_id
   where b.deleted_at is null
   group by w.created_by;
$$;

revoke execute on function public._live_card_counts() from public, anon, authenticated;

-- ── The enforcer ────────────────────────────────────────────────────────────
create or replace function public.enforce_demo_card_cap_trg()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_owner uuid;
  v_tier  text;
  v_count integer;
  v_cap   integer;
  v_delta integer;
begin
  if tg_op = 'INSERT' and exists (
    select 1 from public.card_index
     where board_id = new.board_id and card_id = new.card_id
  ) then
    return new;
  end if;
  v_delta := case when tg_op = 'UPDATE'
                  then greatest(coalesce(new.weight, 1) - coalesce(old.weight, 1), 0)
                  else greatest(coalesce(new.weight, 1), 1) end;
  if v_delta = 0 then
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
  v_count := public._owner_card_count(v_owner);
  if v_count + v_delta > coalesce(v_cap, 50) then
    raise exception
      'Demo accounts are limited to % cards. Invite friends or upgrade to add more.', coalesce(v_cap, 50)
      using errcode = '42501';
  end if;
  return new;
end $function$;

-- ── What the client reads ───────────────────────────────────────────────────
create or replace function public.get_my_tier()
returns table(tier text, demo_card_count integer, subscription_status text,
              current_period_end timestamp with time zone, cancel_at_period_end boolean,
              grant_active boolean, grant_expires_at timestamp with time zone,
              banned boolean, ad_offer_pending boolean, onboarding jsonb,
              bonus_card_credits integer, effective_card_limit integer,
              creator_trial_started_at timestamp with time zone)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    coalesce(p.tier, 'demo')::text,
    public._owner_card_count(u.id)                             as demo_card_count,
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
$function$;

-- ── The two capacity readers (API + Scout) ──────────────────────────────────
create or replace function public.get_board_capacity(p_board_id uuid)
returns table(is_capped boolean, used integer, cap integer)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_owner uuid;
  v_tier  text;
  v_cap   integer;
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
  return query select true, public._owner_card_count(v_owner), coalesce(v_cap, 50);
end $function$;

create or replace function public.scout_board_capacity(p_board_id uuid, p_user_id uuid)
returns table(is_capped boolean, used integer, cap integer)
language plpgsql
stable
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_owner uuid;
  v_tier  text;
  v_cap   integer;
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

  return query select true, public._owner_card_count(v_owner), coalesce(v_cap, 50);
end $function$;

-- ── The reach deck ──────────────────────────────────────────────────────────
create or replace function public.admin_paid_reach(
  p_since date default '2026-06-16'::date,
  p_exclude_internal boolean default true
)
returns table(band text, band_order integer, users bigint, saw_price bigint,
              price_seen bigint, saw_wall bigint, saw_banner bigint, saw_toast bigint,
              clicked bigint, blocked bigint, intent bigint)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  perform public._require_admin();
  return query
  with ext as (
    select p.user_id,
           coalesce(p.card_cap_base, 50) + coalesce(p.bonus_card_credits, 0) as cap
      from public.profiles p
      join auth.users u on u.id = p.user_id
     where u.created_at >= p_since
       and p.tier = 'demo'
       and not coalesce(p.is_service, false)
       and (not p_exclude_internal or p.user_id not in (select _internal_user_ids()))
  ),
  ci as (
    select l.user_id, l.cards from public._live_card_counts() l
  ),
  ev as (
    select e.user_id,
           bool_or(e.event = 'pricing_view')                                          as saw_price,
           bool_or(e.event = 'price_seen')                                            as price_seen,
           bool_or(e.event = 'pricing_view' and e.props->>'header' = 'cap-hit')        as saw_wall,
           bool_or(e.event = 'first_value_upgrade_view')                              as saw_banner,
           bool_or(e.event = 'up_cap_toast_view')                                     as saw_toast,
           bool_or(e.event in ('up_chip_click', 'up_settings_upgrade_click'))         as clicked,
           bool_or(e.event = 'card_create_blocked'
                   and e.props->>'reason' in ('server_cap', 'demo_cap', 'demo_cap_cell')) as blocked,
           bool_or(e.event = 'pricing_creator_intent')                                as intent
      from public.analytics_events e
     where e.user_id is not null
       and e.event in ('pricing_view', 'price_seen', 'first_value_upgrade_view', 'up_cap_toast_view',
                       'up_chip_click', 'up_settings_upgrade_click', 'card_create_blocked',
                       'pricing_creator_intent')
     group by 1
  ),
  banded as (
    select e.user_id,
           case when coalesce(ci.cards, 0) >= 0.8 * e.cap then 'At or near the cap (>=80%)'
                when coalesce(ci.cards, 0) >= 30 then '30+ cards'
                when coalesce(ci.cards, 0) >= 13 then '13-29 cards'
                when coalesce(ci.cards, 0) >= 6  then '6-12 cards'
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
$function$;

-- ── Restore asks the cap first ──────────────────────────────────────────────
create or replace function public.restore_board(p_board_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_owner     uuid;
  v_tier      text;
  v_cap       integer;
  v_used      integer;
  v_restoring integer;
begin
  if not public.can_write_board(p_board_id) then
    raise exception 'not authorized to restore board %', p_board_id using errcode = '42501';
  end if;

  -- What this restore hands back. The board is still soft-deleted here, so
  -- _owner_card_count excludes exactly these rows and cannot double count.
  select coalesce(sum(ci.weight), 0)::integer into v_restoring
    from public.card_index ci
   where ci.board_id = p_board_id;

  if v_restoring > 0 then
    v_owner := public.board_workspace_owner(p_board_id);
    if v_owner is not null then
      select p.tier, coalesce(p.card_cap_base, 50) + coalesce(p.bonus_card_credits, 0)
        into v_tier, v_cap
        from public.profiles p where p.user_id = v_owner;
      -- Only the demo tier is capped, exactly as the card trigger decides it.
      if v_tier is not distinct from 'demo' then
        v_used := public._owner_card_count(v_owner);
        if v_used + v_restoring > coalesce(v_cap, 50) then
          -- 42501, the same code the card trigger raises, so every client path
          -- that already surfaces our cap sentence surfaces this one too
          -- rather than showing a generic failure.
          raise exception
            'Restoring this cluster would take you to % cards, past your limit of %. Delete some cards first, or upgrade to Creator.',
            v_used + v_restoring, coalesce(v_cap, 50)
            using errcode = '42501';
        end if;
      end if;
    end if;
  end if;

  update boards set deleted_at = null, updated_at = now()
    where id = p_board_id and deleted_at is not null;
end;
$function$;

-- restore_board predates the 0311 grant habit and still carried EXECUTE for
-- PUBLIC and anon. can_write_board() already refused them, so this closes a
-- hygiene gap rather than a hole — but a signed-out caller has no business
-- holding EXECUTE on a writer.
revoke execute on function public.restore_board(uuid) from public, anon;

-- ── Proof, not assertion ────────────────────────────────────────────────────
do $$
declare
  v_bad      text := '';
  v_disagree int;
  v_ghosts   int;
begin
  -- Grants.
  if has_function_privilege('public', 'public._owner_card_count(uuid)', 'execute')
     or has_function_privilege('anon', 'public._owner_card_count(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public._owner_card_count(uuid)', 'execute') then
    v_bad := v_bad || ' _owner_card_count is reachable by a non-definer caller;';
  end if;
  if has_function_privilege('anon', 'public.restore_board(uuid)', 'execute')
     or has_function_privilege('public', 'public.restore_board(uuid)', 'execute') then
    v_bad := v_bad || ' restore_board is still reachable by anon/PUBLIC;';
  end if;
  if not has_function_privilege('authenticated', 'public.restore_board(uuid)', 'execute') then
    v_bad := v_bad || ' restore_board is no longer executable by authenticated;';
  end if;

  -- The scalar and the population scan must give the same answer for every
  -- owner, or the deck and the paywall disagree again by a different route.
  select count(*) into v_disagree
    from (select distinct w.created_by as uid from public.workspaces w) o
    left join public._live_card_counts() l on l.user_id = o.uid
   where coalesce(l.cards, 0) is distinct from public._owner_card_count(o.uid);
  if v_disagree > 0 then
    v_bad := v_bad || format(' _owner_card_count and _live_card_counts disagree for %s owner(s);', v_disagree);
  end if;

  -- And the thing this migration exists for: no card on a soft-deleted board
  -- may be charged to anyone any more.
  select count(*) into v_ghosts
    from (select distinct w.created_by uid from public.workspaces w) o
   where public._owner_card_count(o.uid) <> (
      select coalesce(sum(ci.weight), 0)
        from public.card_index ci
        join public.boards b     on b.id = ci.board_id
        join public.workspaces w on w.id = b.workspace_id
       where w.created_by = o.uid and b.deleted_at is null);
  if v_ghosts > 0 then
    v_bad := v_bad || format(' _owner_card_count still counts deleted boards for %s owner(s);', v_ghosts);
  end if;

  if v_bad <> '' then
    raise exception '0333 proof failed:%', v_bad;
  end if;
end $$;

commit;
