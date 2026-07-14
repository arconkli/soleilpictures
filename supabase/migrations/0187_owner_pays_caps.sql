-- 0187_owner_pays_caps.sql — owner-pays capacity, keyed consistently to the
-- WORKSPACE owner.
--
-- Free-editor collaboration (0188) is only safe if every resource gate
-- charges the workspace owner's plan no matter who acts. Today the two gates
-- disagree: authorize_upload (0154) keys workspaces.created_by, but the card
-- cap (0091/0163/0177) keys board_owner() = boards.created_by — so a
-- sub-board created by a collaborator bills the collaborator, not the owner.
--
-- This migration:
--   1. board_workspace_owner(board) — canonical billing subject.
--   2. enforce_demo_card_cap_trg    — re-keyed to the workspace owner; the
--      count spans every board in every workspace that owner created.
--   3. get_my_tier                  — demo_card_count matches the trigger's
--      definition (same workspace-owner scope).
--   4. get_board_capacity(board)    — owner-keyed capacity for clients on
--      boards they don't own (the client cap UI was actor-keyed and could
--      disagree with the server on shared boards).
--   5. authorize_image_upload       — byte-quota check for the ordinary
--      presign-PUT image path (previously unmetered; only multipart was).
--      Tier-NEUTRAL: demo owners get the same 100GiB ceiling instead of a
--      block — image upload is the core free experience; the card cap
--      bounds count.
--
-- Count-migration audit (run 2026-07-13 against live): 4 owners change
-- counts under the new keying; no demo owner lands near the cap (13 and 1
-- cards) — no compensating bonus_card_credits required.
--
-- board_owner() itself is left untouched: the legacy bump_demo_card_count_trg
-- cache counter still reads it and is harmless.

-----------------------------------------------------------------------
-- 1. board_workspace_owner — the billing subject for everything on a board.
-----------------------------------------------------------------------
create or replace function public.board_workspace_owner(p_board_id uuid)
returns uuid
language sql stable security definer
set search_path = public as $$
  select w.created_by
  from boards b join workspaces w on w.id = b.workspace_id
  where b.id = p_board_id;
$$;
revoke all on function public.board_workspace_owner(uuid) from public;
grant execute on function public.board_workspace_owner(uuid) to authenticated;

-----------------------------------------------------------------------
-- 2. Card cap — charge the workspace owner, count across all their
--    workspaces. Body otherwise identical to the live 0177 version
--    (including the idempotent re-insert early-return).
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
  select tier, 100 + coalesce(bonus_card_credits, 0)
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
  if v_count >= coalesce(v_cap, 100) then
    raise exception
      'Demo accounts are limited to % cards. Invite friends or upgrade to add more.', coalesce(v_cap, 100)
      using errcode = '42501';
  end if;
  return new;
end $$;

-----------------------------------------------------------------------
-- 3. get_my_tier — demo_card_count uses the same workspace-owner scope as
--    the trigger. Everything else verbatim from the live 0177 body.
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

-----------------------------------------------------------------------
-- 4. get_board_capacity — the OWNER's capacity for a board the caller can
--    read. Lets the client cap UI agree with the server on shared boards.
--    Returns only booleans/counts — never the owner's tier string.
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
  select p.tier, 100 + coalesce(p.bonus_card_credits, 0)
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
  return query select true, v_used, coalesce(v_cap, 100);
end $$;
revoke all on function public.get_board_capacity(uuid) from public;
grant execute on function public.get_board_capacity(uuid) to authenticated;

-----------------------------------------------------------------------
-- 5. authorize_image_upload — owner-keyed byte ceiling for the ordinary
--    presign-PUT image path. Tier-neutral by design (see header).
--    p_bytes=0 (old clients) only blocks when the owner is already over.
-----------------------------------------------------------------------
create or replace function public.authorize_image_upload(p_board_id uuid, p_bytes bigint)
returns table(allow boolean, used bigint, quota bigint, reason text)
language plpgsql stable security definer
set search_path = public as $$
declare
  v_owner uuid;
  v_quota bigint;
  v_used  bigint;
  v_bytes bigint := greatest(0, coalesce(p_bytes, 0));
begin
  if not public.can_write_board(p_board_id) then
    return query select false, 0::bigint, 0::bigint, 'not_writer'::text; return;
  end if;
  v_owner := public.board_workspace_owner(p_board_id);
  if v_owner is null then
    return query select false, 0::bigint, 0::bigint, 'no_workspace'::text; return;
  end if;
  v_quota := public._storage_quota_bytes();
  select coalesce(sum(i.size_bytes), 0) into v_used
    from public.images i
    join public.workspaces w on w.id = i.workspace_id
   where w.created_by = v_owner and i.deleted_at is null;
  return query select (v_used + v_bytes <= v_quota), v_used, v_quota,
                      (case when (v_used + v_bytes <= v_quota) then 'ok' else 'over_quota' end)::text;
end $$;
revoke all on function public.authorize_image_upload(uuid, bigint) from public;
grant execute on function public.authorize_image_upload(uuid, bigint) to authenticated;
