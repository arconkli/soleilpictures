-- The admin decks counted cards the cap does not count.
--
-- Since 0333, _owner_card_count(uuid) is THE definition of cards-held:
-- sum(card_index.weight) over LIVE boards in workspaces the user created.
-- The admin RPCs never moved onto it. They each recomputed the count inline,
-- and the inline version diverged three ways at once: it counted soft-deleted
-- clusters, keyed on boards.created_by instead of workspaces.created_by, and
-- counted rows instead of summing weight. An account reading well above its
-- cap in /admin was holding a third of that, and had never once been refused.
--
-- This view is the set-wise form of the same definition, plus the two figures
-- that were being silently folded into the old number:
--   discarded_* — cards stranded on soft-deleted clusters. purge_old_deleted_
--                 boards() hard-deletes at 30 days, so they are recoverable
--                 until then and count against nobody meanwhile.
--   guest_*     — cards in LIVE clusters the user created inside someone
--                 else's workspace. The plan covers the WORKSPACE (owner-keyed
--                 since 0187), so these are charged to that workspace's owner,
--                 not to the user who made the cluster. Shown on the guest's
--                 panel so the asymmetry is visible rather than invisible.
--
-- _owner_card_count(uuid) is deliberately NOT reimplemented on top of this
-- view: it runs inside enforce_demo_card_cap_trg, a BEFORE INSERT trigger, and
-- must not scan a grouped view once per card inserted. That leaves two
-- expressions for "live cards", which is exactly the drift this migration
-- exists to end — so the block at the bottom asserts they agree for every
-- user, and this migration refuses to apply if they ever do not.

-- security_invoker = on is stated in the CREATE itself, not bolted on after.
-- create or replace view resets every reloption it does not restate, which is
-- how entity_search silently lost RLS for three weeks (0084 -> 0240 -> 0302);
-- securityInvokerContract.test.mjs enforces this for every view in the repo.
-- It costs nothing here: postgres owns boards/workspaces/card_index and a
-- table owner bypasses RLS anyway (no FORCE ROW LEVEL SECURITY), so the admin
-- RPCs that read this view still see every row -- while a future accidental
-- grant to authenticated fails closed instead of leaking the whole corpus.
create or replace view public._owner_card_counts
with (security_invoker = on) as
with per_board as (
  select w.created_by as ws_owner,
         b.created_by as board_creator,
         b.id         as board_id,
         b.deleted_at,
         coalesce(sum(ci.weight), 0)::int as cards
    from public.boards b
    join public.workspaces w on w.id = b.workspace_id
    left join public.card_index ci on ci.board_id = b.id
   group by w.created_by, b.created_by, b.id, b.deleted_at
),
owners as (
  select ws_owner as uid,
         coalesce(sum(cards) filter (where deleted_at is null), 0)::int     as live_cards,
         coalesce(sum(cards) filter (where deleted_at is not null), 0)::int as discarded_cards,
         -- Deleted clusters that actually held something. An empty cluster the
         -- user made and threw away is not part of "where did the cards go".
         count(*) filter (where deleted_at is not null and cards > 0)::int   as discarded_clusters
    from per_board
   where ws_owner is not null
   group by ws_owner
),
guests as (
  select board_creator as uid,
         coalesce(sum(cards), 0)::int      as guest_cards,
         count(*)::int                     as guest_clusters,
         count(distinct ws_owner)::int     as guest_workspaces
    from per_board
   where board_creator is not null
     and board_creator is distinct from ws_owner
     and deleted_at is null
   group by board_creator
)
select coalesce(o.uid, g.uid)              as user_id,
       coalesce(o.live_cards, 0)           as live_cards,
       coalesce(o.discarded_cards, 0)      as discarded_cards,
       coalesce(o.discarded_clusters, 0)   as discarded_clusters,
       coalesce(g.guest_cards, 0)          as guest_cards,
       coalesce(g.guest_clusters, 0)       as guest_clusters,
       coalesce(g.guest_workspaces, 0)     as guest_workspaces
  from owners o
  full outer join guests g on g.uid = o.uid;

comment on view public._owner_card_counts is
  'Per-user card holdings, set-wise. live_cards is identical to '
  '_owner_card_count(uuid) and the two are asserted equal at migration time. '
  'Internal: admin RPCs only, never client-readable.';

revoke all on public._owner_card_counts from public;
revoke all on public._owner_card_counts from anon;
revoke all on public._owner_card_counts from authenticated;

-- Prove the grants rather than trusting the REVOKEs, and prove the view agrees
-- with the cap. Either failure aborts the migration.
do $$
declare
  v_leak text;
  v_bad  integer;
  v_inv  text;
begin
  select string_agg(r, ', ') into v_leak
    from unnest(array['public', 'anon', 'authenticated']) r
   where has_table_privilege(r, 'public._owner_card_counts', 'SELECT');
  if v_leak is not null then
    raise exception '_owner_card_counts is SELECT-able by: %', v_leak;
  end if;

  -- Prove the reloption actually landed. A create or replace that forgets to
  -- restate it reports success and silently reinstates the owner's view.
  select array_to_string(c.reloptions, ',') into v_inv
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = '_owner_card_counts';
  if coalesce(v_inv, '') not ilike '%security_invoker=%on%'
     and coalesce(v_inv, '') not ilike '%security_invoker=true%' then
    raise exception '_owner_card_counts is not security_invoker=on (reloptions: %)', coalesce(v_inv, '<none>');
  end if;

  select count(*) into v_bad
    from public._owner_card_counts c
   where c.live_cards is distinct from public._owner_card_count(c.user_id);
  if v_bad > 0 then
    raise exception
      '_owner_card_counts.live_cards disagrees with _owner_card_count() on % row(s)', v_bad;
  end if;
end $$;
