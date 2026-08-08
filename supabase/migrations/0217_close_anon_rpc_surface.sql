-- 0217_close_anon_rpc_surface.sql — close the remaining anonymous RPC surface,
-- fix two cross-workspace read bugs, and drop TRUNCATE from the client roles.
--
-- WHY THIS EXISTS. Supabase sets
--   alter default privileges in schema public grant execute on functions to anon, authenticated;
-- so EVERY function created here is born callable by anon, and PostgREST
-- exposes it at /rest/v1/rpc/<name>. 0211 closed 27 of these. This closes the
-- rest, and fixes two functions whose bodies never checked authorization at all.
--
-- MEASURED, not inferred. Every claim below was confirmed against production by
-- running the call inside `begin; set local role anon; … rollback;` — i.e. as a
-- real anonymous caller with auth.uid() = NULL, which is exactly what anyone
-- holding the publishable key that ships in the client bundle can do:
--
--   compaction_job1_candidates()            → the board id of every board
--   fetch_ops_for_compaction(<any board>)   → that board's raw Yjs update_b64
--   lifecycle_due_*(…)                      → user emails, names and unsub tokens
--   _internal_user_ids()                    → the admin/internal account ids
--   find_orphan_images(…)                   → R2 storage paths
--   board_op_density(<any board>)           → per-bucket author uuids
--   email_status('<address>')               → whether that address has an account
--   user_id_by_email('<address>')           → that account's uuid
--
-- (Counts deliberately omitted — this repo is public.)
--
-- The first two COMPOSE into the worst case: candidates hands out every board
-- id, fetch_ops returns that board's raw CRDT update stream. Two unauthenticated
-- calls read the content of every board in the product, routing entirely around
-- RLS. (RLS itself is fine — a direct anon SELECT on boards/board_ops/profiles
-- returns 0 rows. The definer layer was the hole.)
--
-- BOTH GRANT DIRECTIONS MUST GO. 0208 and 0211 each learned one half the hard
-- way: `revoke … from public` does NOT drop an explicit `anon` grant, and
-- `revoke … from anon` does NOT drop a PUBLIC grant that anon inherits. So every
-- revoke here names anon, authenticated and public together.
--
-- SAFETY. Every remaining caller was traced by matching real invocation forms
-- (.rpc('x'), /rest/v1/rpc/x, the rpc/anonRpc/userRpc/sbRpc/supaRpc/scoutRpc/
-- supabaseRpc helpers, admin.rpc(), and SQL select/perform) across the whole
-- repo, excluding boards/ios and boards/android — those minified bundles are
-- untracked build artifacts (git ls-files → 0) that produce only false hits.
-- Two findings a naive grep gets wrong, and which this migration depends on:
--
--   • lifecycle_due_* look uncalled but ARE called, via admin.rpc(rpcName, …)
--     where rpcName arrives as a VARIABLE from runType("welcome_board",
--     "lifecycle_due_welcome_board", …) in lifecycle-email-cron. That caller is
--     the service-role `admin` client, so revoking anon/authenticated is safe.
--   • candidate_ai_quota is called from worker-ai.js via sbRpc(), a helper name
--     an earlier pass missed. sbRpc authenticates with SUPABASE_SERVICE_ROLE_KEY,
--     so it too is safe.
--
-- service_role holds its own explicit grant on every function here, so dropping
-- PUBLIC never touches the Worker, PartyKit, edge-function or pg_cron callers.
--
-- NOT touched, deliberately: the token-gated public readers — get_share_bundle /
-- get_share_meta, get_public_board_*, list_public_boards, list_public_board_images,
-- get_related_public_boards, peek_pending_invite_email. Anon MUST reach these;
-- they authorize on the token/slug argument instead of auth.uid().

do $$
declare
  -- ── Group A: no browser caller of any kind. Revoke anon AND authenticated. ──
  -- Each entry's sole caller, verified:
  --   compaction_job1_candidates      worker-compaction.js   (service role)
  --   fetch_ops_for_compaction        worker-compaction.js   (service role)
  --   find_history_safe_orphan_images worker.js:551          (service role)
  --   candidate_ai_quota              worker-ai.js:227       (service role via sbRpc)
  --   lifecycle_due_* ×7              lifecycle-email-cron   (service role, dynamic dispatch)
  --   lifecycle_email_variant_weights lifecycle-email-cron   (service role)
  --   user_id_by_email                4 edge fns + 1 script  (all service role; the
  --                                   last client caller, App.jsx's dead
  --                                   inviteToWorkspace, is deleted in this commit
  --                                   — boardsApi.inviteWorkspaceMember already
  --                                   replaced it with the owner-gated RPC)
  --   user_has_active_paid_grant      stripe-webhook:261     (service role)
  --   prune_all_board_versions        pg_cron 03:10          (runs as postgres)
  --   _internal_user_ids              inside other definers  (SQL-internal)
  --   the rest                        no callers at all
  no_client_caller text[] := array[
    'board_op_density',
    'board_owner',
    'candidate_ai_quota',
    'compaction_job1_candidates',
    'email_status',
    'fetch_ops_for_compaction',
    'find_history_safe_orphan_images',
    'find_orphan_images',
    'lifecycle_due_activate_nudge_1',
    'lifecycle_due_activate_nudge_2',
    'lifecycle_due_board_waiting',
    'lifecycle_due_nudge_dormant_early',
    'lifecycle_due_reengage_1',
    'lifecycle_due_welcome_board',
    'lifecycle_due_whats_new',
    'lifecycle_email_variant_weights',
    'prune_all_board_versions',
    'user_has_active_paid_grant',
    'user_id_by_email',
    '_email_pref_enabled',
    '_internal_session_ids',
    '_internal_user_ids',
    '_is_user_online',
    '_storage_quota_bytes',
    '_user_device_map'
  ];

  -- ── Group B: live signed-in client callers. Revoke anon, KEEP authenticated. ─
  --   get_experiment_config    App.jsx:3517
  --   get_entity_mentions      EntityBacklinksPanel / CardContextMenu /
  --                            BackgroundContextMenu / entityMentionsCache
  --   get_entity_backlinks     EntityBacklinksPanel:66
  --   get_related_entities     tagsApi.js:85
  --   get_candidate_names      useCandidateNames.js:105
  --   admin_* zero-arg overloads  AdminCommandCenter:79, AcquisitionView,
  --                            EngagementView. These delegate to the guarded
  --                            overloads and the guard DOES hold transitively —
  --                            probing as anon raised 42501 'admin only' from
  --                            _require_admin(). Revoked from anon anyway, so
  --                            the outer door is shut too.
  signed_in_client_caller text[] := array[
    'admin_acquisition_breakdown',
    'admin_activation_funnel',
    'admin_tier_usage_compare',
    'get_candidate_names',
    'get_entity_backlinks',
    'get_entity_mentions',
    'get_experiment_config',
    'get_related_entities'
  ];
  r record;
  n int := 0;
begin
  -- Loop over pg_proc by NAME rather than writing literal signatures: several of
  -- these are overloaded (admin_activation_funnel has three), and a typo'd
  -- signature would silently revoke nothing at all.
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.proname = any(no_client_caller)
  loop
    execute format('revoke all on function %s from anon, authenticated, public', r.sig);
    n := n + 1;
  end loop;

  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.proname = any(signed_in_client_caller)
  loop
    execute format('revoke all on function %s from anon, public', r.sig);
    -- Re-assert authenticated so this stays idempotent even if a later
    -- `revoke … from public` ever strips it.
    execute format('grant execute on function %s to authenticated', r.sig);
    n := n + 1;
  end loop;

  raise notice '0217: adjusted grants on % function(s)', n;
end $$;


-- ── Authorization bug #1: get_entity_mentions ────────────────────────────────
-- SECURITY DEFINER, takes a workspace uuid as a PARAMETER, and never checked
-- membership. Revoking anon does not close this: any SIGNED-IN user holding a
-- workspace uuid could read that workspace's card titles, card bodies, doc page
-- text and message bodies. Its three siblings (get_candidate_names,
-- get_related_entities, get_things_tagged) already check; this one never did.
--
-- Body is unchanged below the guard — only the is_workspace_member() check and
-- this comment are new.
create or replace function public.get_entity_mentions(p_term text, p_workspace uuid, p_limit integer default 6)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  pat   text := lower(trim(p_term));
  ents  jsonb;
  apps  jsonb;
  total int;
begin
  if pat is null or pat = '' or p_workspace is null then
    return jsonb_build_object('entities', '[]'::jsonb, 'appears_in', '[]'::jsonb, 'total_appears', 0);
  end if;

  -- ADDED (0217): the caller must actually belong to the workspace they are
  -- asking about. Without this the function is a cross-tenant content search.
  if not is_workspace_member(p_workspace) then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;

  with by_alias as (
    select entity_kind, entity_id from entity_aliases
    where workspace_id = p_workspace and lower(alias) = pat
  ),
  ent_rows as (
    select es.id, es.kind, es.workspace_id, es.board_id, es.card_id,
           es.title, es.body, es.meta, es.updated_at
      from entity_search es
     where es.workspace_id = p_workspace
       and (lower(es.title) = pat
            or exists (
                 select 1 from by_alias ba
                  where ba.entity_kind = es.kind
                    and (ba.entity_id = es.id or ba.entity_id = es.board_id::text)
               ))
     limit (p_limit * 4)
  )
  select coalesce(jsonb_agg(to_jsonb(er)), '[]'::jsonb) into ents from ent_rows er;

  with apps_doc as (
    select 'doc' as source_kind, dp.doc_card_id::text as source_id,
           dp.page_id as source_page_id, dp.page_title as source_title,
           substring(dp.page_text from greatest(1, position(pat in lower(dp.page_text)) - 40) for 160) as snippet,
           dp.updated_at
      from doc_page_index dp
     where dp.workspace_id = p_workspace
       and dp.page_text ilike '%' || pat || '%'
     order by dp.updated_at desc
     limit p_limit
  ), apps_msg as (
    select 'message' as source_kind, m.id::text as source_id,
           null::text as source_page_id,
           null::text as source_title,
           substring(m.body from greatest(1, position(pat in lower(m.body)) - 40) for 160) as snippet,
           m.created_at as updated_at
      from messages m
     where m.workspace_id = p_workspace
       and m.deleted_at is null
       and m.body ilike '%' || pat || '%'
     order by m.created_at desc
     limit p_limit
  ), apps_card as (
    select case when ci.kind = 'note' then 'note'
                when ci.kind = 'doc'  then 'doc'
                else 'card' end as source_kind,
           ci.card_id::text as source_id,
           null::text as source_page_id,
           ci.title as source_title,
           coalesce(substring(ci.body from greatest(1, position(pat in lower(ci.body)) - 40) for 160), '') as snippet,
           ci.updated_at
      from card_index ci
     where ci.workspace_id = p_workspace
       and (lower(ci.title) like '%' || pat || '%' or lower(coalesce(ci.body, '')) like '%' || pat || '%')
     order by ci.updated_at desc
     limit p_limit
  )
  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) into apps from (
    select * from apps_doc union all
    select * from apps_msg union all
    select * from apps_card
  ) x;

  select
    (select count(*) from doc_page_index dp where dp.workspace_id = p_workspace and dp.page_text ilike '%' || pat || '%')
  + (select count(*) from messages m where m.workspace_id = p_workspace and m.deleted_at is null and m.body ilike '%' || pat || '%')
  + (select count(*) from card_index ci where ci.workspace_id = p_workspace and (lower(ci.title) like '%' || pat || '%' or lower(coalesce(ci.body, '')) like '%' || pat || '%'))
  into total;

  return jsonb_build_object(
    'entities', ents,
    'appears_in', apps,
    'total_appears', coalesce(total, 0)
  );
end $function$;

revoke all on function public.get_entity_mentions(text, uuid, integer) from anon, public;
grant execute on function public.get_entity_mentions(text, uuid, integer) to authenticated;


-- ── Authorization bug #2: get_entity_backlinks ───────────────────────────────
-- Worse than its sibling: it has NO workspace parameter at all. It filtered
-- entity_links purely by TARGET identity (board id / card id / doc card id /
-- url), all of which the caller supplies. Any signed-in user holding a board or
-- doc-card uuid got back every link pointing at it — including source_workspace,
-- source_board_id and context_text from workspaces they have no access to.
--
-- A single membership check can't fix this (there's no workspace argument to
-- check), so the rows themselves are filtered by what the caller can read,
-- mirroring get_things_tagged's is_member-or-can_read_board pattern. A user
-- viewing backlinks inside their own workspace sees exactly what they saw
-- before; cross-tenant rows disappear.
create or replace function public.get_entity_backlinks(
  p_kind text,
  p_id uuid default null::uuid,
  p_board_id uuid default null::uuid,
  p_card_id text default null::text,
  p_doc_card_id uuid default null::uuid,
  p_url text default null::text,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  rows jsonb;
begin
  with matched as (
    select el.*
      from entity_links el
     where el.target_kind = p_kind
       and (
         (p_kind = 'board'   and el.target_board_id = p_board_id)
      or (p_kind = 'card'    and el.target_board_id = p_board_id and el.target_card_id = p_card_id)
      or (p_kind in ('doc','docPos') and el.target_doc_card_id = p_doc_card_id)
      or (p_kind in ('message','user','tag') and el.target_id = p_id)
      or (p_kind = 'url'     and el.target_url = p_url)
       )
       -- ADDED (0217): only surface links whose SOURCE the caller can actually
       -- read. Without this the function leaks cross-workspace link graphs and
       -- their context_text snippets to anyone holding a target uuid.
       and (
         is_workspace_member(el.source_workspace)
         or (el.source_board_id is not null and can_read_board(el.source_board_id))
       )
     order by el.created_at desc
     limit p_limit
  )
  select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) into rows from matched m;
  return rows;
end $function$;

revoke all on function public.get_entity_backlinks(text, uuid, uuid, text, uuid, text, integer) from anon, public;
grant execute on function public.get_entity_backlinks(text, uuid, uuid, text, uuid, text, integer) to authenticated;


-- ── Defence in depth: TRUNCATE ───────────────────────────────────────────────
-- Supabase's defaults grant anon and authenticated the full arwdDxtm set on
-- every public table. RLS is the real control for r/w/a/d — but RLS does NOT
-- gate TRUNCATE, so that `D` is protected only by the fact that nothing can
-- currently issue the statement (PostgREST never emits TRUNCATE, and no
-- SECURITY INVOKER function here runs one). That is a property of today's code,
-- not a permission boundary. Take it away and it stops mattering.
revoke truncate on all tables in schema public from anon, authenticated;

-- Same for future tables, so this doesn't silently regress on the next
-- `create table`.
alter default privileges in schema public revoke truncate on tables from anon, authenticated;


-- ── Scratch tables from the history-rework spike ─────────────────────────────
-- RLS on with zero policies, but full table grants to anon/authenticated. NOT
-- dropped: they still hold 5 / 7 / 45 rows of real fixture and result data.
-- Grants removed so they aren't reachable at all from a client role.
revoke all on table public._rework_test_baseline from anon, authenticated;
revoke all on table public._rework_test_fixtures from anon, authenticated;
revoke all on table public._rework_test_results  from anon, authenticated;
