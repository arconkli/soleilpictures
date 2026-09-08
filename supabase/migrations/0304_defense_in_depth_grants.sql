-- 0304_defense_in_depth_grants.sql
--
-- Right now RLS is the ONLY thing standing between a client role and most of
-- the database. `anon` and `authenticated` hold table-level INSERT/UPDATE/DELETE
-- on almost every table in `public` -- including paid_grants, subscriptions,
-- stripe_webhook_events, app_config, internal_accounts and
-- seo_health_expectations. Every one of those is currently safe, but safe for
-- exactly one reason: a policy is absent or restrictive. There is no second
-- layer. A single mis-scoped `create policy` turns any of them into an open
-- write endpoint, and nothing else would object.
--
-- This migration adds the second layer, and does it in the one way that cannot
-- change behaviour: it only revokes a write grant where NO row-level policy
-- could permit that write for that role in the first place. The set was
-- computed from the live catalog --
--
--   grant exists for role R on table T
--   AND no pg_policy on T with polcmd in (INSERT, UPDATE, DELETE, ALL)
--       names R (or PUBLIC)
--
-- -- so every statement below revokes a privilege that RLS already denies.
-- Tables with a real anon/authenticated write path (analytics_events,
-- client_errors, boards, board_state, card_index, comments, tags, images,
-- vote_cards, messages, workspaces, ...) are deliberately untouched.
--
-- Two things this does NOT break, both worth stating because they look like
-- they should:
--   * SECURITY DEFINER RPCs. Privileges are checked against the function OWNER,
--     not the caller, so revoking a caller's table grant cannot affect them.
--     This is how every legitimate write to these tables actually happens.
--   * service_role. It holds its own grants and is not referenced here.
--
-- Note for later: `template_downloads` appears below because no policy permits
-- a client write -- which also means the download counter has never been able
-- to record anything from the client. That is a pre-existing bug this migration
-- neither causes nor fixes; it just makes the cause legible.
--
-- Follows the pattern of 0211_revoke_anon_on_unguarded_rpcs.sql and
-- 0217_close_anon_rpc_surface.sql, which closed the RPC half of this surface.

-- ── 1. Table write grants ────────────────────────────────────────────────────

do $$
declare
  -- No policy permits a write for EITHER client role.
  -- (named both_roles, not `both` -- that is a plpgsql reserved word.)
  both_roles text[] := array[
    'ad_signups','board_op_batches','board_ops','board_restore_events',
    'board_shares','board_snapshots','board_state_version','board_tx',
    'candidate_ai_cache','client_error_mutes','common_words',
    'deleted_entity_links','heartbeat_session','history_rework_config',
    'inconsistency_audit','job_runs','meta_capi_log','metrics_daily',
    'paid_grants','pending_invites','platform_counters','r2_sweep_audit',
    'scout_accounts','scout_health','scout_identities','scout_ingest_log',
    'scout_link_codes','scout_threads','seo_health_checks',
    'seo_health_expectations','seo_health_runs','stripe_webhook_events',
    'subscriptions','tag_ai_usage','tag_merge_undo','template_downloads',
    'usage_session','user_active_day','user_outreach','user_presence',
    'waitlist_entries'
  ];
  -- anon holds the grant; authenticated has a policy or no grant.
  anon_only text[] := array['app_config','internal_accounts'];
  t text;
begin
  foreach t in array both_roles loop
    if to_regclass('public.' || quote_ident(t)) is not null then
      execute format('revoke insert, update, delete on public.%I from anon', t);
      execute format('revoke insert, update, delete on public.%I from authenticated', t);
    end if;
  end loop;

  foreach t in array anon_only loop
    if to_regclass('public.' || quote_ident(t)) is not null then
      execute format('revoke insert, update, delete on public.%I from anon', t);
    end if;
  end loop;
end $$;

-- ── 2. admin_* and internal helper EXECUTE, from anon ────────────────────────
--
-- Every admin_* function already calls _require_admin() internally, and that
-- guard holds even through a SECURITY DEFINER call because it reads auth.uid(),
-- which comes from the request JWT rather than the executing role. So this is
-- not closing a live hole -- it is removing 126 functions from the surface a
-- signed-out caller can even reach, so that the next admin RPC written without
-- a guard is not instantly world-callable.
--
-- The `_`-prefixed entries are trigger functions and internal helpers. Triggers
-- fire under the table owner's context and do not consult the caller's EXECUTE
-- privilege, so revoking here does not affect them.

do $$
declare r record;
begin
  for r in
    select format('%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid)) as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.prosecdef
      and has_function_privilege('anon', p.oid, 'execute')
      and (p.proname like 'admin\_%' or p.proname like '\_%')
  loop
    execute format('revoke execute on function public.%s from anon', r.sig);
  end loop;
end $$;
