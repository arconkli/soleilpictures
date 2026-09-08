-- 0311_anon_rpc_surface_and_default_privileges.sql
--
-- Two things: close the remaining anon-callable user RPCs, and stop the
-- problem from regrowing.
--
-- 1. THE SURFACE
-- After 0305, 122 SECURITY DEFINER functions were still executable by anon.
-- 62 of those read auth.uid() in their body, which is null for anon, so they
-- can never succeed for a signed-out caller — they are pure surface. They
-- include delete_workspace, transfer_workspace_ownership,
-- remove_workspace_member, merge_tags_v2, move_boards_under, share_board.
-- Every call site was checked: all live in signed-in modules (boardsApi.js,
-- tagsApi.js, inviteApi.js, voteCardsApi.js, ShareModal). Kept anon-callable
-- on purpose, with the reason:
--   * the nine helpers referenced inside RLS policies (can_read_board,
--     can_write_board, can_write_workspace, is_admin, is_workspace_member,
--     is_conversation_participant, is_active_conversation_participant,
--     my_readable_board_ids, my_workspace_ids) — a policy evaluated for an
--     anon SELECT must be able to call them, or the SELECT errors instead of
--     returning zero rows;
--   * the pre-signup set (bump_seconds_in_app, set_first_source,
--     get_my_experiments, set_experiment_arm, dismiss_ad_offer, get_my_tier),
--     which the landing/onboarding path calls before or around auth;
--   * touch_presence, because usePresenceHeartbeat is mounted from AuthGate,
--     which renders signed-out states too. Conservative; revisit.
--
-- 2. WHY IT KEPT REGROWING
-- 0305 revoked EXECUTE from anon and PUBLIC on every admin_* and _-prefixed
-- function. 0306 then created one new trigger function and the advisor flagged
-- it within the hour (0309). That is not carelessness: Supabase's default
-- privileges grant EXECUTE on every NEW function in public to anon,
-- authenticated and service_role, and Postgres itself grants EXECUTE to PUBLIC.
-- A revoke sweep is a snapshot; the defaults are the policy. So the defaults
-- change here: functions created by postgres in public no longer get EXECUTE
-- for anon or PUBLIC at creation. authenticated and service_role keep their
-- defaults, so client RPCs keep working without a per-function grant. A
-- function that is MEANT for signed-out callers now needs an explicit
--   grant execute on function public.<name>(...) to anon;
-- which the repo already does for the share/public RPCs (0018, 0136, 0179,
-- 0265). Forgetting it fails loudly as a 401 on that one RPC, never as an open
-- door. Functions created by a different role (dashboard as supabase_admin)
-- are outside these defaults; create them through migrations.
--
-- HOW POSTGRES ACTUALLY APPLIES DEFAULT PRIVILEGES (learned the hard way)
-- The first version of this migration altered only the SCHEMA-level entry
-- (`for role postgres in schema public`) and its own post-condition failed:
-- the probe function still carried `=X/postgres`, i.e. PUBLIC EXECUTE, and
-- anon inherits from PUBLIC. Reproduced in a rollback: a schema-level entry is
-- MERGED ON TOP OF the built-in default ACL (which grants EXECUTE to PUBLIC),
-- so removing anon from it cannot remove PUBLIC. A GLOBAL entry (`for role
-- postgres`, no schema) REPLACES the built-in default. So both are needed:
-- the global revoke drops the implicit PUBLIC grant, the schema revoke drops
-- Supabase's explicit anon grant. Verified: with both, a new function's ACL is
-- exactly {postgres, authenticated, service_role}. Side effect to know about:
-- functions postgres creates in schemas OTHER than public also lose PUBLIC
-- EXECUTE — none of ours live there.
--
-- Both halves assert their own post-conditions and raise if they did not take
-- — the lesson from 0305, where a REVOKE reported success and changed nothing.

-- ── 1. Revoke on the 46, all overloads, from anon AND public ────────────────
do $$
declare
  names text[] := array[
    'cast_vote','claim_collab_link','create_collab_link','delete_workspace',
    'get_unread_counts','leave_workspace','list_public_links','list_vote_cards',
    'merge_profile_settings','merge_tags_v2','merge_workspace_settings',
    'move_boards_under','my_storage_usage','remove_workspace_member',
    'restore_comment','restore_vote_card','revoke_pending_invite',
    'revoke_public_link','share_board','soft_delete_comment',
    'soft_delete_doc_links','soft_delete_tag','soft_delete_vote_card',
    'sweep_expired_paid_grants','transfer_workspace_ownership','unshare_board',
    'add_entity_alias','can_message','claim_pending_invite',
    'create_group_conversation','create_public_link','create_workspace_with_root',
    'find_or_create_dm','get_my_explore_submission','get_my_referral_stats',
    'get_or_create_my_referral_code','invite_workspace_member','is_board_member',
    'list_board_shares','list_messageable_users','list_pending_invites_for_board',
    'list_pending_invites_for_workspace','scout_create_link_code',
    'set_public_link_indexing','set_public_link_subboards','users_by_ids'
  ];
  r record;
  v_left int;
begin
  for r in
    select format('%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid)) as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and p.proname = any(names)
  loop
    execute format('revoke execute on function public.%s from public, anon', r.sig);
  end loop;

  select count(*) into v_left
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f' and p.proname = any(names)
    and has_function_privilege('anon', p.oid, 'execute');
  if v_left > 0 then
    raise exception 'still % of the listed functions executable by anon', v_left;
  end if;
end $$;

-- ── 2. Defaults: new functions are not anon/PUBLIC-callable at creation ─────
-- Global: replaces the built-in default, which is where PUBLIC EXECUTE lives.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres revoke execute on functions from anon;
-- Schema: Supabase's explicit per-role grants for public; drop anon, keep the rest.
alter default privileges for role postgres in schema public revoke execute on functions from anon;

-- Prove it with a throwaway function created under the new defaults.
do $$
begin
  execute 'create function public._zz_defprivs_probe() returns int language sql as $f$ select 1 $f$';
  if has_function_privilege('anon', 'public._zz_defprivs_probe()', 'execute') then
    raise exception 'default privileges still grant anon EXECUTE on new functions';
  end if;
  if not has_function_privilege('authenticated', 'public._zz_defprivs_probe()', 'execute') then
    raise exception 'authenticated lost its default EXECUTE — that would break every client RPC added from now on';
  end if;
  execute 'drop function public._zz_defprivs_probe()';
end $$;
