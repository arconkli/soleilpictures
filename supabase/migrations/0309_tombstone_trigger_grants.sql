-- 0309_tombstone_trigger_grants.sql
--
-- Housekeeping, and a small demonstration of why 0304/0305 will not stay true
-- on their own.
--
-- 0305 revoked EXECUTE from anon and PUBLIC on every admin_* and `_`-prefixed
-- SECURITY DEFINER function. 0306 then created a new one --
-- _tg_tombstone_r2_keys() -- which was therefore not covered, and it picked up
-- Postgres's default PUBLIC EXECUTE grant on creation. The security advisor
-- noticed within the hour.
--
-- The practical risk from this specific function is nil: calling a trigger
-- function directly raises "trigger functions can only be called as triggers".
-- But the shape is the point. Those revoke migrations are a one-time sweep, not
-- an invariant, and every function added after them starts world-callable
-- again. Anything that must hold going forward has to be either an event
-- trigger or a test — the same lesson as securityInvokerContract.test.mjs.

revoke execute on function public._tg_tombstone_r2_keys() from public, anon, authenticated;
