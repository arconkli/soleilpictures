-- 0290 — 0285 re-created compaction_job1_candidates() with a new signature and
-- left it executable by anon and authenticated.
--
-- The original zero-arg function was {postgres, service_role}. Dropping and
-- re-creating it picked up the schema's default EXECUTE grants, and the
-- `revoke all ... from public` in 0285 does NOT reach `anon` or `authenticated`
-- — PUBLIC is a separate grantee from the two Supabase roles. This repo has hit
-- that exact trap before (0264, the settings audit).
--
-- The function is SECURITY DEFINER and returns board_id, hour buckets and seq
-- ranges for every board with compactable ops, bypassing RLS. It is a
-- service_role-only maintenance RPC and must not be reachable from the anon or
-- authenticated API roles.

revoke all on function public.compaction_job1_candidates(integer) from anon;
revoke all on function public.compaction_job1_candidates(integer) from authenticated;
revoke all on function public.compaction_job1_candidates(integer) from public;
grant execute on function public.compaction_job1_candidates(integer) to service_role;
