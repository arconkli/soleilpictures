-- 0211_revoke_anon_on_unguarded_rpcs.sql — close client EXECUTE on SECURITY
-- DEFINER functions that carry no authorization check of their own.
--
-- WHY THIS EXISTS. Supabase sets
--   alter default privileges in schema public grant execute on functions to anon, authenticated;
-- so EVERY function created here is born callable by anon, and PostgREST exposes
-- it at /rest/v1/rpc/<name> — including underscore-prefixed "internal" helpers.
-- `revoke ... from public` does NOT remove that grant (0208 hit this). Verified
-- reachable in production: an anon POST to /rest/v1/rpc/_is_user_online returned
-- HTTP 200 using only the publishable key, which ships in the client bundle.
--
-- AND THE MIRROR OF THAT BUG, caught by this migration's own dry-run: some of
-- these ALSO carry a PUBLIC grant (proacl shows a leading `=X/postgres`), which
-- `revoke ... from anon` does NOT remove — anon simply inherits via PUBLIC. So
-- both directions have to be revoked explicitly. service_role holds its own
-- explicit grant on every function here, so dropping PUBLIC never touches the
-- Worker / edge-function callers.
--
-- The functions below are SECURITY DEFINER (they run as the owner) AND contain
-- no is_admin() / auth.uid() / can_read_board() style guard, so the grant was
-- the only thing standing between an anonymous caller and a privileged write.
-- Worst cases: _notify_email is an open relay for every transactional template
-- on our own domain; delete_image_rows deletes arbitrary images rows by id; the
-- board-op writers can corrupt sync state for any board.
--
-- SAFETY. Every remaining legitimate caller reaches these with the SERVICE ROLE
-- (Cloudflare Workers via worker.js's rpc() helper, the PartyKit opLog, and the
-- admin-account-action / resend-webhook / lifecycle-email-cron edge functions),
-- or from inside other SQL (triggers, pg_cron) where the call is checked against
-- the definer, not the caller. Neither path is affected by revoking anon or
-- authenticated. Audited every name against the whole repo before listing it.
--
-- NOT touched here, deliberately:
--   • token-gated public readers (get_share_bundle/_meta, get_public_board_*,
--     list_public_boards, peek_pending_invite_email) — anon MUST call these;
--     they authorize on the token/slug argument instead of auth.uid().
--   • every admin_* RPC — already _require_admin()/is_admin() gated (spot-checked).
--   • read-only enumeration oracles (user_id_by_email, email_status, board_owner,
--     _internal_user_ids) — a separate, more delicate pass; they may back the
--     signup/invite flows.

do $$
declare
  -- Revoke from BOTH anon and authenticated: no browser session has any reason
  -- to call these.
  no_client_caller text[] := array[
    '_claim_pending_invites_for_user',
    '_notify_email',
    '_purge_stale_heartbeat_sessions',
    '_reconcile_universe_counters',
    '_reconcile_universe_counters_full',
    'advance_board_latest_seq',
    'anonymize_user_analytics',
    'anonymize_user_client_errors',
    'append_board_op',
    'bump_board_state_version',
    'capture_metrics_daily',
    'commit_op_batch',
    'compaction_job1_dryrun',
    'delete_image_rows',
    'experiment_optimize',
    'ingest_email_event',
    'lifecycle_claim_send',
    'lifecycle_email_optimize',
    'lifecycle_refresh_send_hours',
    'mark_image_rows_swept',
    'purge_old_analytics_events',
    'purge_old_client_errors',
    'purge_old_deleted_boards',
    'purge_old_deleted_comments',
    'record_r2_sweep_audit'
  ];
  -- Revoke anon ONLY — these two are genuinely invoked by the signed-in client
  -- (boards/src/lib/boardsApi.js), so `authenticated` must keep EXECUTE.
  signed_in_client_caller text[] := array[
    'get_or_create_personal_workspace',
    'prune_board_versions'
  ];
  r record;
  n int := 0;
begin
  -- Loop over pg_proc rather than writing literal signatures: several of these
  -- are overloaded, and a typo'd signature would silently revoke nothing.
  for r in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.proname = any(no_client_caller)
  loop
    execute format('revoke all on function %s from anon, authenticated, public', r.sig);
    n := n + 1;
  end loop;

  for r in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.proname = any(signed_in_client_caller)
  loop
    execute format('revoke all on function %s from anon, public', r.sig);
    -- Re-assert authenticated so this is idempotent even if a later
    -- `revoke ... from public` ever strips it.
    execute format('grant execute on function %s to authenticated', r.sig);
    n := n + 1;
  end loop;

  raise notice '0211: adjusted grants on % function(s)', n;
end $$;
